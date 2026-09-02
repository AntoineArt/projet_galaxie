// Physique stellaire simplifiée : IMF de Kroupa, évolution L(m, âge), T(m, âge), histoires de formation.
// Doit rester en accord avec src/render/shaders/stellar.glsl (même modèle côté GPU).
import { COMPONENTS, T_MAX_BIRTH, type Component } from './params';

// ---------- IMF de Kroupa (2001) ----------
export const IMF_BOUNDS = [0.01, 0.08, 0.5, 150];
export const IMF_ALPHA = [0.3, 1.3, 2.3];
// coefficients de continuité et intégrales par segment
const IMF_C = [1, Math.pow(0.08, 1.0), Math.pow(0.08, 1.0) * Math.pow(0.5, 1.0)];
const IMF_SEG = IMF_ALPHA.map((a, i) => {
  const p = 1 - a;
  return (IMF_C[i] * (Math.pow(IMF_BOUNDS[i + 1], p) - Math.pow(IMF_BOUNDS[i], p))) / p;
});
const IMF_TOTAL = IMF_SEG[0] + IMF_SEG[1] + IMF_SEG[2];
export const IMF_CUM = [0, IMF_SEG[0] / IMF_TOTAL, (IMF_SEG[0] + IMF_SEG[1]) / IMF_TOTAL, 1];

/** fraction d'étoiles de masse < m */
export function imfCdf(m: number): number {
  if (m <= IMF_BOUNDS[0]) return 0;
  if (m >= IMF_BOUNDS[3]) return 1;
  let i = m < IMF_BOUNDS[1] ? 0 : m < IMF_BOUNDS[2] ? 1 : 2;
  const p = 1 - IMF_ALPHA[i];
  const part = (IMF_C[i] * (Math.pow(m, p) - Math.pow(IMF_BOUNDS[i], p))) / p / IMF_TOTAL;
  return IMF_CUM[i] + part;
}

/** inverse : quantile u in [0,1] -> masse */
export function imfInv(u: number): number {
  const i = u < IMF_CUM[1] ? 0 : u < IMF_CUM[2] ? 1 : 2;
  const p = 1 - IMF_ALPHA[i];
  const local = ((u - IMF_CUM[i]) * IMF_TOTAL * p) / IMF_C[i];
  return Math.pow(Math.pow(IMF_BOUNDS[i], p) + local, 1 / p);
}

// ---------- Séquence principale ----------
export function lumMS(m: number): number {
  if (m < 0.43) return 0.23 * Math.pow(m, 2.3);
  if (m < 2) return Math.pow(m, 4);
  if (m < 55) return 1.4 * Math.pow(m, 3.5);
  return 40000 * m;
}
export function tempMS(m: number): number {
  const t = m < 1 ? 5778 * Math.pow(m, 0.3) : 5778 * Math.pow(m, 0.6);
  return Math.min(t, 50000);
}
/** durée de la séquence principale (Myr) */
export function tMS(m: number): number {
  return Math.max(3, 10000 * Math.pow(m, -2.5));
}

export const PHASE = {
  UNBORN: 0,
  BROWN_DWARF: 1,
  MAIN_SEQUENCE: 2,
  GIANT: 3,
  SUPERGIANT: 4,
  WHITE_DWARF: 5,
  NEUTRON_STAR: 6,
  BLACK_HOLE: 7,
  SUPERNOVA: 8,
  PLANETARY_NEBULA: 9,
} as const;
export const PHASE_NAMES: Record<number, string> = {
  0: 'non née', 1: 'naine brune', 2: 'séquence principale', 3: 'géante', 4: 'supergéante',
  5: 'naine blanche', 6: 'étoile à neutrons', 7: 'trou noir', 8: 'supernova', 9: 'nébuleuse planétaire',
};

export interface StarState { L: number; T: number; phase: number; radius: number }

