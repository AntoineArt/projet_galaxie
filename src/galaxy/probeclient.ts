// Côté principal : les recherches d'étoiles (plus proche, visée, remarquables) tournent dans le worker LOD ;
// le suivi de la sélection reste local et O(1) (starById).
import * as THREE from 'three';
import type { ProbeRequest, ProbeResult, StarWire } from './lod.worker';
import { Probe, type NearStar } from './probe';
import type { LodBuilder } from './lod';
import type { LodClient } from './lodclient';

export class ProbeClient {
  nearest: NearStar | null = null;
  selected: NearStar | null = null;
  within10pc = 0;
  nodeStars = 0;
  private local: Probe;
  private nextId = 1;
  private pending = new Map<number, (r: ProbeResult) => void>();
  private nearestInFlight = false;
  private lastNearest = -1e9;

  constructor(lodLocal: LodBuilder, private lod: LodClient) {
    this.local = new Probe(lodLocal);
    lod.onProbeResult = (r) => { const cb = this.pending.get(r.id); if (cb) { this.pending.delete(r.id); cb(r); } };
  }

  private static unwire(s: StarWire | null): NearStar | null {
    return s ? { ...s, pos: new THREE.Vector3(s.pos[0], s.pos[1], s.pos[2]) } : null;
  }

  private request(req: Record<string, unknown>): Promise<ProbeResult> {
    const id = this.nextId++;
    return new Promise((resolve) => { this.pending.set(id, resolve); this.lod.postProbe({ ...req, id } as unknown as ProbeRequest); });
  }

  /** étoile la plus proche, rafraîchie toutes les 250 ms (asynchrone) */
  update(camPat: THREE.Vector3, time: number, now: number): void {
    if (this.nearestInFlight || now - this.lastNearest < 250) return;
    this.nearestInFlight = true; this.lastNearest = now;
    this.request({ type: 'nearest', camPat: [camPat.x, camPat.y, camPat.z], time }).then((r) => {
      this.nearestInFlight = false;
      this.nearest = ProbeClient.unwire(r.star);
      this.within10pc = r.within10pc; this.nodeStars = r.nodeStars;
    });
  }

  refreshSelected(camPat: THREE.Vector3, time: number): void {
    this.local.selected = this.selected;
    this.local.refreshSelected(camPat, time);
    this.selected = this.local.selected;
  }

  async pick(camPat: THREE.Vector3, dirPat: THREE.Vector3, time: number, fluxMin: number): Promise<NearStar | null> {
    const r = await this.request({ type: 'pick', camPat: [camPat.x, camPat.y, camPat.z], dirPat: [dirPat.x, dirPat.y, dirPat.z], time, fluxMin });
    this.selected = ProbeClient.unwire(r.star);
    return this.selected;
  }

  async findNearest(camPat: THREE.Vector3, time: number, pred: string, ring = 2): Promise<NearStar | null> {
    const r = await this.request({ type: 'find', camPat: [camPat.x, camPat.y, camPat.z], time, pred, ring });
    if (r.star) this.selected = ProbeClient.unwire(r.star);
    return ProbeClient.unwire(r.star);
  }

  clearSelection(): void { this.selected = null; }
}
