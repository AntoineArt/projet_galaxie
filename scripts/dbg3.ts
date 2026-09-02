import * as THREE from 'three';
import { Grid } from '../src/galaxy/grid';
import { LodBuilder } from '../src/galaxy/lod';
const g = new Grid();
const lod = new LodBuilder(g);
const cam = new THREE.PerspectiveCamera(85, 1.6, 0.001, 5e5);
function run(pos: number[], look: number[], t = 13000) {
  cam.position.set(0,0,0); cam.lookAt(new THREE.Vector3(look[0]-pos[0], look[1]-pos[1], look[2]-pos[2])); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const pv = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const camPat = new THREE.Vector3(pos[0], pos[1], pos[2]);
  lod.budget = 1.5e6;
  for (let k = 0; k < 6; k++) lod.build(camPat, 0, camPat.clone(), t, pv);
  const t0 = performance.now();
  const st = lod.build(camPat, 0, camPat.clone(), t, pv);
  console.log(pos, 't', t, 'fluxMin', st.fluxMin.toExponential(2), 'stars', st.stars.toExponential(2), 'nodes', st.nodes, 'ms', (performance.now()-t0).toFixed(1), 'it', st.iterations);
}
run([-8200,0,20],[0,0,0]);
run([-8200,0,20],[-16000,0,0]);
run([-9000,-32000,22000],[0,0,0]);
run([0,0,45000],[0,0,0]);
run([-100,0,0],[0,0,0]);
run([-8200,0,20],[0,0,0], 2000);
run([-8200,0,20],[0,0,0], 8000);
{
  const camPat = new THREE.Vector3(-8200,0,20);
  cam.lookAt(new THREE.Vector3(8200,0,-20)); cam.updateMatrixWorld();
  const pv = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  lod.build(camPat, 0, camPat.clone(), 13000, pv);
  const byD = new Map<number, {n:number,k:number}>();
  for (let b=0;b<lod.buckets.length;b++){ const bk=lod.buckets[b]; for(let i=0;i<bk.count;i++){ const o=i*20; const s=bk.data[o+3]; const cx=bk.data[o]+s/2, cy=bk.data[o+1]+s/2, cz=bk.data[o+2]+s/2; const d=Math.sqrt(cx*cx+cy*cy+cz*cz); const key=Math.floor(Math.log10(Math.max(d,1))*2)/2; const e=byD.get(key)??{n:0,k:0}; e.n++; e.k+= (1<<b); byD.set(key,e);} }
  console.log('K (bucket size) par log10(d):', [...byD.entries()].sort((a,b)=>a[0]-b[0]).map(([k,e])=>`${k}:${e.n}n/${e.k.toExponential(1)}`).join('  '));
  console.log('qTO', Array.from(lod.qTO).map(v=>v.toExponential(1)).join(' '));
}
