// Parcours de l'octree : sélection des noeuds à rendre en étoiles individuelles,
// avec nombre d'étoiles visibles K par noeud (les K plus massives selon l'IMF stratifiée).
import * as THREE from 'three';
import * as P from './params';
import { density } from './density';
import { Grid, NC } from './grid';
import { NBINS, binCounts, computeQTO, nodeK, youngFraction } from './bins';
import { VisTable, visIndex } from './visq';
import { Population } from './population';

export const NUM_BUCKETS = 18; // K max = 2^17 par noeud
export const FLOATS_PER_INSTANCE = 20;
export const GLOW_FLOATS = 8; // x, y, z, sigma, L, r, g, b
/** un noeud à moins de GLOW_FAR fois sa taille rend sa lumière non résolue en lueur ; fondu entre GLOW_NEAR et GLOW_FAR */
export const GLOW_NEAR = 3.0;
export const GLOW_FAR = 4.5;
/** distance (pc) sous laquelle un noeud inclut aussi les résidus (naines blanches, étoiles à neutrons) */
export const NEAR_DEAD = 150;

interface NodeInfo { n: Float32Array; arm: number; grad: Float32Array; total: number }

export interface LodStats { nodes: number; stars: number; fluxMin: number; iterations: number; ms: number; converged: boolean }

const TH = 0.75; // seuil de subdivision : taille/distance

export class LodBuilder {
  grid: Grid;
  cache = new Map<number, NodeInfo>();
  buckets: { data: Float32Array; count: number }[] = [];
  fluxMin = 1e-6; // flux minimal rendu (L_sun / pc^2), utilisé pour les buffers courants
  private fluxMinNext = 1e-6; // prédiction pour la prochaine construction
  budget = 1_500_000;
  glow = { data: new Float32Array(GLOW_FLOATS * 1024), count: 0 };
  pop: Population;
  qTO = new Float32Array(NBINS); // quantiles de turnoff au temps de référence des buffers
  vis = new VisTable(); // quantiles visibles par tranche (temps de référence)
  private binN = new Float64Array(NBINS);
  private visIdx = 0;
  private qVisFn = (c: number) => this.vis.qVis(c, this.visIdx);
  stats: LodStats = { nodes: 0, stars: 0, fluxMin: 0, iterations: 0, ms: 0, converged: false };
  private frustum = new THREE.Frustum();
  private tmpV = new THREE.Vector3();
  private tmpD = new Float64Array(5);
  private tmpN = new Float32Array(5);

  constructor(grid: Grid, pop: Population) {
    this.grid = grid;
    this.pop = pop;
    for (let b = 0; b < NUM_BUCKETS; b++) this.buckets.push({ data: new Float32Array(FLOATS_PER_INSTANCE * 256), count: 0 });
  }

  private static key(level: number, ix: number, iy: number, iz: number): number {
    // 4 bits niveau, 11 bits par index (max 2048)
    return ((level * 2048 + ix) * 2048 + iy) * 2048 + iz;
  }

  nodeInfo(level: number, ix: number, iy: number, iz: number): NodeInfo {
    const key = LodBuilder.key(level, ix, iy, iz);
    let info = this.cache.get(key);
    if (info) return info;
    const size = (2 * P.ROOT_HALF) / (1 << level);
    const n = new Float32Array(NC);
    const grad = new Float32Array(3);
    let arm = 0, total = 0;
    if (level <= P.GRID_LEVEL) {
      const c = this.tmpN;
      this.grid.cell(level, ix, iy, iz, c);
      n[0] = c[0]; n[1] = c[1]; n[2] = c[2]; n[3] = c[3]; arm = c[4];
      total = n[0] + n[1] + n[2] + n[3];
      if (total > 0) {
        const g = this.grid;
        grad[0] = (g.totalOf(level, ix + 1, iy, iz) - g.totalOf(level, ix - 1, iy, iz)) / (2 * total);
        grad[1] = (g.totalOf(level, ix, iy + 1, iz) - g.totalOf(level, ix, iy - 1, iz)) / (2 * total);
        grad[2] = (g.totalOf(level, ix, iy, iz + 1) - g.totalOf(level, ix, iy, iz - 1)) / (2 * total);
      }
    } else {
      const cx = -P.ROOT_HALF + (ix + 0.5) * size, cy = -P.ROOT_HALF + (iy + 0.5) * size, cz = -P.ROOT_HALF + (iz + 0.5) * size;
      const d = this.tmpD, s = this.grid.scale, vol = size * size * size;
      density(cx, cy, cz, d);
      for (let c = 0; c < NC; c++) { n[c] = d[c] * s[c] * vol; total += n[c]; }
      arm = d[4];
      if (total > 0) {
        const rc = total / vol;
        const h = size * 0.25;
        const rho = (x: number, y: number, z: number) => { density(x, y, z, d); return d[0] * s[0] + d[1] * s[1] + d[2] * s[2] + d[3] * s[3]; };
        grad[0] = (rho(cx + h, cy, cz) - rho(cx - h, cy, cz)) / (0.5 * rc);
        grad[1] = (rho(cx, cy + h, cz) - rho(cx, cy - h, cz)) / (0.5 * rc);
        grad[2] = (rho(cx, cy, cz + h) - rho(cx, cy, cz - h)) / (0.5 * rc);
      }
    }
    for (let k = 0; k < 3; k++) grad[k] = Math.max(-1.9, Math.min(1.9, grad[k]));
    info = { n, arm, grad, total };
    this.cache.set(key, info);
    return info;
  }

