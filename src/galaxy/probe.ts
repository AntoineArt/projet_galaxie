// Sonde CPU : régénère les étoiles du noeud feuille contenant la caméra (même hash que le GPU)
// pour identifier l'étoile la plus proche et ses propriétés.
import * as THREE from 'three';
import * as P from './params';
import { Grid } from './grid';
import { LodBuilder } from './lod';
import { imfInv, stellarState, type StarState } from './stellar';
import { NBINS, BIN_YOUNG0, YOUNG_ARM, YOUNG_BASE, binCounts, binComponent, birthInBin, binMassQuantile, youngFraction } from './bins';
import { armFactor } from './density';

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

export class Probe {
  nearest: NearStar | null = null;
  within10pc = 0;
  nodeStars = 0;
  private lastRun = -1e9;
  private tmpState: StarState = { L: 0, T: 0, phase: 0, radius: 0 };
  private binN = new Float64Array(NBINS);

  constructor(_grid: Grid, private lod: LodBuilder) {}

  update(camPat: THREE.Vector3, _theta: number, time: number, now: number): void {
    if (now - this.lastRun < 250) return;
    this.lastRun = now;
    const level = P.MAX_LEVEL;
    const size = (2 * P.ROOT_HALF) / (1 << level);
    const ix = Math.floor((camPat.x + P.ROOT_HALF) / size), iy = Math.floor((camPat.y + P.ROOT_HALF) / size), iz = Math.floor((camPat.z + P.ROOT_HALF) / size);
    const info = this.lod.nodeInfo(level, ix, iy, iz);
    this.nodeStars = info.total;
    this.nearest = null; this.within10pc = 0;
    if (info.total < 0.5) return;
    const seed = (((level * 73856093) ^ (ix * 19349663) ^ (iy * 83492791) ^ (iz * 2971215073)) >>> 8) >>> 0;
    const ox = -P.ROOT_HALF + ix * size, oy = -P.ROOT_HALF + iy * size, oz = -P.ROOT_HALF + iz * size;
    const cx = ox + size / 2, cy = oy + size / 2;
    const Rc = Math.sqrt(cx * cx + cy * cy);
    const diskFrac = (info.n[1] + info.n[2]) / info.total;
    const wrel = (P.omega(Rc) - P.PATTERN_OMEGA) * diskFrac;
    const ax = (-wrel * cy) / size, ay = (wrel * cx) / size;
    const phx = fract(ax * time), phy = fract(ay * time);
    binCounts(info.n[0], info.n[1], info.n[2], info.n[3], youngFraction(info.armMax, time), this.binN);
    let best = Infinity, bestI = -1, bestM = 0, bestTb = 0, bestComp = 0, bestBin = 0;
    const bp = new THREE.Vector3();
    let budget = 400000;
    for (let bin = 0; bin < NBINS && budget > 0; bin++) {
      const N = this.binN[bin];
      const n = Math.floor(N + 0.5);
      const diskStar = bin >= 3;
      const dispScale = (diskStar ? 30 : 120) / size;
      for (let j = 0; j < n && budget > 0; j++, budget--) {
        const i = (j + Math.imul(bin, 0x01000193)) >>> 0;
        const base = hashu(seed ^ (Math.imul(i, 0x9e3779b9) >>> 0));
        const r0 = rnd(hashu(base + 1)), r2 = rnd(hashu(base + 3)), r5 = rnd(hashu(base + 6));
        const r3 = rnd(hashu(base + 4)), r4 = rnd(hashu(base + 5));
        const r6 = rnd(hashu(base + 7)), r8 = rnd(hashu(base + 9)), r9 = rnd(hashu(base + 10));
        const ux = warp1(fract(r2 + phx + (r8 - 0.5) * dispScale * time), info.grad[0]);
        const uy = warp1(fract(r3 + phy + (r9 - 0.5) * dispScale * time), info.grad[1]);
        const uz = warp1(r4, info.grad[2]);
        const px = ox + ux * size, py = oy + uy * size, pz = oz + uz * size;
        if (bin >= BIN_YOUNG0) {
          const a = armFactor(Math.sqrt(px * px + py * py), Math.atan2(py, px));
          if (r5 > (YOUNG_BASE + YOUNG_ARM * a) / (YOUNG_BASE + YOUNG_ARM * info.armMax)) continue;
        }
        const dx = px - camPat.x, dy = py - camPat.y, dz = pz - camPat.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 100 && d2 > best) continue;
        const q = binMassQuantile(bin, 1 - (j + r0) / N);
        const m = imfInv(Math.min(Math.max(q, 1e-7), 1 - 1e-7));
        const tb = birthInBin(bin, time, r6 * 0.9999);
        if (time - tb < 0) continue;
        if (d2 <= 100) this.within10pc++;
        if (d2 < best) { best = d2; bestI = j; bestM = m; bestTb = tb; bestComp = binComponent(bin); bestBin = bin; bp.set(px, py, pz); }
      }
    }
    if (bestI >= 0) {
      const st = stellarState(bestM, time - bestTb, this.tmpState);
      this.nearest = { dist: Math.sqrt(best), mass: bestM, age: time - bestTb, birth: bestTb, comp: bestComp, state: { ...st }, pos: bp, index: bestI, seed, bin: bestBin, id: `${seed}-${bestBin}-${bestI}` };
    }
  }
}
