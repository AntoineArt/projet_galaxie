// Worker : parcours de l'octree hors du thread principal.
import * as THREE from 'three';
import { Grid } from './grid';
import { Population } from './population';
import { LodBuilder, FLOATS_PER_INSTANCE, GLOW_FLOATS } from './lod';
import { Probe, type NearStar } from './probe';
import { PHASE } from './stellar';

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

/** requêtes de sonde (recherche d'étoiles) : exécutées dans le worker pour ne jamais bloquer le rendu */
export type ProbeRequest =
  | { type: 'nearest'; id: number; camPat: [number, number, number]; time: number }
  | { type: 'pick'; id: number; camPat: [number, number, number]; dirPat: [number, number, number]; time: number; fluxMin: number }
  | { type: 'find'; id: number; camPat: [number, number, number]; time: number; pred: string; ring: number };
export type StarWire = Omit<NearStar, 'pos'> & { pos: [number, number, number] };
export type ProbeResult = { type: 'probe'; id: number; kind: ProbeRequest['type']; star: StarWire | null; within10pc: number; nodeStars: number };

export const FIND_PREDS: Record<string, (st: { phase: number; L: number }, m: number) => boolean> = {
  bh: (st) => st.phase === PHASE.BLACK_HOLE,
  ns: (st) => st.phase === PHASE.NEUTRON_STAR,
  wd: (st) => st.phase === PHASE.WHITE_DWARF,
  giant: (st) => st.phase === PHASE.GIANT || st.phase === PHASE.SUPERGIANT,
  pn: (st) => st.phase === PHASE.PLANETARY_NEBULA,
  sn: (st) => st.phase === PHASE.SUPERNOVA,
  bd: (st) => st.phase === PHASE.BROWN_DWARF,
  massive: (st, m) => m > 8 && st.phase <= PHASE.SUPERGIANT && st.phase >= PHASE.MAIN_SEQUENCE,
};

const grid = new Grid();
const lod = new LodBuilder(grid, new Population());
const probe = new Probe(lod);
const camPat = new THREE.Vector3(), anchor = new THREE.Vector3(), pv = new THREE.Matrix4(), dirPat = new THREE.Vector3();
const wire = (s: NearStar | null): StarWire | null => (s ? { ...s, pos: [s.pos.x, s.pos.y, s.pos.z] } : null);

self.onmessage = (e: MessageEvent<BuildRequest | ProbeRequest>) => {
  const m = e.data;
  if (m.type === 'nearest') {
    camPat.fromArray(m.camPat);
    probe.update(camPat, m.time, 1e12);
    const res: ProbeResult = { type: 'probe', id: m.id, kind: 'nearest', star: wire(probe.nearest), within10pc: probe.within10pc, nodeStars: probe.nodeStars };
    (self as unknown as Worker).postMessage(res);
    return;
  }
  if (m.type === 'pick') {
    camPat.fromArray(m.camPat); dirPat.fromArray(m.dirPat);
    const star = probe.pick(camPat, dirPat, m.time, m.fluxMin);
    (self as unknown as Worker).postMessage({ type: 'probe', id: m.id, kind: 'pick', star: wire(star), within10pc: 0, nodeStars: 0 } as ProbeResult);
    return;
  }
  if (m.type === 'find') {
    camPat.fromArray(m.camPat);
    const pred = FIND_PREDS[m.pred];
    const star = pred ? probe.findNearest(camPat, m.time, pred, 1) ?? probe.findNearest(camPat, m.time, pred, m.ring) : null;
    (self as unknown as Worker).postMessage({ type: 'probe', id: m.id, kind: 'find', star: wire(star), within10pc: 0, nodeStars: 0 } as ProbeResult);
    return;
  }
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
