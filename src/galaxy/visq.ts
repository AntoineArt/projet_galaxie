// Table "quantile visible" : pour chaque tranche c (au temps t) et chaque seuil de luminosité Lcut,
// le quantile (par masse décroissante, depuis le haut) jusqu'auquel il faut parcourir les étoiles
// pour inclure toutes celles dont la luminosité réelle (SP, géante, supergéante...) peut dépasser Lcut.
// Partagée CPU (nodeK) / GPU (texture uVis) avec un échantillonnage "nearest" identique des deux côtés.
import { imfInv, stellarState, type StarState } from './stellar';
import { NBINS, birthInBin, binMassQuantile, isYoung } from './bins';

export const VIS_NL = 64;
export const VIS_LOGMIN = -4;
export const VIS_LOGMAX = 7;
const NQ = 220; // échantillons de quantile (log-espacés de 1e-6 à 1)
const NT = 20; // échantillons de temps de naissance par tranche

export function visIndex(logL: number): number {
  const f = ((logL - VIS_LOGMIN) / (VIS_LOGMAX - VIS_LOGMIN)) * (VIS_NL - 1);
  return Math.max(0, Math.min(VIS_NL - 1, Math.floor(f + 0.5)));
}

export class VisTable {
  data = new Float32Array(NBINS * VIS_NL);
  /** max sur les tranches, par seuil : borne rapide de K */
  maxQ = new Float32Array(VIS_NL);
  time = -1;
  private q = new Float64Array(NQ);
  private lmax = new Float64Array(NQ);
  private st: StarState = { L: 0, T: 0, phase: 0, radius: 0 };

  constructor() {
    for (let i = 0; i < NQ; i++) this.q[i] = Math.pow(10, -6 + (6 * (i + 0.5)) / NQ);
  }

  needsUpdate(t: number): boolean {
    return this.time < 0 || Math.abs(t - this.time) > 0.003 * t + 0.5;
  }

  update(t: number): void {
    this.time = t;
    const st = this.st;
    for (let c = 0; c < NBINS; c++) {
      // luminosité maximale atteinte (sur les temps de naissance de la tranche) par quantile
      for (let i = 0; i < NQ; i++) {
        const m = imfInv(Math.min(Math.max(binMassQuantile(c, 1 - this.q[i]), 1e-7), 1 - 1e-7));
        let best = 0;
        for (let k = 0; k < NT; k++) {
          const tb = birthInBin(c, t, (k + 0.5) / NT);
          stellarState(m, t - tb, st);
          if (st.L > best) best = st.L;
        }
        this.lmax[i] = best;
      }
      // pour chaque seuil : plus grand quantile dont lmax >= Lcut (borne supérieure incluant l'échantillon suivant)
      for (let k = 0; k < VIS_NL; k++) {
        const Lcut = Math.pow(10, VIS_LOGMIN + ((VIS_LOGMAX - VIS_LOGMIN) * k) / (VIS_NL - 1));
        let qv = 0;
        for (let i = NQ - 1; i >= 0; i--) if (this.lmax[i] >= Lcut) { qv = i + 1 < NQ ? this.q[i + 1] : 1; break; }
        if (isYoung(c) && qv > 0) qv = Math.min(1, qv * 1.15); // marge : phases brèves mal échantillonnées
        this.data[c * VIS_NL + k] = qv;
      }
    }
    for (let k = 0; k < VIS_NL; k++) { let m = 0; for (let c = 0; c < NBINS; c++) m = Math.max(m, this.data[c * VIS_NL + k]); this.maxQ[k] = m; }
  }

  qVis(c: number, idx: number): number {
    return this.data[c * VIS_NL + idx];
  }
}
