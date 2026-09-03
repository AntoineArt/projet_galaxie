// Worker : parcours de l'octree hors du thread principal.
import * as THREE from 'three';
import { Grid } from './grid';
import { Population } from './population';
import { LodBuilder, FLOATS_PER_INSTANCE, GLOW_FLOATS } from './lod';

export interface BuildRequest {
  type: 'build';
  id: number;
  camPat: [number, number, number];
  theta: number;
  anchor: [number, number, number];
  tRef: number;
  projView: Float32Array;
  budget: number;
  now: number; // performance.now() du thread principal, en secondes
}
export interface BuildResult {
  type: 'result';
  id: number;
  anchor: [number, number, number];
  tRef: number;
  buckets: { count: number; data: Float32Array }[];
  glow: { count: number; data: Float32Array };
  stats: LodBuilder['stats'];
  fluxMin: number;
  qTO: Float32Array;
  vis: Float32Array;
}

const grid = new Grid();
const lod = new LodBuilder(grid, new Population());
const camPat = new THREE.Vector3(), anchor = new THREE.Vector3(), pv = new THREE.Matrix4();

self.onmessage = (e: MessageEvent<BuildRequest>) => {
  const m = e.data;
  if (m.type !== 'build') return;
  camPat.fromArray(m.camPat); anchor.fromArray(m.anchor); pv.fromArray(m.projView);
  lod.budget = m.budget;
  const stats = lod.build(camPat, m.theta, anchor, m.tRef, pv, m.now);
  const transfer: ArrayBuffer[] = [];
  const buckets = lod.buckets.map((b) => {
    const data = b.data.slice(0, b.count * FLOATS_PER_INSTANCE);
    transfer.push(data.buffer);
    return { count: b.count, data };
  });
  const glowData = lod.glow.data.slice(0, lod.glow.count * GLOW_FLOATS);
  transfer.push(glowData.buffer);
  const qTO = lod.qTO.slice(), vis = lod.vis.data.slice();
  transfer.push(qTO.buffer, vis.buffer);
  const res: BuildResult = { type: 'result', id: m.id, anchor: m.anchor, tRef: m.tRef, buckets, glow: { count: lod.glow.count, data: glowData }, stats: { ...stats }, fluxMin: lod.fluxMin, qTO, vis };
  (self as unknown as Worker).postMessage(res, transfer);
};
(self as unknown as Worker).postMessage({ type: 'ready' });
