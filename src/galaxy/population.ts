// Tables de population partagées CPU/GPU : luminosité et couleur moyennes par composante en fonction du temps,
// table "keep" (part de la lumière sous un seuil de luminosité) et population jeune.
import { COMPONENTS } from './params';
import { buildKeepTable, buildPopTable, samplePop, youngPopMean, KEEP_LOGMAX, KEEP_LOGMIN, KEEP_NL, type PopTable } from './stellar';

export class Population {
  pop: PopTable[] = [];
  keep: ReturnType<typeof buildKeepTable>;
  young: { L: number; rgb: [number, number, number] };
  /** état échantillonné au temps courant : L[4], rgb[12] */
  L = new Float32Array(4);
  rgb = new Float32Array(12);
  keepIdx = 0; // indice temps fractionnaire dans la table keep
  private tmp = new Float32Array(4);

  constructor() {
    for (const c of COMPONENTS) this.pop.push(buildPopTable(c));
    this.keep = buildKeepTable();
    this.young = youngPopMean();
  }

  setTime(t: number): void {
    for (let c = 0; c < 4; c++) {
      samplePop(this.pop[c], t, this.tmp);
      this.L[c] = this.tmp[0];
      this.rgb[c * 3] = this.tmp[1]; this.rgb[c * 3 + 1] = this.tmp[2]; this.rgb[c * 3 + 2] = this.tmp[3];
    }
    this.keepIdx = Math.min(Math.max((t - this.keep.t0) / this.keep.dt, 0), this.keep.nT - 1.001);
  }

  private keepRow(row: number, logL: number): number {
    const f = Math.min(Math.max(((logL - KEEP_LOGMIN) / (KEEP_LOGMAX - KEEP_LOGMIN)) * (KEEP_NL - 1), 0), KEEP_NL - 1.001);
    const i = Math.floor(f); const a = f - i;
    const d = this.keep.data;
    return d[row * KEEP_NL + i] * (1 - a) + d[row * KEEP_NL + i + 1] * a;
  }

  /** fraction de la lumière de la composante c (au temps courant) venant d'étoiles de L < 10^logL */
  keepAt(c: number, logL: number): number {
    const k0 = Math.floor(this.keepIdx), ka = this.keepIdx - k0;
    const row0 = c * this.keep.nT + k0;
    return this.keepRow(row0, logL) * (1 - ka) + this.keepRow(row0 + 1, logL) * ka;
  }
  keepYoung(logL: number): number {
    return this.keepRow(this.keep.rows - 1, logL);
  }
}
