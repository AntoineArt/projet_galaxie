import * as THREE from 'three';
import { Grid } from '../src/galaxy/grid';
import { LodBuilder } from '../src/galaxy/lod';
import { Population } from '../src/galaxy/population';
const g = new Grid();
const lod = new LodBuilder(g, new Population());
const cam = new THREE.PerspectiveCamera(85, 1.6, 1e-7, 5e5);
const pos = [-9000, -32000, 22000];
cam.position.set(0,0,0); cam.lookAt(new THREE.Vector3(-pos[0], -pos[1], -pos[2])); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
const pv = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
const camPat = new THREE.Vector3(pos[0], pos[1], pos[2]);
lod.budget = 1.5e6;
for (const t of [800, 800, 800, 800, 800, 800]) {
  const st = lod.build(camPat, 0, camPat.clone(), t, pv);
  console.log('t', t, 'fluxMin', st.fluxMin.toExponential(2), 'next', (lod as any).fluxMinNext.toExponential(2), 'stars', st.stars.toExponential(2), 'nodes', st.nodes, 'it', st.iterations, 'ms', st.ms.toFixed(0));
}
