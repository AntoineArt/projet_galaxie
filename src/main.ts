import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as P from './galaxy/params';
import { Grid } from './galaxy/grid';
import { FLOATS_PER_INSTANCE, LodBuilder } from './galaxy/lod';
import { LodClient } from './galaxy/lodclient';
import { StarRenderer } from './render/stars';
import { FarField } from './render/farfield';
import { FlyControls } from './controls';
import { Hud } from './ui/hud';
import { ExposurePass } from './render/exposure';
import { ProbeClient } from './galaxy/probeclient';
import { Objects } from './render/objects';
import { GlowRenderer } from './render/glow';
import { Galaxies } from './render/galaxies';
import { Population } from './galaxy/population';
import { SystemRenderer } from './render/system';
import { buildSystem, type StarSystem } from './galaxy/system';
import { SelectionManager } from './ui/selection';
import { buildSolarSystem, SUN_AGE, SUN_ID } from './galaxy/solar';
import { stellarState } from './galaxy/stellar';

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); // au-delà, le post-traitement plein écran domine le coût
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.autoClear = true;
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 1e-12, 1e9); // near = 30 km : pas de test de profondeur, seule la coupure compte
camera.position.set(0, 0, 0);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const exposurePass = new ExposurePass();
composer.addPass(exposurePass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.5, 0.8);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// --- modèle
const grid = new Grid();
const pop = new Population();
const lodLocal = new LodBuilder(grid, pop); // sonde CPU (nodeInfo) ; le parcours de rendu est dans le worker
const lod = new LodClient();
const stars = new StarRenderer(renderer.capabilities.maxVertexUniforms < 600 || new URLSearchParams(location.search).has('vistex'));
const glow = new GlowRenderer();
const far = new FarField(grid, pop);
const objects = new Objects();
const systemR = new SystemRenderer();
const galaxies = new Galaxies();
objects.pickables.push(...galaxies.pickables);
scene.add(galaxies.points, far.group, glow.mesh, stars.group, objects.group, systemR.group);
document.getElementById('loading')!.remove();

// --- état
const state = {
  time: P.T_PRESENT, // Myr
  timeSpeed: 0, // Myr/s
  paused: true,
  exposure: 8,
  autoExposure: true,
  budget: 1_500_000,
  showFar: true,
  showDust: true,
  bloom: 0.55,
  showOrbits: true,
};
let system: StarSystem | null = null;
/** poids de la vue système (0 : galaxie, 1 : au coeur d'un système) : atténue le fond, met en avant les corps */
let sysW = 0;
const sunPos = new THREE.Vector3(P.SUN_POS.x, P.SUN_POS.y, P.SUN_POS.z);
/** le Soleil comme "étoile la plus proche" synthétique (hors champ procédural) */
const sunStar = { dist: 0, mass: 1, age: SUN_AGE, birth: P.T_PRESENT - SUN_AGE, comp: 1, state: { L: 1, T: 5778, phase: 2, radius: 1 }, pos: sunPos, index: 0, seed: -1, bin: -1, id: SUN_ID };
(window as unknown as { galaxy: unknown }).galaxy = { state, lod, lodLocal, stars, far, objects, glow, probe: null as unknown, systemR: null as unknown, selection: null as unknown, camera, THREE, P, controls: null as unknown };
const controls = new FlyControls(renderer.domElement);
(window as unknown as { galaxy: { controls: unknown } }).galaxy.controls = controls;
// vue initiale : extérieur de la galaxie (R pour rejoindre le Soleil)
controls.position.set(-9000, -32000, 22000);
controls.lookAt(new THREE.Vector3(0, 0, 0));
controls.speed = 3000;
const probe = new ProbeClient(lodLocal, lod);
const selection = new SelectionManager(probe, objects, systemR);
(window as unknown as { galaxy: { selection: unknown } }).galaxy.selection = selection;
const hud = new Hud(state, lod, controls, selection);
let thetaNow = 0;
const selPos = new THREE.Vector3();
let selPosValid = false;
controls.onClick = (x, y) => {
  const th = thetaNow;
  const cm = Math.cos(-th), sm = Math.sin(-th);
  const pp = controls.position;
  const cp = new THREE.Vector3(cm * pp.x - sm * pp.y, sm * pp.x + cm * pp.y, pp.z);
  selection.pick(x, y, camera, controls.position, cp, th, state.time, lod.fluxMin).then(() => controls.stopOrbit());
};
(window as unknown as { galaxy: { probe: unknown; systemR: unknown } }).galaxy.probe = probe;
(window as unknown as { galaxy: { probe: unknown; systemR: unknown } }).galaxy.systemR = systemR;

