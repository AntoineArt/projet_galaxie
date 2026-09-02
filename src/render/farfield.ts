// Champ lointain : nuage de points agrégés (population moyenne) + poussière multiplicative.
import * as THREE from 'three';
import farVert from './shaders/far.vert.glsl?raw';
import starFrag from './shaders/star.frag.glsl?raw';
import dustVert from './shaders/dust.vert.glsl?raw';
import dustFrag from './shaders/dust.frag.glsl?raw';
import { vertexShader, fragmentShader, dustUniforms } from './shaderlib';
import { Grid, NC } from '../galaxy/grid';
import { density, dustDensity } from '../galaxy/density';
import * as P from '../galaxy/params';
import { buildKeepTable, buildPopTable, samplePop, youngPopMean, KEEP_LOGMAX, KEEP_LOGMIN, KEEP_NL, type PopTable } from '../galaxy/stellar';
import { YOUNG_ARM, YOUNG_BASE, diskRamp } from '../galaxy/bins';

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class FarField {
  group = new THREE.Group();
  starMat: THREE.RawShaderMaterial;
  dustMat: THREE.RawShaderMaterial;
  nPoints: number;
  totalStars: number;
  private pop: PopTable[] = [];
  private keep!: ReturnType<typeof buildKeepTable>;
  private popTmp = new Float32Array(4);

  constructor(grid: Grid, nPoints = 1_200_000, nDust = 220_000) {
    const t0 = performance.now();
    this.nPoints = nPoints;
    this.totalStars = grid.totals.reduce((a, b) => a + b, 0);
    const rng = mulberry(1234567);
    const L = grid.levels[P.GRID_LEVEL];
    // CDF sur les cellules
    const ncell = L.n * L.n * L.nz;
    const cdf = new Float64Array(ncell);
    let acc = 0;
    for (let c = 0; c < ncell; c++) { const o = c * 5; acc += L.data[o] + L.data[o + 1] + L.data[o + 2] + L.data[o + 3]; cdf[c] = acc; }
    const pos = new Float32Array(nPoints * 3);
    const w = new Float32Array(nPoints);
    const comp = new Float32Array(nPoints);
    const arm = new Float32Array(nPoints);
    const d = new Float64Array(5);
    const vol = L.size ** 3;
    for (let k = 0; k < nPoints; k++) {
      // échantillonnage stratifié des cellules
      const u = ((k + rng()) / nPoints) * acc;
      let lo = 0, hi = ncell - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < u) lo = mid + 1; else hi = mid; }
      const c = lo;
      const iz = c % L.nz, iy = ((c - iz) / L.nz) % L.n, ix = Math.floor(c / (L.nz * L.n));
      const x = -P.ROOT_HALF + (ix + rng()) * L.size;
      const y = -P.ROOT_HALF + (iy + rng()) * L.size;
      const z = -P.ROOT_HALF + (iz + L.z0 + rng()) * L.size;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      const o = c * 5;
      const cellTotal = L.data[o] + L.data[o + 1] + L.data[o + 2] + L.data[o + 3];
      density(x, y, z, d);
      let rho = 0;
      for (let i = 0; i < NC; i++) rho += d[i] * grid.scale[i];
      w[k] = Math.min(rho / (cellTotal / vol), 6);
      // composante
      const r = rng() * cellTotal;
      comp[k] = r < L.data[o] ? 0 : r < L.data[o] + L.data[o + 1] ? 1 : r < L.data[o] + L.data[o + 1] + L.data[o + 2] ? 2 : 3;
      arm[k] = d[4];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aW', new THREE.BufferAttribute(w, 1));
    geo.setAttribute('aComp', new THREE.BufferAttribute(comp, 1));
    geo.setAttribute('aArm', new THREE.BufferAttribute(arm, 1));

    // tables de population
    for (const c of P.COMPONENTS) this.pop.push(buildPopTable(c));
    const young = youngPopMean();
    const keep = buildKeepTable();
    this.keep = keep;
    const keepTex = new THREE.DataTexture(keep.data, KEEP_NL, keep.rows, THREE.RedFormat, THREE.FloatType);
    keepTex.minFilter = keepTex.magFilter = THREE.LinearFilter;
    keepTex.needsUpdate = true;

    this.starMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertexShader(farVert),
      fragmentShader: fragmentShader(starFrag),
      uniforms: {
        uProj: { value: new THREE.Matrix4() },
        uView: { value: new THREE.Matrix4() },
        uCamPat: { value: new THREE.Vector3() },
        uTheta: { value: 0 },
        uNrep: { value: this.totalStars / nPoints },
        ...dustUniforms(),
        uPopL: { value: new THREE.Vector4() },
        uPopRGB: { value: new THREE.Matrix4() },
        uYoungL: { value: young.L },
        uYoungRGB: { value: new THREE.Vector3(...young.rgb) },
        uFluxMin: { value: 1e-6 },
        uExposure: { value: 1 },
        uKeep: { value: keepTex },
        uLumRange: { value: new THREE.Vector2(KEEP_LOGMIN, KEEP_LOGMAX) },
        uKeepT: { value: new THREE.Vector3(0, keep.nT, keep.rows) },
        uPointBase: { value: 1.5 },
        uMaxSize: { value: 96 },
        uCellRadius: { value: 160 },
        uPixelScale: { value: 1000 },
        uYoung: { value: new THREE.Vector2(YOUNG_BASE, YOUNG_ARM) },
      },
      blending: THREE.AdditiveBlending,
      depthTest: false, depthWrite: false, transparent: true,
    });
    const pts = new THREE.Points(geo, this.starMat);
    pts.frustumCulled = false;
    pts.renderOrder = 1;
    this.group.add(pts);

    // poussière : rejet sur la densité analytique
    const dpos = new Float32Array(nDust * 3);
    const dw = new Float32Array(nDust);
    let dmax = 0;
    for (let i = 0; i < 20000; i++) {
      const x = (rng() * 2 - 1) * 18000, y = (rng() * 2 - 1) * 18000, z = (rng() * 2 - 1) * 400;
      dmax = Math.max(dmax, dustDensity(x, y, z));
    }
    dmax *= 1.3;
    let k = 0, tries = 0;
    while (k < nDust && tries < nDust * 200) {
      tries++;
      const x = (rng() * 2 - 1) * 18000, y = (rng() * 2 - 1) * 18000, z = (rng() * 2 - 1) * 500;
      const rho = dustDensity(x, y, z);
      if (rng() * dmax < rho) { dpos[k * 3] = x; dpos[k * 3 + 1] = y; dpos[k * 3 + 2] = z; dw[k] = 0.6 + 0.8 * rng(); k++; }
    }
    const dgeo = new THREE.BufferGeometry();
    dgeo.setAttribute('position', new THREE.BufferAttribute(dpos.subarray(0, k * 3), 3));
    dgeo.setAttribute('aW', new THREE.BufferAttribute(dw.subarray(0, k), 1));
    this.dustMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertexShader(dustVert),
      fragmentShader: fragmentShader(dustFrag),
      uniforms: {
        uProj: { value: new THREE.Matrix4() },
        uView: { value: new THREE.Matrix4() },
        uCamPat: { value: new THREE.Vector3() },
        uTheta: { value: 0 },
        uPixelScale: { value: 1000 },
        uMaxSize: { value: 64 },
        uRadius: { value: 90 },
        uOpacity: { value: 0.15 },
        uTint: { value: new THREE.Color(0.55, 0.3, 0.18) },
      },
      blending: THREE.CustomBlending,
      blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      depthTest: false, depthWrite: false, transparent: true,
    });
    const dust = new THREE.Points(dgeo, this.dustMat);
    dust.frustumCulled = false;
    dust.renderOrder = 2;
    this.group.add(dust);
    console.log(`champ lointain ${nPoints} pts + ${k} poussière en ${(performance.now() - t0).toFixed(0)} ms`);
  }

  /** met à jour les luminosités moyennes de population à l'instant t */
  setTime(t: number): void {
    const u = this.starMat.uniforms;
    const L = u.uPopL.value as THREE.Vector4;
    const M = u.uPopRGB.value as THREE.Matrix4;
    const e = M.elements;
    const kt = u.uKeepT.value as THREE.Vector3;
    kt.x = Math.min(Math.max((t - this.keep.t0) / this.keep.dt, 0), this.keep.nT - 1.001);
    (u.uYoung.value as THREE.Vector2).set(YOUNG_BASE * diskRamp(t), YOUNG_ARM * diskRamp(t));
    for (let c = 0; c < 4; c++) {
      samplePop(this.pop[c], t, this.popTmp);
      L.setComponent(c, this.popTmp[0]);
      e[c * 4] = this.popTmp[1]; e[c * 4 + 1] = this.popTmp[2]; e[c * 4 + 2] = this.popTmp[3]; e[c * 4 + 3] = 1;
    }
  }
}