/** état d'une étoile de masse m (Msun) à l'âge donné (Myr). Miroir GLSL : stellarState(). */
export function stellarState(m: number, age: number, out: StarState): StarState {
  if (age < 0) { out.L = 0; out.T = 3000; out.phase = PHASE.UNBORN; out.radius = 0; return out; }
  if (m < 0.08) {
    out.L = 1e-4 * Math.exp(-age / 500) + 1e-7; out.T = 1200 + 800 * Math.exp(-age / 500); out.phase = PHASE.BROWN_DWARF;
    out.radius = 0.1; return out;
  }
  const lms = lumMS(m);
  const tms = tMS(m);
  if (age < tms) {
    const f = age / tms;
    out.L = lms * (1 + 0.5 * f * f); out.T = tempMS(m) * (1 - 0.06 * f); out.phase = PHASE.MAIN_SEQUENCE;
    out.radius = Math.sqrt(out.L) * Math.pow(5778 / out.T, 2);
    return out;
  }
  const tpost = age - tms;
  if (m < 8) {
    const tg = 0.15 * tms;
    if (tpost < tg) {
      const f = tpost / tg;
      const peak = 1 + 2500 / (Math.pow(m, 3.5) + 0.7);
      out.L = lms * (1 + (peak - 1) * Math.pow(f, 2.5));
      out.T = 5000 - 1600 * f; out.phase = PHASE.GIANT;
      out.radius = Math.sqrt(out.L) * Math.pow(5778 / out.T, 2);
      return out;
    }
    const twd = tpost - tg;
    if (twd < 0.03) { out.L = 3000 * (1 - twd / 0.03) + 20; out.T = 60000; out.phase = PHASE.PLANETARY_NEBULA; out.radius = 0.02; return out; }
    out.L = 0.1 / Math.pow(1 + twd / 20, 1.4);
    out.T = 60000 / Math.pow(1 + twd / 20, 0.4);
    out.phase = PHASE.WHITE_DWARF; out.radius = 0.012; return out;
  }
  const tsg = 0.1 * tms;
  if (tpost < tsg) {
    const f = tpost / tsg;
    out.L = lms * (2 + 2 * f);
    out.T = m > 40 ? 30000 : tempMS(m) * (1 - f) + 3600 * f;
    out.phase = PHASE.SUPERGIANT;
    out.radius = Math.sqrt(out.L) * Math.pow(5778 / out.T, 2);
    return out;
  }
  const tsn = tpost - tsg;
  // flash (~300 ans : la résolution temporelle des naissances en float32 est ~600 ans) puis rémanent (~20 000 ans)
  if (tsn < 0.1) { out.L = 2e9 * Math.exp(-tsn / 3e-4) + 1e5 * Math.exp(-tsn / 0.02); out.T = tsn < 1e-3 ? 12000 : 30000; out.phase = PHASE.SUPERNOVA; out.radius = 1; return out; }
  if (m < 25) { out.L = 1e-5 * Math.exp(-tsn / 1000) + 1e-8; out.T = 800000; out.phase = PHASE.NEUTRON_STAR; out.radius = 1.5e-5; return out; }
  out.L = 0; out.T = 3000; out.phase = PHASE.BLACK_HOLE; out.radius = 4e-5 * m; return out;
}

// ---------- Histoires de formation stellaire (temps de naissance, Myr) ----------
// u1,u2 uniformes. Miroir GLSL : birthTime().
export function birthTime(comp: Component, u1: number, u2: number): number {
  switch (comp) {
    case 'halo': return u1 * 1500;
    case 'bulge': return u2 < 0.85 ? 500 + u1 * 2000 : 2500 + u1 * 9500;
    case 'thick': return 1000 + u1 * 3000;
    case 'thin': return 3000 + u1 * (T_MAX_BIRTH - 3000);
  }
}
export const YOUNG_TAU = 80; // Myr, âge moyen des étoiles jeunes (tranche "jeune")

// ---------- Couleur corps noir (sRGB approx, Tanner Helland) → linéaire ----------
export function blackbodyRGB(T: number, out: Float32Array | number[] = [0, 0, 0]): typeof out {
  const t = Math.min(Math.max(T, 1000), 40000) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) { r = 1; g = (0.39 * Math.log(t) - 0.6318); b = t <= 19 ? 0 : 0.5432 * Math.log(t - 10) - 1.1962; }
  else { r = 1.2929 * Math.pow(t - 60, -0.1332); g = 1.1299 * Math.pow(t - 60, -0.0755); b = 1; }
  r = Math.min(Math.max(r, 0), 1); g = Math.min(Math.max(g, 0), 1); b = Math.min(Math.max(b, 0), 1);
  out[0] = Math.pow(r, 2.2); out[1] = Math.pow(g, 2.2); out[2] = Math.pow(b, 2.2);
  return out;
}

// ---------- Tables de population moyenne ----------
// Pour chaque composante et chaque temps t, luminosité moyenne par étoile et couleur moyenne pondérée par L.
export interface PopTable { t0: number; dt: number; n: number; L: Float32Array; rgb: Float32Array }

const NM = 240;
const NB = 40;
const massQ = new Float64Array(NM);
for (let i = 0; i < NM; i++) massQ[i] = imfInv((i + 0.5) / NM);

export function buildPopTable(comp: Component, t0 = 0, t1 = T_MAX_BIRTH + 2000, n = 60): PopTable {
  const dt = (t1 - t0) / (n - 1);
  const L = new Float32Array(n);
  const rgb = new Float32Array(n * 3);
  const st: StarState = { L: 0, T: 0, phase: 0, radius: 0 };
  const c = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const t = t0 + k * dt;
    let sumL = 0, sr = 0, sg = 0, sb = 0;
    for (let j = 0; j < NB; j++) {
      const u1 = (j + 0.5) / NB;
      const u2 = ((j * 7) % NB + 0.5) / NB;
      const tb = birthTime(comp, u1, u2);
      for (let i = 0; i < NM; i++) {
        stellarState(massQ[i], t - tb, st);
        if (st.L <= 0 || st.phase === PHASE.SUPERNOVA) continue;
        blackbodyRGB(st.T, c);
        sumL += st.L; sr += st.L * c[0]; sg += st.L * c[1]; sb += st.L * c[2];
      }
    }
    const norm = NM * NB;
    L[k] = sumL / norm;
    if (sumL > 0) { rgb[k * 3] = sr / sumL; rgb[k * 3 + 1] = sg / sumL; rgb[k * 3 + 2] = sb / sumL; }
  }
  return { t0, dt, n, L, rgb };
}

