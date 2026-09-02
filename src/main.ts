import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as P from './galaxy/params';
import { Grid } from './galaxy/grid';
import { FLOATS_PER_INSTANCE, LodBuilder } from './galaxy/lod';
import { StarRenderer } from './render/stars';
import { FarField } from './render/farfield';
import { FlyControls } from './controls';
import { Hud } from './ui/hud';
import { ExposurePass } from './render/exposure';
import { Probe } from './galaxy/probe';
import { Objects } from './render/objects';
import { GlowRenderer } from './render/glow';
import { Population } from './galaxy/population';
import { SystemRenderer } from './render/system';
import { buildSystem, type StarSystem } from './galaxy/system';

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.autoClear = true;
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 1e-7, 5e5); // near = 0,02 UA : pas de test de profondeur, seule la coupure compte
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
const lod = new LodBuilder(grid, pop);
const stars = new StarRenderer();
const glow = new GlowRenderer();
const far = new FarField(grid, pop);
const objects = new Objects(grid);
const systemR = new SystemRenderer();
scene.add(far.group, glow.mesh, stars.group, objects.group, systemR.group);
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
(window as unknown as { galaxy: unknown }).galaxy = { state, lod, stars, far, objects, glow, probe: null as unknown, systemR: null as unknown, camera, THREE, P, controls: null as unknown };
const controls = new FlyControls(renderer.domElement);
(window as unknown as { galaxy: { controls: unknown } }).galaxy.controls = controls;
controls.position.set(P.SUN_POS.x, P.SUN_POS.y, P.SUN_POS.z);
controls.lookAt(new THREE.Vector3(0, 0, 0));
const hud = new Hud(state, lod, far, controls);
const probe = new Probe(grid, lod);
(window as unknown as { galaxy: { probe: unknown; systemR: unknown } }).galaxy.probe = probe;
(window as unknown as { galaxy: { probe: unknown; systemR: unknown } }).galaxy.systemR = systemR;

// --- rebuild LOD
const anchor = new THREE.Vector3();
const camPat = new THREE.Vector3();
const lastCamPat = new THREE.Vector3(1e9, 0, 0);
const lastQuat = new THREE.Quaternion();
let tRef = state.time;
const cullCam = new THREE.PerspectiveCamera(60, 1, 1e-7, 5e5);
const projView = new THREE.Matrix4();
const viewRot = new THREE.Matrix4();

function needRebuild(): boolean {
  const smallest = lod.stats.nodes > 0 ? smallestNode : 64;
  const moved = camPat.distanceTo(lastCamPat);
  if (moved > Math.max(0.3, 0.04 * smallest)) return true;
  // les phases de dérive et les tables de population restent valables sur ~0.4 % de l'âge courant
  if (Math.abs(state.time - tRef) > Math.max(0.5, 0.004 * state.time)) return true;
  if (controls.quaternion.angleTo(lastQuat) > 0.08) return true;
  if (lod.budget !== state.budget || !lod.stats.converged) return true;
  return false;
}
let smallestNode = 64;

function rebuild(theta: number): void {
  anchor.copy(camPat);
  tRef = state.time;
  lod.budget = state.budget;
  // frustum élargi pour le culling
  cullCam.fov = Math.min(170, camera.fov + 25);
  cullCam.aspect = camera.aspect;
  cullCam.quaternion.copy(controls.quaternion);
  cullCam.position.set(0, 0, 0);
  cullCam.updateMatrixWorld();
  cullCam.updateProjectionMatrix();
  projView.multiplyMatrices(cullCam.projectionMatrix, cullCam.matrixWorldInverse);
  lod.build(camPat, theta, anchor, tRef, projView);
  stars.upload(lod);
  glow.upload(lod);
  smallestNode = 1e9;
  for (let b = 0; b < lod.buckets.length; b++) {
    const bk = lod.buckets[b];
    for (let i = 0; i < bk.count; i++) smallestNode = Math.min(smallestNode, bk.data[i * FLOATS_PER_INSTANCE + 3]);
  }
  if (smallestNode === 1e9) smallestNode = 64;
  lastCamPat.copy(camPat);
  lastQuat.copy(controls.quaternion);
}

// --- boucle
let last = performance.now();
const anchorRel = new THREE.Vector3();
function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (!state.paused) state.time = Math.max(0, state.time + state.timeSpeed * dt);
  controls.update(dt);
  hud.handleKeys(controls, probe);

  const theta = P.PATTERN_OMEGA * state.time;
  const c = Math.cos(-theta), s = Math.sin(-theta);
  const p = controls.position;
  camPat.set(c * p.x - s * p.y, s * p.x + c * p.y, p.z);

  camera.quaternion.copy(controls.quaternion);
  camera.updateMatrixWorld();
  viewRot.copy(camera.matrixWorldInverse);
  const pixelScale = (renderer.domElement.height / 2) / Math.tan((camera.fov * Math.PI) / 360);

  if (needRebuild()) rebuild(theta);

  exposurePass.enabled = state.autoExposure;
  exposurePass.target = system ? 0.025 : 0.12; // près d'une étoile : ciel éblouissant, exposition réduite
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
  (su.uQTO.value as Float32Array).set(lod.qTO);
  su.uExposure.value = state.exposure;
  su.uPixelScale.value = pixelScale;

  far.setTime(state.time);
  const fu = far.starMat.uniforms;
  fu.uProj.value.copy(camera.projectionMatrix);
  fu.uView.value.copy(viewRot);
  fu.uCamPat.value.copy(camPat);
  fu.uTheta.value = theta;
  fu.uFluxMin.value = lod.fluxMin;
  fu.uExposure.value = state.exposure;
  fu.uPixelScale.value = pixelScale;
  const du = far.dustMat.uniforms;
  du.uProj.value.copy(camera.projectionMatrix);
  du.uView.value.copy(viewRot);
  du.uCamPat.value.copy(camPat);
  du.uTheta.value = theta;
  du.uPixelScale.value = pixelScale;
  far.group.children[0].visible = state.showFar;
  far.group.children[1].visible = state.showDust;

  objects.update(camera, viewRot, camPat, theta, state.time, state.exposure, pixelScale);
  const gu = glow.material.uniforms;
  gu.uProj.value.copy(camera.projectionMatrix);
  gu.uView.value.copy(viewRot);
  gu.uCamPat.value.copy(camPat);
  gu.uTheta.value = theta;
  gu.uExposure.value = state.exposure;
  gu.uPixelScale.value = pixelScale;
  gu.uDustOn.value = state.showDust ? 1 : 0;
  glow.mesh.visible = state.showFar && lod.glow.count > 0;

  bloom.strength = state.bloom;
  renderer.info.reset();
  composer.render();
  probe.update(camPat, theta, state.time, now);
  // système stellaire résolu : étoile la plus proche à moins de 0,05 pc (~10 000 UA)
  const near = probe.nearest;
  if (near && near.dist < 0.05) {
    if (!system || system.id !== near.id || Math.abs(system.age - near.age) > 0) {
      const seedHash = (near.seed ^ Math.imul(near.bin + 1, 0x01000193) ^ Math.imul(near.index + 1, 0x9e3779b9)) >>> 0;
      system = buildSystem(near.id, seedHash, near.mass, near.age);
    }
    su.uSkip.value.set(near.seed, near.bin, near.index);
  } else { system = null; su.uSkip.value.set(-1, -1, -1); }
  systemR.update(system, near ? near.pos : camPat, theta, controls.position, camera, viewRot, state.time, state.exposure, pixelScale, state.showOrbits);
  hud.update(state, camPat, probe, renderer.info, system);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
frame();
