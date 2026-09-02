// Tranches de population : chaque noeud contient, pour chaque tranche c, N_c étoiles indexées 0..N_c-1 par masse
// décroissante. Les étoiles trop massives (mortes pour l'âge minimal de la tranche) et trop faibles (sous le seuil
// de flux) sont exclues par des bornes [a_c, b_c) : seules les étoiles potentiellement visibles coûtent un sommet.
//
// Tranches :
//   0 halo [0,1500]  1 bulbe [500,2500]  2 bulbe tardif [2500,12000]  3 disque épais [1000,4000]
//   4..20 disque mince, naissances absolues par pas de 1000 Myr de 3000 à 20000, IMF plafonnée à MCAP (les étoiles
//         plus massives vivent < 40 Myr : elles sont toutes portées par les tranches jeunes)
//   21..26 disque mince jeune : âges relatifs à maintenant, exponentiels (tau YOUNG_TAU), découpés en sous-tranches d'âge
//         pour que seules les étoiles massives encore vivantes coûtent un sommet.
// Miroir GLSL : binN()/binRange() dans star.vert.glsl.
import { imfCdf, tMS, YOUNG_TAU } from './stellar';
export { YOUNG_TAU };

export const NBINS = 27;
export const BIN_THIN0 = 4;
export const BIN_YOUNG0 = 21;
export const MCAP = 8;
export const F_CAP = imfCdf(MCAP);
export const YOUNG_BASE = 0.01; // fraction d'étoiles jeunes du disque mince hors bras
export const YOUNG_ARM = 0.03; // supplément au coeur d'un bras
export const YOUNG_AGES = [0, 4, 12, 30, 80, 200, 1000]; // bornes d'âge des sous-tranches jeunes (Myr)
export const YOUNG_W = YOUNG_AGES.slice(0, -1).map((a, s) => Math.exp(-a / YOUNG_TAU) - Math.exp(-YOUNG_AGES[s + 1] / YOUNG_TAU));
const YOUNG_WSUM = YOUNG_W.reduce((a, b) => a + b, 0);
for (let s = 0; s < YOUNG_W.length; s++) YOUNG_W[s] /= YOUNG_WSUM;

/** [t0, t1] de naissance de la tranche c (Myr) ; tranches jeunes : bornes d'âge négatives [-a1, -a0] */
export function binRange(c: number): [number, number] {
  if (c === 0) return [0, 1500];
  if (c === 1) return [500, 2500];
  if (c === 2) return [2500, 12000];
  if (c === 3) return [1000, 4000];
  if (c < BIN_YOUNG0) { const t0 = 3000 + (c - BIN_THIN0) * 1000; return [t0, t0 + 1000]; }
  const s = c - BIN_YOUNG0;
  return [-YOUNG_AGES[s + 1], -YOUNG_AGES[s]];
}
export const isThinOld = (c: number) => c >= BIN_THIN0 && c < BIN_YOUNG0;
export const isYoung = (c: number) => c >= BIN_YOUNG0;

/** composante de base (0 bulbe, 1 mince, 2 épais, 3 halo) */
export function binComponent(c: number): number {
  if (c === 0) return 3;
  if (c <= 2) return 0;
  if (c === 3) return 2;
  return 1;
}

/** montée en puissance de la formation stellaire du disque mince (Myr) */
export function diskRamp(t: number): number {
  const x = Math.min(1, Math.max(0, (t - 2500) / 1500));
  return x * x * (3 - 2 * x);
}
export function youngFraction(arm: number, t: number): number {
  return (YOUNG_BASE + YOUNG_ARM * arm) * diskRamp(t);
}

/** N_c à partir des comptes par composante */
export function binCounts(nBulge: number, nThin: number, nThick: number, nHalo: number, y: number, out: Float64Array): void {
  out[0] = nHalo;
  out[1] = 0.85 * nBulge;
  out[2] = 0.15 * nBulge;
  out[3] = nThick;
  const per = (nThin * (1 - y)) / 17;
  for (let c = BIN_THIN0; c < BIN_YOUNG0; c++) out[c] = per;
  for (let s = 0; s < YOUNG_W.length; s++) out[BIN_YOUNG0 + s] = nThin * y * YOUNG_W[s];
}

/** âge de naissance d'une étoile de la tranche c, u uniforme ; retourne le temps de naissance */
export function birthInBin(c: number, t: number, u: number): number {
  const [t0, t1] = binRange(c);
  if (!isYoung(c)) return t0 + u * (t1 - t0);
  const a0 = -t1, a1 = -t0;
  const age = a0 - YOUNG_TAU * Math.log(1 - u * (1 - Math.exp(-(a1 - a0) / YOUNG_TAU)));
  return t - age;
}

/** masse pour le quantile q (0 = la plus massive de la tranche) */
export function binMassQuantile(c: number, q: number): number {
  return isThinOld(c) ? q * F_CAP : q;
}

/** quantile de la borne "morte" par tranche à l'instant t : fraction des étoiles plus massives que la masse de turnoff */
export function computeQTO(t: number, out: Float32Array): void {
  for (let c = 0; c < NBINS; c++) {
    const [t0, t1] = binRange(c);
    let minAge: number;
    if (isYoung(c)) minAge = -t1;
    else {
      if (t < t0) { out[c] = 1; continue; } // rien n'est encore né
      minAge = Math.max(0, t - t1);
    }
    let mTO = 150;
    // inverse de tMS : m = (10000/age)^0.4 ; marge 3 % pour les flashs de supernova
    if (minAge > 0) mTO = Math.min(150, Math.pow(10000 / Math.max(minAge, tMS(150)), 0.4) * 1.03);
    if (isThinOld(c)) out[c] = mTO >= MCAP ? 0 : (F_CAP - imfCdf(mTO)) / F_CAP;
    else out[c] = 1 - imfCdf(mTO);
  }
}

/** nombre d'étoiles à dessiner pour un noeud ; qVis(c) = quantile visible de la tranche c au seuil du noeud */
export function nodeK(counts: Float64Array, qTO: Float32Array, qVis: (c: number) => number, includeDead: boolean): number {
  let K = 0;
  for (let c = 0; c < NBINS; c++) {
    const n = counts[c];
    if (n <= 0) continue;
    const a = includeDead ? 0 : Math.floor(n * qTO[c]);
    const b = Math.floor(n * qVis(c) + 0.5);
    if (b > a) K += b - a;
  }
  return K;
}
