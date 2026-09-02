import * as THREE from 'three';
import { Grid } from '../src/galaxy/grid';
import { LodBuilder, FLOATS_PER_INSTANCE } from '../src/galaxy/lod';
import { Population } from '../src/galaxy/population';
const g = new Grid();
const lod = new LodBuilder(g, new Population());
const cam = new THREE.PerspectiveCamera(85, 1.6, 1e-7, 5e5);
cam.position.set(0,0,0); cam.lookAt(new THREE.Vector3(0,0,-1)); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
const pv = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
const camPat = new THREE.Vector3(0,0,45000);
lod.budget = 1.5e6;
for (let k = 0; k < 5; k++) lod.build(camPat, 0, camPat.clone(), 13000, pv);
const st = lod.build(camPat, 0, camPat.clone(), 13000, pv);
console.log('stars', st.stars.toExponential(2), 'nodes', st.nodes, 'fluxMin', st.fluxMin.toExponential(2));
// noeuds couvrant (x,y) donnés
for (const [qx, qy] of [[-2600, -6500], [-4000, -5000], [2000, 8000], [-6000, 0]]) {
  const hits: string[] = [];
  for (let b = 0; b < lod.buckets.length; b++) { const bk = lod.buckets[b]; for (let i = 0; i < bk.count; i++) { const o = i * FLOATS_PER_INSTANCE; const x0 = bk.data[o], y0 = bk.data[o+1], z0 = bk.data[o+2], s = bk.data[o+3];
    if (qx >= x0 && qx < x0 + s && qy >= y0 && qy < y0 + s) hits.push(`z0=${z0} s=${s} K~2^${b} N=${(bk.data[o+5]+bk.data[o+6]+bk.data[o+7]+bk.data[o+8]).toExponential(1)} y=${bk.data[o+9].toFixed(3)} arm=${bk.data[o+19].toFixed(2)}`); } }
  console.log(qx, qy, hits.length, hits.slice(0, 6).join(' | '));
}
