// Sonde CPU : régénère les étoiles de noeuds feuilles (même hash que le GPU) pour identifier l'étoile la plus
// proche de la caméra, ou celle visée par un rayon (sélection).
import * as THREE from 'three';
import * as P from './params';
import { LodBuilder, nearScale } from './lod';
import { imfInv, stellarState, type StarState } from './stellar';
import { NBINS, BIN_YOUNG0, YOUNG_ARM, YOUNG_BASE, binCounts, binComponent, birthInBin, binMassQuantile, computeQTO, youngFraction } from './bins';
import { armFactor } from './density';
import { visIndex } from './visq';

function hashu(x: number): number {
  x = x >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16; return x >>> 0;
}
const rnd = (h: number) => (h & 0xffffff) / 16777216;
function warp1(v: number, s: number): number {
  if (Math.abs(s) < 1e-3) return v;
  const b = 1 - 0.5 * s;
  return (-b + Math.sqrt(b * b + 2 * s * v)) / s;
}
const fract = (x: number) => x - Math.floor(x);

export interface NearStar {
  dist: number; mass: number; age: number; birth: number; comp: number; state: StarState; pos: THREE.Vector3; index: number;
  seed: number; bin: number; id: string;
}

interface StarHit { px: number; py: number; pz: number; m: number; tb: number; bin: number; j: number; seed: number }

const LEVEL = P.MAX_LEVEL;
const SIZE = (2 * P.ROOT_HALF) / (1 << LEVEL);

export class Probe {
  nearest: NearStar | null = null;
  selected: NearStar | null = null;
  within10pc = 0;
  nodeStars = 0;
  private lastRun = -1e9;
  private tmpState: StarState = { L: 0, T: 0, phase: 0, radius: 0 };
  private binN = new Float64Array(NBINS);
  private qTO = new Float32Array(NBINS);

  constructor(private lod: LodBuilder) {}

  /**
   * Énumère les étoiles d'un noeud feuille. all : toutes ; sinon uniquement les plages visibles [a_c, b_c)
   * (mêmes bornes que le GPU pour l'indice de seuil visIdx). cb retourne true pour arrêter.
   */
  private enumerate(ix: number, iy: number, iz: number, time: number, visIdx: number, all: boolean, maxCount: number, cb: (s: StarHit) => boolean | void): void {
    const info = this.lod.nodeInfo(LEVEL, ix, iy, iz);
    if (info.total < 0.5) return;
    const size = SIZE;
    const seed = (((LEVEL * 73856093) ^ (ix * 19349663) ^ (iy * 83492791) ^ (iz * 2971215073)) >>> 8) >>> 0;
    const ox = -P.ROOT_HALF + ix * size, oy = -P.ROOT_HALF + iy * size, oz = -P.ROOT_HALF + iz * size;
    const cx = ox + size / 2, cy = oy + size / 2;
    const Rc = Math.sqrt(cx * cx + cy * cy);
    const diskFrac = (info.n[1] + info.n[2]) / info.total;
    const wrel = (P.omega(Rc) - P.PATTERN_OMEGA) * diskFrac;
    const ax = (-wrel * cy) / size, ay = (wrel * cx) / size;
    const phx = fract(ax * time), phy = fract(ay * time);
    binCounts(info.n[0], info.n[1], info.n[2], info.n[3], youngFraction(info.armMax, time), this.binN);
    const hit: StarHit = { px: 0, py: 0, pz: 0, m: 0, tb: 0, bin: 0, j: 0, seed };
    let budget = maxCount;
    for (let bin = 0; bin < NBINS && budget > 0; bin++) {
      const N = this.binN[bin];
      if (N <= 0) continue;
      const j0 = all ? 0 : Math.floor(N * this.qTO[bin]);
      const j1 = all ? Math.floor(N + 0.5) : Math.floor(N * this.lod.vis.qVis(bin, visIdx) + 0.5);
      const dispScale = (bin >= 3 ? 30 : 120) / size;
      for (let j = j0; j < j1 && budget > 0; j++, budget--) {
        const i = (j + Math.imul(bin, 0x01000193)) >>> 0;
        const base = hashu(seed ^ (Math.imul(i, 0x9e3779b9) >>> 0));
        const r0 = rnd(hashu(base + 1)), r2 = rnd(hashu(base + 3)), r5 = rnd(hashu(base + 6));
        const r3 = rnd(hashu(base + 4)), r4 = rnd(hashu(base + 5));
        const r6 = rnd(hashu(base + 7)), r8 = rnd(hashu(base + 9)), r9 = rnd(hashu(base + 10));
        const ux = warp1(fract(r2 + phx + (r8 - 0.5) * dispScale * time), info.grad[0]);
        const uy = warp1(fract(r3 + phy + (r9 - 0.5) * dispScale * time), info.grad[1]);
        const uz = warp1(r4, info.grad[2]);
        hit.px = ox + ux * size; hit.py = oy + uy * size; hit.pz = oz + uz * size;
        if (bin >= BIN_YOUNG0) {
          const a = armFactor(Math.sqrt(hit.px * hit.px + hit.py * hit.py), Math.atan2(hit.py, hit.px));
          if (r5 > (YOUNG_BASE + YOUNG_ARM * a) / (YOUNG_BASE + YOUNG_ARM * info.armMax)) continue;
        }
        const q = binMassQuantile(bin, 1 - (j + r0) / N);
        hit.m = imfInv(Math.min(Math.max(q, 1e-7), 1 - 1e-7));
        hit.tb = birthInBin(bin, time, r6 * 0.9999);
        if (time - hit.tb < 0) continue;
        hit.bin = bin; hit.j = j;
        if (cb(hit)) return;
      }
    }
  }

