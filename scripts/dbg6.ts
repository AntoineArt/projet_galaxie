import * as THREE from 'three';
import { Grid } from '../src/galaxy/grid';
import { LodBuilder, FLOATS_PER_INSTANCE } from '../src/galaxy/lod';
import { Population } from '../src/galaxy/population';
import { NBINS, binCounts, birthInBin, binMassQuantile, isThinOld } from '../src/galaxy/bins';
import { imfInv, stellarState } from '../src/galaxy/stellar';
import { armFactor } from '../src/galaxy/density';
import { YOUNG_ARM, YOUNG_BASE } from '../src/galaxy/bins';
const g = new Grid();
const lod = new LodBuilder(g, new Population());
const cam = new THREE.PerspectiveCamera(85, 1.6, 1e-7, 5e5);
cam.position.set(0,0,0); cam.lookAt(new THREE.Vector3(0,0,-1)); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
const pv = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
const camPat = new THREE.Vector3(0,0,45000);
lod.budget = 1.5e6;
for (let k = 0; k < 5; k++) lod.build(camPat, 0, camPat.clone(), 13000, pv);
lod.build(camPat, 0, camPat.clone(), 13000, pv);
const time = 13000;
function hashu(x: number): number { x = x >>> 0; x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0; x ^= x >>> 16; return x >>> 0; }
const rnd = (h: number) => (h & 0xffffff) / 16777216;
const nb = new Float64Array(NBINS);
function emulate(qx: number, qy: number, qz: number) {
  for (let b = 0; b < lod.buckets.length; b++) { const bk = lod.buckets[b]; for (let i = 0; i < bk.count; i++) { const o = i * FLOATS_PER_INSTANCE; const x0 = bk.data[o] + camPat.x, y0 = bk.data[o+1] + camPat.y, z0 = bk.data[o+2] + camPat.z, s = bk.data[o+3];
    if (!(qx >= x0 && qx < x0 + s && qy >= y0 && qy < y0 + s && qz >= z0 && qz < z0 + s)) continue;
    const seed = bk.data[o+4], y = bk.data[o+9], visIdx = bk.data[o+10], armMaxRaw = bk.data[o+19];
    const armMax = armMaxRaw >= 2 ? armMaxRaw - 2 : armMaxRaw;
    binCounts(bk.data[o+5], bk.data[o+6], bk.data[o+7], bk.data[o+8], y, nb);
    let total = 0, drawn = 0, cullL = 0, cullFlux = 0, cullArm = 0;
    const reasons: string[] = [];
    for (let c = 0; c < NBINS; c++) {
      const n = nb[c]; if (n <= 0) continue;
      const a = Math.floor(n * lod.qTO[c]); const bb = Math.floor(n * lod.vis.qVis(c, visIdx) + 0.5);
      for (let j = a; j < bb; j++) {
        total++;
        const i = (j + Math.imul(c, 0x01000193)) >>> 0;
        const base = hashu(seed ^ (Math.imul(i, 0x9e3779b9) >>> 0));
        const r0 = rnd(hashu(base + 1)), r5 = rnd(hashu(base + 6)), r6 = rnd(hashu(base + 7)), r2 = rnd(hashu(base + 3)), r3 = rnd(hashu(base + 4));
        const q = binMassQuantile(c, 1 - (j + r0) / n);
        const m = imfInv(Math.min(Math.max(q, 1e-7), 1 - 1e-7));
        const tb = birthInBin(c, time, r6 * 0.9999);
        const st = stellarState(m, time - tb, { L: 0, T: 0, phase: 0, radius: 0 });
        if (st.L <= 0) { cullL++; continue; }
        const px = x0 + r2 * s, py = y0 + r3 * s;
        if (c >= 21) { const af = armFactor(Math.hypot(px, py), Math.atan2(py, px)); if (r5 > (YOUNG_BASE + YOUNG_ARM * af) / (YOUNG_BASE + YOUNG_ARM * armMax)) { cullArm++; continue; } }
        const d2 = (px - camPat.x) ** 2 + (py - camPat.y) ** 2 + (z0 + s / 2 - camPat.z) ** 2;
        if (st.L / d2 < lod.fluxMin * 0.5) { cullFlux++; continue; }
        drawn++;
        if (reasons.length < 3) reasons.push(`c${c} m=${m.toFixed(1)} L=${st.L.toExponential(1)} ph=${st.phase}`);
      }
    }
    console.log(`node (${x0},${y0},${z0}) s=${s} K=2^${b} total=${total} drawn=${drawn} cullL=${cullL} cullFlux=${cullFlux} cullArm=${cullArm} y=${y.toFixed(3)} armMax=${armMax.toFixed(2)} visIdx=${visIdx}`, reasons.join(' ; '));
  } }
}
emulate(-6100, -4100, 0);
emulate(-6100, -4100, 700);
emulate(-5000, -5500, 0);
emulate(-7000, -3000, 0);
console.log('fluxMin', lod.fluxMin, 'qTO young', Array.from(lod.qTO.slice(21)).map(v=>v.toExponential(2)).join(' '));