/** population jeune (âges exponentiels, tau = YOUNG_TAU) : L moyenne et couleur, indépendantes de t */
export function youngPopMean(): { L: number; rgb: [number, number, number] } {
  const st: StarState = { L: 0, T: 0, phase: 0, radius: 0 };
  const c = [0, 0, 0];
  let sumL = 0, sr = 0, sg = 0, sb = 0;
  for (let j = 0; j < NB; j++) {
    const age = -YOUNG_TAU * Math.log(1 - (j + 0.5) / NB);
    for (let i = 0; i < NM; i++) {
      stellarState(massQ[i], age, st);
      if (st.L <= 0 || st.phase === PHASE.SUPERNOVA) continue;
      blackbodyRGB(st.T, c);
      sumL += st.L; sr += st.L * c[0]; sg += st.L * c[1]; sb += st.L * c[2];
    }
  }
  const norm = NM * NB;
  return { L: sumL / norm, rgb: [sr / sumL, sg / sumL, sb / sumL] };
}

export function samplePop(tab: PopTable, t: number, out: Float32Array): void {
  const f = Math.min(Math.max((t - tab.t0) / tab.dt, 0), tab.n - 1.001);
  const i = Math.floor(f); const a = f - i;
  out[0] = tab.L[i] * (1 - a) + tab.L[i + 1] * a;
  for (let k = 0; k < 3; k++) out[1 + k] = tab.rgb[i * 3 + k] * (1 - a) + tab.rgb[(i + 1) * 3 + k] * a;
}

/**
 * Table "keep" : pour une population (composante, temps t), fraction de la luminosité réelle provenant des étoiles
 * dont la luminosité réelle L < Lcut, indexée par log10(Lcut). Sert à masquer, dans le champ lointain, la lumière déjà rendue en
 * étoiles individuelles (celles de L_MS >= Lcut à la distance considérée). Dernière ligne : population jeune.
 */
export const KEEP_NL = 64;
export const KEEP_LOGMIN = -4;
export const KEEP_LOGMAX = 7;
export function buildKeepTable(nT = 60, t0 = 0, t1 = T_MAX_BIRTH + 2000): { data: Float32Array; nT: number; t0: number; dt: number; rows: number } {
  const rows = 4 * nT + 1;
  const data = new Float32Array(rows * KEEP_NL);
  const st: StarState = { L: 0, T: 0, phase: 0, radius: 0 };
  const NMk = 160, NBk = 24;
  // histogramme de luminosité (par log10 L) de la population, puis cumul
  const hist = new Float64Array(KEEP_NL);
  const mk = new Float64Array(NMk);
  for (let i = 0; i < NMk; i++) mk[i] = imfInv((i + 0.5) / NMk);
  const addStar = (L: number) => {
    const k = Math.max(0, Math.min(KEEP_NL - 1, Math.ceil(((Math.log10(L) - KEEP_LOGMIN) / (KEEP_LOGMAX - KEEP_LOGMIN)) * (KEEP_NL - 1))));
    hist[k] += L;
  };
  const fillRow = (row: number) => {
    let total = 0;
    for (let k = 0; k < KEEP_NL; k++) total += hist[k];
    let sum = 0;
    for (let k = 0; k < KEEP_NL; k++) {
      data[row * KEEP_NL + k] = total > 0 ? sum / total : 1; // lumière des étoiles de L < Lcut(k)
      sum += hist[k];
    }
    hist.fill(0);
  };
  const dt = (t1 - t0) / (nT - 1);
  COMPONENTS.forEach((comp, c) => {
    for (let k = 0; k < nT; k++) {
      const t = t0 + k * dt;
      for (let j = 0; j < NBk; j++) {
        const tb = birthTime(comp, (j + 0.5) / NBk, ((j * 7) % NBk + 0.5) / NBk);
        for (let i = 0; i < NMk; i++) {
          stellarState(mk[i], t - tb, st);
          if (st.L > 0 && st.phase !== PHASE.SUPERNOVA) addStar(st.L);
        }
      }
      fillRow(c * nT + k);
    }
  });
  for (let j = 0; j < NBk; j++) {
    const age = -YOUNG_TAU * Math.log(1 - (j + 0.5) / NBk);
    for (let i = 0; i < NMk; i++) { stellarState(mk[i], age, st); if (st.L > 0 && st.phase !== PHASE.SUPERNOVA) addStar(st.L); }
  }
  fillRow(4 * nT);
  return { data, nT, t0, dt, rows };
}

/** masse minimale telle que L_MS(m) >= L (inverse numérique) */
export function massForLum(L: number): number {
  if (L <= lumMS(0.01)) return 0.01;
  if (L >= lumMS(150)) return 150;
  let lo = 0.01, hi = 150;
  for (let i = 0; i < 40; i++) { const mid = Math.sqrt(lo * hi); if (lumMS(mid) < L) lo = mid; else hi = mid; }
  return hi;
}
