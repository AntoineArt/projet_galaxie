// Côté principal : demande les reconstructions au worker et conserve le dernier résultat (même forme que LodBuilder
// pour les renderers : buckets, glow, stats, fluxMin, qTO, vis.data).
import * as THREE from 'three';
import type { BuildRequest, BuildResult } from './lod.worker';
import { NUM_BUCKETS, type LodStats } from './lod';
import { NBINS } from './bins';
import { VIS_NL } from './visq';

export class LodClient {
  buckets: { count: number; data: Float32Array<ArrayBufferLike> }[] = [];
  glow: { count: number; data: Float32Array<ArrayBufferLike> } = { count: 0, data: new Float32Array(0) };
  stats: LodStats = { nodes: 0, stars: 0, fluxMin: 0, iterations: 0, ms: 0, converged: false, nearest: 1e9 };
  fluxMin = 1e-6;
  qTO: Float32Array<ArrayBufferLike> = new Float32Array(NBINS);
  vis: { data: Float32Array<ArrayBufferLike> } = { data: new Float32Array(NBINS * VIS_NL) };
  budget = 1_500_000;
  ready = false;
  /** ancre et temps de référence des buffers courants */
  anchor = new THREE.Vector3();
  tRef = 0;
  onResult: ((r: BuildResult) => void) | null = null;
  private worker: Worker;
  private busy = false;
  private pending: BuildRequest | null = null;
  private nextId = 1;
  private readyPromise: Promise<void>;

  constructor() {
    for (let b = 0; b < NUM_BUCKETS; b++) this.buckets.push({ count: 0, data: new Float32Array(0) });
    this.worker = new Worker(new URL('./lod.worker.ts', import.meta.url), { type: 'module' });
    let resolveReady: () => void = () => {};
    this.readyPromise = new Promise((r) => { resolveReady = r; });
    this.worker.onmessage = (e: MessageEvent<BuildResult | { type: 'ready' }>) => {
      const m = e.data;
      if (m.type === 'ready') { this.ready = true; resolveReady(); return; }
      this.buckets = m.buckets;
      this.glow = m.glow;
      this.stats = m.stats;
      this.fluxMin = m.fluxMin;
      this.qTO = m.qTO;
      this.vis.data = m.vis;
      this.anchor.fromArray(m.anchor);
      this.tRef = m.tRef;
      this.busy = false;
      this.onResult?.(m);
      if (this.pending) { const p = this.pending; this.pending = null; this.send(p); }
    };
  }

  whenReady(): Promise<void> { return this.readyPromise; }

  get inFlight(): boolean { return this.busy || this.pending !== null; }

  /** demande une reconstruction ; si une est en cours, la dernière demande remplace la précédente en attente */
  request(camPat: THREE.Vector3, theta: number, anchor: THREE.Vector3, tRef: number, projView: THREE.Matrix4): void {
    const req: BuildRequest = {
      type: 'build', id: this.nextId++, camPat: [camPat.x, camPat.y, camPat.z], theta,
      anchor: [anchor.x, anchor.y, anchor.z], tRef, projView: new Float32Array(projView.elements), budget: this.budget,
      now: performance.now() / 1000,
    };
    if (this.busy) { this.pending = req; return; }
    this.send(req);
  }

  private send(req: BuildRequest): void {
    this.busy = true;
    this.worker.postMessage(req, [req.projView.buffer]);
  }
}