  private makeStar(h: StarHit, time: number, dist: number): NearStar {
    const st = stellarState(h.m, time - h.tb, this.tmpState);
    return { dist, mass: h.m, age: time - h.tb, birth: h.tb, comp: binComponent(h.bin), state: { ...st }, pos: new THREE.Vector3(h.px, h.py, h.pz), index: h.j, seed: h.seed, bin: h.bin, id: `${h.seed}-${h.bin}-${h.j}` };
  }

  /** étoile la plus proche de la caméra (noeud feuille courant), toutes les 250 ms */
  update(camPat: THREE.Vector3, time: number, now: number): void {
    if (now - this.lastRun < 250) return;
    this.lastRun = now;
    const ix = Math.floor((camPat.x + P.ROOT_HALF) / SIZE), iy = Math.floor((camPat.y + P.ROOT_HALF) / SIZE), iz = Math.floor((camPat.z + P.ROOT_HALF) / SIZE);
    this.nodeStars = this.lod.nodeInfo(LEVEL, ix, iy, iz).total;
    this.nearest = null; this.within10pc = 0;
    let best = Infinity;
    let bestHit: StarHit | null = null;
    this.enumerate(ix, iy, iz, time, 0, true, 400000, (h) => {
      const dx = h.px - camPat.x, dy = h.py - camPat.y, dz = h.pz - camPat.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= 100) this.within10pc++;
      if (d2 < best) { best = d2; bestHit = { ...h }; }
    });
    if (bestHit) this.nearest = this.makeStar(bestHit, time, Math.sqrt(best));
    if (this.selected) this.refreshSelected(camPat, time);
  }

  /** la sélection suit son étoile (position et état évoluent avec le temps) */
  private refreshSelected(camPat: THREE.Vector3, time: number): void {
    const s = this.selected!;
    const ix = Math.floor((s.pos.x + P.ROOT_HALF) / SIZE), iy = Math.floor((s.pos.y + P.ROOT_HALF) / SIZE), iz = Math.floor((s.pos.z + P.ROOT_HALF) / SIZE);
    let found: StarHit | null = null;
    this.enumerate(ix, iy, iz, time, 0, true, 1e9, (h) => { if (h.bin === s.bin && h.j === s.index) { found = { ...h }; return true; } return false; });
    if (found) this.selected = this.makeStar(found, time, new THREE.Vector3((found as StarHit).px, (found as StarHit).py, (found as StarHit).pz).distanceTo(camPat));
  }

  /**
   * Sélectionne l'étoile visible la plus proche du rayon (dirPat : direction unitaire, réf. motif),
   * parmi les noeuds feuilles traversés jusqu'à 500 pc. fluxMin : seuil de visibilité courant.
   */
  pick(camPat: THREE.Vector3, dirPat: THREE.Vector3, time: number, fluxMin: number): NearStar | null {
    computeQTO(time, this.qTO);
    if (this.lod.vis.needsUpdate(time)) this.lod.vis.update(time);
    const visited = new Set<number>();
    const nodes: [number, number, number][] = [];
    const add = (x: number, y: number, z: number) => {
      const ix = Math.floor((x + P.ROOT_HALF) / SIZE), iy = Math.floor((y + P.ROOT_HALF) / SIZE), iz = Math.floor((z + P.ROOT_HALF) / SIZE);
      const key = (ix * 2048 + iy) * 2048 + iz;
      if (!visited.has(key)) { visited.add(key); nodes.push([ix, iy, iz]); }
    };
    for (let s = 0; s <= 500; s += SIZE * 0.45) add(camPat.x + dirPat.x * s, camPat.y + dirPat.y * s, camPat.z + dirPat.z * s);
    let bestScore = Infinity;
    let bestHit: StarHit | null = null, bestD = 0;
    const st = this.tmpState;
    for (const [ix, iy, iz] of nodes) {
      const cx = -P.ROOT_HALF + (ix + 0.5) * SIZE - camPat.x, cy = -P.ROOT_HALF + (iy + 0.5) * SIZE - camPat.y, cz = -P.ROOT_HALF + (iz + 0.5) * SIZE - camPat.z;
      const dNode = Math.max(Math.sqrt(cx * cx + cy * cy + cz * cz) - SIZE * 0.87, SIZE * 0.15);
      const visIdx = visIndex(Math.log10(fluxMin * dNode * dNode * nearScale(dNode)));
      this.enumerate(ix, iy, iz, time, visIdx, dNode < 150, 300000, (h) => {
        const dx = h.px - camPat.x, dy = h.py - camPat.y, dz = h.pz - camPat.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1e-12) return;
        const d = Math.sqrt(d2);
        const cosA = (dx * dirPat.x + dy * dirPat.y + dz * dirPat.z) / d;
        if (cosA < 0.9995) return; // > 1,8°
        stellarState(h.m, time - h.tb, st);
        if (st.L <= 0 || st.L / d2 < fluxMin * nearScale(d) * 0.4) return;
        const angle = Math.acos(Math.min(1, cosA));
        // pondération : les étoiles brillantes sont plus faciles à viser
        const score = angle / (1 + 0.15 * Math.log10(1 + (st.L / d2) / fluxMin));
        if (score < bestScore) { bestScore = score; bestHit = { ...h }; bestD = d; }
      });
    }
    this.selected = bestHit ? this.makeStar(bestHit, time, bestD) : null;
    return this.selected;
  }

  clearSelection(): void { this.selected = null; }

  /**
   * Cherche l'étoile la plus proche satisfaisant un prédicat sur son état, dans le noeud courant et ses 26 voisins
   * (toutes les étoiles, résidus compris). Utilisé par les boutons "trouver un trou noir / une naine blanche...".
   */
  findNearest(camPat: THREE.Vector3, time: number, pred: (st: StarState, mass: number) => boolean, ring = 1): NearStar | null {
    const ix0 = Math.floor((camPat.x + P.ROOT_HALF) / SIZE), iy0 = Math.floor((camPat.y + P.ROOT_HALF) / SIZE), iz0 = Math.floor((camPat.z + P.ROOT_HALF) / SIZE);
    let best = Infinity;
    let bestHit: StarHit | null = null;
    const st = this.tmpState;
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) for (let dz = -ring; dz <= ring; dz++) {
      this.enumerate(ix0 + dx, iy0 + dy, iz0 + dz, time, 0, true, 300000, (h) => {
        const ex = h.px - camPat.x, ey = h.py - camPat.y, ez = h.pz - camPat.z;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 >= best) return;
        stellarState(h.m, time - h.tb, st);
        if (!pred(st, h.m)) return;
        best = d2; bestHit = { ...h };
      });
    }
    if (!bestHit) return null;
    this.selected = this.makeStar(bestHit, time, Math.sqrt(best));
    return this.selected;
  }
}