// --- rebuild LOD
const anchor = new THREE.Vector3();
const camPat = new THREE.Vector3();
const lastCamPat = new THREE.Vector3(1e9, 0, 0);
const lastQuat = new THREE.Quaternion();
let tRef = state.time;
const cullCam = new THREE.PerspectiveCamera(60, 1, 1e-12, 1e9);
const projView = new THREE.Matrix4();
const viewRot = new THREE.Matrix4();

function needRebuild(): boolean {
  const smallest = lod.stats.nodes > 0 ? smallestNode : 64;
  const moved = camPat.distanceTo(lastCamPat);
  // parallaxe : le déplacement compte relativement au noeud le plus proche
  if (moved > Math.max(0.3, 0.04 * smallest, 0.03 * lod.stats.nearest)) return true;
  // les phases de dérive et les tables de population restent valables sur ~0.4 % de l'âge courant
  if (Math.abs(state.time - requestedTime) > Math.max(0.5, 0.004 * state.time)) return true;
  if (controls.quaternion.angleTo(lastQuat) > 0.08) return true;
  if (lod.budget !== state.budget) return true;
  if (!lod.stats.converged && !lod.inFlight) return true;
  // fondu terminé : reconstruire une fois pour évacuer les noeuds sortants (sinon ils coûtent des sommets à vide)
  if (lod.stats.outgoing > 0 && !lod.inFlight && performance.now() - lod.resultAt > 900) return true;
  return false;
}
let smallestNode = 64;

function rebuild(theta: number): void {
  lod.budget = state.budget;
  // frustum élargi pour le culling
  cullCam.fov = Math.min(170, camera.fov + 25);
  cullCam.aspect = camera.aspect;
  cullCam.quaternion.copy(controls.quaternion);
  cullCam.position.set(0, 0, 0);
  cullCam.updateMatrixWorld();
  cullCam.updateProjectionMatrix();
  projView.multiplyMatrices(cullCam.projectionMatrix, cullCam.matrixWorldInverse);
  lod.request(camPat, theta, camPat, state.time, projView);
  lastCamPat.copy(camPat);
  lastQuat.copy(controls.quaternion);
  requestedTime = state.time;
}
let requestedTime = -1e9;
lod.onResult = () => {
  stars.upload(lod);
  glow.upload(lod);
  anchor.copy(lod.anchor);
  tRef = lod.tRef;
  smallestNode = 1e9;
  for (let b = 0; b < lod.buckets.length; b++) {
    const bk = lod.buckets[b];
    for (let i = 0; i < bk.count; i++) smallestNode = Math.min(smallestNode, bk.data[i * FLOATS_PER_INSTANCE + 3]);
  }
  if (smallestNode === 1e9) smallestNode = 64;
};

