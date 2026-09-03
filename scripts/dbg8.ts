import * as THREE from 'three';
import { Grid } from '../src/galaxy/grid';
import { LodBuilder, FLOATS_PER_INSTANCE } from '../src/galaxy/lod';
import { Population } from '../src/galaxy/population';
const g = new Grid();
const lod = new LodBuilder(g, new Population());
const cam = new THREE.PerspectiveCamera(85, 1.6, 1e-7, 5e5);
cam.position.set(0,0,0); cam.lookAt(new THREE.Vector3(1,0,0)); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
const pv = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
lod.budget = 1.5e6;
function count(label: string) {
  let stable = 0, incoming = 0, outgoing = 0, vIn = 0, vOut = 0;
  for (let b = 0; b < lod.buckets.length; b++) { const bk = lod.buckets[b]; for (let i = 0; i < bk.count; i++) { const born = bk.data[i * FLOATS_PER_INSTANCE + 11]; if (born < 0) { outgoing++; vOut += 1 << b; } else if (born === lod['lastNow']) { incoming++; vIn += 1 << b; } else stable++; } }
  console.log(label.padEnd(28), 'stable', stable, 'incoming', incoming, `(${vIn} v)`, 'outgoing', outgoing, `(${vOut} v)`, 'stars', lod.stats.stars);
}
let now = 0;
const run = (x: number, y: number, z: number, label: string) => { now += 1; (lod as any).lastNow = now; const c = new THREE.Vector3(x, y, z); lod.build(c, 0, c.clone(), 13000, pv, now); count(label); };
run(-8200, 0, 20, 'initial');
run(-8200, 0, 20, 'same position');
run(-8199, 0, 20, 'moved 1 pc');
run(-8190, 0, 20, 'moved 9 pc more');
run(-8150, 0, 20, 'moved 40 pc more');
run(-7800, 0, 20, 'moved 350 pc more');