  /**
   * Construit les buffers d'instances.
   * camPat : position caméra dans le référentiel du motif spiral ; theta : angle de rotation motif->monde ;
   * anchor : origine flottante (référentiel motif) ; tRef : temps de référence (Myr) pour les phases de dérive.
   */
  build(camPat: THREE.Vector3, theta: number, anchor: THREE.Vector3, tRef: number, projView: THREE.Matrix4): LodStats {
    const t0 = performance.now();
    this.frustum.setFromProjectionMatrix(projView);
    computeQTO(tRef, this.qTO);
    this.pop.setTime(tRef);
    if (this.vis.needsUpdate(tRef)) this.vis.update(tRef);
    let iter = 0;
    let stars = 0, nodes = 0;
    this.fluxMin = this.fluxMinNext;
    for (;;) {
      for (const b of this.buckets) b.count = 0;
      this.glow.count = 0;
      const r = this.traverse(camPat, theta, anchor, tRef);
      stars = r.stars; nodes = r.nodes; iter++;
      const ratio = stars / this.budget;
      const needAdjust = ratio > 1.15 || (ratio < 0.5 && this.fluxMin > 1e-9);
      if (!needAdjust) { this.fluxMinNext = this.fluxMin; break; }
      // K ~ Lmin^-0.37 environ -> fluxMin ~ ratio^2.7 ; amorti
      const f = Math.pow(Math.max(ratio, 0.05), 2.2);
      const next = Math.max(1e-9, Math.min(1e3, this.fluxMin * Math.max(0.3, Math.min(8, f))));
      if (iter >= 4) { this.fluxMinNext = next; break; }
      this.fluxMin = next;
    }
    this.stats = { nodes, stars, fluxMin: this.fluxMin, iterations: iter, ms: performance.now() - t0, converged: this.fluxMinNext === this.fluxMin };
    return this.stats;
  }

  /** lumière non résolue (étoiles sous le seuil) d'un noeud, en sprite doux ; complémentaire du fondu du champ lointain */
  private pushGlow(cx: number, cy: number, cz: number, size: number, d: number, dEff: number, info: NodeInfo, y: number): void {
    const logL = Math.log10(this.fluxMin * dEff * dEff);
    const pop = this.pop;
    let Lsum = 0, r = 0, g = 0, b = 0;
    for (let c = 0; c < 4; c++) {
      const n = c === 1 ? info.n[1] * (1 - y) : info.n[c];
      if (n <= 0) continue;
      const Lc = n * pop.L[c] * pop.keepAt(c, logL);
      Lsum += Lc; r += Lc * pop.rgb[c * 3]; g += Lc * pop.rgb[c * 3 + 1]; b += Lc * pop.rgb[c * 3 + 2];
    }
    const ny = info.n[1] * y;
    if (ny > 0) {
      const Ly = ny * pop.young.L * pop.keepYoung(logL);
      Lsum += Ly; r += Ly * pop.young.rgb[0]; g += Ly * pop.young.rgb[1]; b += Ly * pop.young.rgb[2];
    }
    if (Lsum <= 0) return;
    const x = Math.min(1, Math.max(0, (d - GLOW_NEAR * size) / ((GLOW_FAR - GLOW_NEAR) * size)));
    const w = 1 - x * x * (3 - 2 * x);
    if (w <= 0) return;
    const gl = this.glow;
    const need = (gl.count + 1) * GLOW_FLOATS;
    if (need > gl.data.length) { const nd = new Float32Array(Math.max(need, gl.data.length * 2)); nd.set(gl.data); gl.data = nd; }
    const o = gl.count * GLOW_FLOATS;
    gl.data[o] = cx; gl.data[o + 1] = cy; gl.data[o + 2] = cz; gl.data[o + 3] = size * 0.45; // sigma ~ demi-taille : recouvrement lisse des voisins
    gl.data[o + 4] = Lsum * w; gl.data[o + 5] = r / Lsum; gl.data[o + 6] = g / Lsum; gl.data[o + 7] = b / Lsum;
    gl.count++;
  }

  private push(b: number, v: Float32Array): void {
    const bk = this.buckets[b];
    const need = (bk.count + 1) * FLOATS_PER_INSTANCE;
    if (need > bk.data.length) {
      const nd = new Float32Array(Math.max(need, bk.data.length * 2));
      nd.set(bk.data); bk.data = nd;
    }
    bk.data.set(v, bk.count * FLOATS_PER_INSTANCE);
    bk.count++;
  }

  private inst = new Float32Array(FLOATS_PER_INSTANCE);
  private stack: Int32Array = new Int32Array(4 * 100000);