// --- boucle
let last = performance.now();
const anchorRel = new THREE.Vector3();
const perfLog: number[] = [];
(window as unknown as { galaxy: { perfLog: number[] } }).galaxy.perfLog = perfLog;
function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (!state.paused) state.time = Math.max(0, state.time + state.timeSpeed * dt);
  controls.update(dt);
  hud.handleKeys(controls, probe);

  const theta = P.PATTERN_OMEGA * state.time;
  thetaNow = theta;
  const c = Math.cos(-theta), s = Math.sin(-theta);
  const p = controls.position;
  camPat.set(c * p.x - s * p.y, s * p.x + c * p.y, p.z);

  camera.quaternion.copy(controls.quaternion);
  camera.updateMatrixWorld();
  viewRot.copy(camera.matrixWorldInverse);
  const pixelScale = (renderer.domElement.height / 2) / Math.tan((camera.fov * Math.PI) / 360);

  if (needRebuild()) rebuild(theta);

  exposurePass.enabled = state.autoExposure;
  exposurePass.target = system ? 0.04 : 0.16; // près d'une étoile : ciel éblouissant, exposition réduite
  if (state.autoExposure) state.exposure = exposurePass.update(dt);

  anchorRel.copy(anchor).sub(camPat);
  const su = stars.material.uniforms;
  su.uProj.value.copy(camera.projectionMatrix);
  su.uView.value.copy(viewRot);
  su.uAnchorRel.value.copy(anchorRel);
  su.uCamPat.value.copy(camPat);
  su.uDustOn.value = state.showDust ? 1 : 0;
  far.starMat.uniforms.uDustOn.value = state.showDust ? 1 : 0;
  objects.setDust(state.showDust);
  su.uTheta.value = theta;
  su.uTime.value = state.time;
  su.uTRef.value = tRef;
  su.uFluxMin.value = lod.fluxMin;
  su.uNow.value = now / 1000;
  (su.uQTO.value as Float32Array).set(lod.qTO);
  const bgExposure = state.exposure * (1 - 0.85 * sysW); // fond atténué en vue système
  su.uExposure.value = bgExposure;
  su.uPixelScale.value = pixelScale;

  far.setTime(state.time);
  const fu = far.starMat.uniforms;
  fu.uProj.value.copy(camera.projectionMatrix);
  fu.uView.value.copy(viewRot);
  fu.uCamPat.value.copy(camPat);
  fu.uTheta.value = theta;
  fu.uFluxMin.value = lod.fluxMin;
  fu.uExposure.value = bgExposure;
  fu.uPixelScale.value = pixelScale;
  const du = far.dustMat.uniforms;
  du.uProj.value.copy(camera.projectionMatrix);
  du.uView.value.copy(viewRot);
  du.uCamPat.value.copy(camPat);
  du.uTheta.value = theta;
  du.uPixelScale.value = pixelScale;
  far.group.children[0].visible = state.showFar;
  far.group.children[1].visible = state.showDust;

  objects.update(camera, viewRot, camPat, theta, state.time, bgExposure, pixelScale);
  galaxies.update(camera, viewRot, camPat, theta, bgExposure, pixelScale);
  const gu = glow.material.uniforms;
  gu.uProj.value.copy(camera.projectionMatrix);
  gu.uView.value.copy(viewRot);
  gu.uCamPat.value.copy(camPat);
  gu.uTheta.value = theta;
  gu.uExposure.value = bgExposure;
  gu.uPixelScale.value = pixelScale;
  gu.uDustOn.value = state.showDust ? 1 : 0;
  glow.mesh.visible = state.showFar && lod.glow.count > 0;

  bloom.strength = state.bloom;
  renderer.info.reset();
  composer.render();
  probe.update(camPat, state.time, now);
  probe.refreshSelected(camPat, state.time); // suivi exact chaque frame (dérive, évolution)
  if (hud.pickRequested) {
    hud.pickRequested = false;
    selection.pick(innerWidth / 2, innerHeight / 2, camera, controls.position, camPat.clone(), theta, state.time, lod.fluxMin).then(() => controls.stopOrbit());
  }
  if (hud.findRequested) {
    const pred = hud.findRequested; hud.findRequested = null;
    hud.notice('recherche…');
    probe.findNearest(camPat.clone(), state.time, pred, 2).then((found) => {
      if (found) { selection.current = { kind: 'star', star: found }; controls.stopOrbit(); }
      hud.notice(found ? '' : 'rien de tel dans les 125 noeuds autour de la caméra (~300 pc)');
    });
  }
  // position monde de la sélection (suivie chaque frame : les astres bougent avec le temps)
  selPosValid = selection.worldPos(controls.position, theta, selPos) !== null;
  if (selection.current && !selPosValid) { selection.clear(); controls.stopOrbit(); }
  hud.updateMarker(selPosValid ? selPos : null, camera, controls.position);
  if (selPosValid && (hud.visitRequested || hud.orbitRequested)) {
    const radius = selection.radius();
    const dist = hud.visitRequested ? selection.visitDistance() : Math.max(controls.position.distanceTo(selPos), radius * 1.5);
    hud.visitRequested = hud.orbitRequested = false;
    if (dist < controls.position.distanceTo(selPos) * 0.999 || dist > controls.position.distanceTo(selPos) * 1.001) {
      // on se place à la distance voulue en gardant la direction d'approche
      const dir = new THREE.Vector3().subVectors(controls.position, selPos);
      if (dir.lengthSq() < 1e-30) dir.set(1, 0, 0.3);
      dir.normalize().multiplyScalar(dist);
      controls.position.copy(selPos).add(dir);
    }
    controls.startOrbit(() => (selPosValid ? selPos : controls.position), dist, Math.max(radius * 1.5, 1e-9));
    controls.speed = Math.max(dist / 4, 1e-8);
  }
  // système stellaire résolu : étoile (sélectionnée sinon la plus proche) à moins de 0,05 pc (~10 000 UA)
  // le Soleil : système solaire réel si la caméra est à moins de 0,05 pc de sa position
  const sunDist = camPat.distanceTo(sunPos);
  let near = probe.selected && probe.selected.dist < 0.05 ? probe.selected : probe.nearest;
  if (sunDist < 0.05 && !(probe.selected && probe.selected.dist < sunDist)) {
    const age = state.time - (P.T_PRESENT - SUN_AGE);
    sunStar.dist = sunDist; sunStar.age = age; sunStar.birth = P.T_PRESENT - SUN_AGE;
    stellarState(1, age, sunStar.state);
    near = sunStar;
    probe.nearest = sunStar;
    if (!system || system.id !== SUN_ID || Math.abs(system.age - age) > 0.01) system = buildSolarSystem(state.time);
    su.uSkip.value.set(-1, -1, -1);
  } else if (near && near.dist < 0.05) {
    if (!system || system.id !== near.id || Math.abs(system.age - near.age) > 0) {
      const seedHash = (near.seed ^ Math.imul(near.bin + 1, 0x01000193) ^ Math.imul(near.index + 1, 0x9e3779b9)) >>> 0;
      system = buildSystem(near.id, seedHash, near.mass, near.age);
    }
    su.uSkip.value.set(near.seed, near.bin, near.index);
  } else { system = null; su.uSkip.value.set(-1, -1, -1); }
  // poids de la vue système : 1 à moins de 300 UA de l'étoile, 0 au-delà de 5 000 UA
  if (system && near) {
    const x = Math.min(1, Math.max(0, (near.dist / 4.848e-6 - 300) / 4700));
    sysW = 1 - x * x * (3 - 2 * x);
  } else sysW = 0;
  systemR.update(system, near ? near.pos : camPat, theta, controls.position, camera, viewRot, state.time, state.exposure, pixelScale, state.showOrbits, sysW);
  hud.updateLabels(systemR.bodies, camera, sysW);
  hud.update(state, camPat, probe, renderer.info, system);
  perfLog.push(performance.now() - now);
  if (perfLog.length > 2000) perfLog.splice(0, 1000);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
frame();
