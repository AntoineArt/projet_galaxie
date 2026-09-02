// Grille précalculée (niveau GRID_LEVEL, cellules de 512 pc) des comptes d'étoiles par composante,
// normalisée à N_STARS_TOTAL, plus pyramide de sommes pour les niveaux inférieurs.
import * as P from './params';
import { density } from './density';

export const NC = 4; // composantes
const ZHALF = 8192; // extension verticale de la grille (pc)

export interface Level {
  level: number;
  size: number;
  n: number; // cellules par axe en x,y
  z0: number; // premier index z
  nz: number;
  // [ix][iy][iz] -> 5 floats (4 comptes + arm pondéré par thin)
  data: Float32Array;
}

export class Grid {
  levels: Level[] = [];
  scale = new Float64Array(NC); // facteur de normalisation par composante (densité -> nb d'étoiles/pc^3)
  totals = new Float64Array(NC);

  constructor() {
    const t0 = performance.now();
    const L = P.GRID_LEVEL;
    const size = (2 * P.ROOT_HALF) / (1 << L);
    const n = 1 << L;
    const z0 = Math.floor((P.ROOT_HALF - ZHALF) / size);
    const z1 = Math.ceil((P.ROOT_HALF + ZHALF) / size) - 1;
    const nz = z1 - z0 + 1;
    const data = new Float32Array(n * n * nz * 5);
    const d = new Float64Array(5);
    const raw = new Float64Array(NC);
    const vol = size * size * size;
    // 2x2x2 sous-échantillons par cellule
    const offs = [-0.25, 0.25];
    for (let ix = 0; ix < n; ix++) {
      const x0 = -P.ROOT_HALF + (ix + 0.5) * size;
      for (let iy = 0; iy < n; iy++) {
        const y0 = -P.ROOT_HALF + (iy + 0.5) * size;
        for (let iz = 0; iz < nz; iz++) {
          const z0p = -P.ROOT_HALF + (iz + z0 + 0.5) * size;
          let b = 0, th = 0, tk = 0, h = 0, arm = 0;
          for (const ox of offs) for (const oy of offs) for (const oz of offs) {
            density(x0 + ox * size, y0 + oy * size, z0p + oz * size, d);
            b += d[0]; th += d[1]; tk += d[2]; h += d[3]; arm += d[4] * d[1];
          }
          const o = ((ix * n + iy) * nz + iz) * 5;
          data[o] = b * vol / 8; data[o + 1] = th * vol / 8; data[o + 2] = tk * vol / 8; data[o + 3] = h * vol / 8;
          data[o + 4] = th > 0 ? arm / th : 0;
          raw[0] += data[o]; raw[1] += data[o + 1]; raw[2] += data[o + 2]; raw[3] += data[o + 3];
        }
      }
    }
    // normalisation : le disque mince inclut les étoiles non encore nées (naissance uniforme jusqu'à T_MAX_BIRTH)
    const thinFactor = (P.T_MAX_BIRTH - 3000) / (P.T_PRESENT - 3000);
    const target = [P.FRAC.bulge, P.FRAC.thin * thinFactor, P.FRAC.thick, P.FRAC.halo].map((f) => f * P.N_STARS_TOTAL);
    for (let c = 0; c < NC; c++) { this.scale[c] = target[c] / raw[c]; this.totals[c] = target[c]; }
    for (let i = 0; i < data.length; i += 5) for (let c = 0; c < NC; c++) data[i + c] *= this.scale[c];

    this.levels[L] = { level: L, size, n, z0, nz, data };
    // pyramide
    for (let l = L - 1; l >= 0; l--) this.levels[l] = this.reduce(this.levels[l + 1]);
    console.log(`grille ${n}x${n}x${nz} en ${(performance.now() - t0).toFixed(0)} ms, total=${(this.totals.reduce((a, b) => a + b) / 1e9).toFixed(1)} G étoiles`);
  }

  private reduce(src: Level): Level {
    const level = src.level - 1;
    const n = src.n >> 1;
    const size = src.size * 2;
    const z0 = Math.floor(src.z0 / 2);
    const z1 = Math.floor((src.z0 + src.nz - 1) / 2);
    const nz = z1 - z0 + 1;
    const data = new Float32Array(n * n * nz * 5);
    for (let ix = 0; ix < src.n; ix++) for (let iy = 0; iy < src.n; iy++) for (let iz = 0; iz < src.nz; iz++) {
      const s = ((ix * src.n + iy) * src.nz + iz) * 5;
      const o = (((ix >> 1) * n + (iy >> 1)) * nz + (((iz + src.z0) >> 1) - z0)) * 5;
      data[o] += src.data[s]; data[o + 1] += src.data[s + 1]; data[o + 2] += src.data[s + 2]; data[o + 3] += src.data[s + 3];
      data[o + 4] += src.data[s + 4] * src.data[s + 1];
    }
    for (let i = 0; i < data.length; i += 5) if (data[i + 1] > 0) data[i + 4] /= data[i + 1];
    return { level, size, n, z0, nz, data };
  }

  /** écrit dans out[0..4] les comptes + arm de la cellule ; retourne false si hors grille */
  cell(level: number, ix: number, iy: number, iz: number, out: Float32Array | Float64Array): boolean {
    const L = this.levels[level];
    const jz = iz - L.z0;
    if (ix < 0 || iy < 0 || ix >= L.n || iy >= L.n || jz < 0 || jz >= L.nz) { out[0] = out[1] = out[2] = out[3] = out[4] = 0; return false; }
    const o = ((ix * L.n + iy) * L.nz + jz) * 5;
    out[0] = L.data[o]; out[1] = L.data[o + 1]; out[2] = L.data[o + 2]; out[3] = L.data[o + 3]; out[4] = L.data[o + 4];
    return true;
  }

  totalOf(level: number, ix: number, iy: number, iz: number): number {
    const L = this.levels[level];
    const jz = iz - L.z0;
    if (ix < 0 || iy < 0 || ix >= L.n || iy >= L.n || jz < 0 || jz >= L.nz) return 0;
    const o = ((ix * L.n + iy) * L.nz + jz) * 5;
    return L.data[o] + L.data[o + 1] + L.data[o + 2] + L.data[o + 3];
  }
}