  private traverse(camPat: THREE.Vector3, theta: number, anchor: THREE.Vector3, tRef: number): { stars: number; nodes: number } {
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    let sp = 0;
    const st = this.stack;
    const startLevel = 2;
    const n0 = 1 << startLevel;
    const L0 = this.grid.levels[startLevel];
    for (let ix = 0; ix < n0; ix++) for (let iy = 0; iy < n0; iy++) for (let iz = L0.z0; iz < L0.z0 + L0.nz; iz++) {
      st[sp++] = startLevel; st[sp++] = ix; st[sp++] = iy; st[sp++] = iz;
    }
    let stars = 0, nodes = 0;
    const v = this.tmpV;
    const inst = this.inst;
    while (sp > 0) {
      const iz = st[--sp], iy = st[--sp], ix = st[--sp], level = st[--sp];
      const info = this.nodeInfo(level, ix, iy, iz);
      if (info.total < 0.5) continue;
      const size = (2 * P.ROOT_HALF) / (1 << level);
      const cx = -P.ROOT_HALF + (ix + 0.5) * size, cy = -P.ROOT_HALF + (iy + 0.5) * size, cz = -P.ROOT_HALF + (iz + 0.5) * size;
      // relatif caméra (référentiel motif) puis rotation vers le monde
      const rx = cx - camPat.x, ry = cy - camPat.y, rz = cz - camPat.z;
      const wx = cosT * rx - sinT * ry, wy = sinT * rx + cosT * ry;
      const half = size * 0.5;
      // distance au cube
      const dx = Math.max(Math.abs(rx) - half, 0), dy = Math.max(Math.abs(ry) - half, 0), dz = Math.max(Math.abs(rz) - half, 0);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // culling frustum (sphère englobante) sauf si la caméra est dedans
      if (d > 0) {
        v.set(wx, wy, rz);
        const R = half * 1.7321;
        let out = false;
        for (const pl of this.frustum.planes) if (pl.distanceToPoint(v) < -R) { out = true; break; }
        if (out) continue;
      }
      const dEff = Math.max(d, size * 0.15);
      const Rc0 = Math.sqrt(cx * cx + cy * cy);
      this.visIdx = visIndex(Math.log10(this.fluxMin * dEff * dEff));
      const nb = this.binN;
      const arm = info.arm;
      const y = youngFraction(arm, tRef);
      binCounts(info.n[0], info.n[1], info.n[2], info.n[3], y, nb);
      const includeDead = d < NEAR_DEAD;
      let K = nodeK(nb, this.qTO, this.qVisFn, includeDead);
      const glows = d < GLOW_FAR * size;
      if (K < 1 && !glows) continue;
      // subdivision forcée : un cube ne peut pas représenter la structure du disque (échelle de hauteur 300 pc)
      const forced = level < 6 || (level < 7 && Math.abs(cz) < 1200 && Rc0 < 22000);
      if (level < P.MAX_LEVEL && (forced || size / dEff > TH)) {
        for (let c = 0; c < 8; c++) {
          st[sp++] = level + 1; st[sp++] = ix * 2 + (c & 1); st[sp++] = iy * 2 + ((c >> 1) & 1); st[sp++] = iz * 2 + (c >> 2);
        }
        continue;
      }
      if (glows) this.pushGlow(cx, cy, cz, size, d, dEff, info, y);
      if (K < 1) continue;
      K = Math.min(K, 1 << (NUM_BUCKETS - 1));
      const b = Math.min(NUM_BUCKETS - 1, Math.max(0, Math.ceil(Math.log2(K))));
      // dérive azimutale des étoiles du disque dans le référentiel du motif
      const Rc = Math.sqrt(cx * cx + cy * cy);
      const diskFrac = (info.n[1] + info.n[2]) / info.total;
      const wrel = (P.omega(Rc) - P.PATTERN_OMEGA) * diskFrac;
      const vx = -wrel * cy, vy = wrel * cx; // pc/Myr
      const ax = vx / size, ay = vy / size;
      const px = ax * tRef, py = ay * tRef;
      inst[0] = cx - half - anchor.x; inst[1] = cy - half - anchor.y; inst[2] = cz - half - anchor.z; inst[3] = size;
      inst[4] = ((level * 73856093) ^ (ix * 19349663) ^ (iy * 83492791) ^ (iz * 2971215073)) >>> 8; // graine
      inst[5] = info.n[0]; inst[6] = info.n[1]; inst[7] = info.n[2];
      inst[8] = info.n[3]; inst[9] = y; inst[10] = this.visIdx; inst[11] = 0;
      inst[12] = info.grad[0]; inst[13] = info.grad[1]; inst[14] = info.grad[2]; inst[15] = ax;
      inst[16] = ay; inst[17] = px - Math.floor(px); inst[18] = py - Math.floor(py); inst[19] = arm + (includeDead ? 2 : 0);
      this.push(b, inst);
      stars += K; nodes++;
    }
    return { stars, nodes };
  }
}
