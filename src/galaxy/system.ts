// Système stellaire procédural (compagnon, planètes) généré depuis l'identité d'une étoile.
import { lumMS, stellarState, type StarState } from './stellar';

export const AU_PC = 4.848e-6; // 1 UA en pc
export const RSUN_PC = 2.25e-8;
export const REARTH_RSUN = 0.009168;

export type PlanetKind = 'rocheuse' | 'super-terre' | 'géante de glace' | 'géante gazeuse' | 'jovienne chaude';

export interface Planet {
  a: number; // demi-grand axe (UA)
  e: number;
  period: number; // années
  phase0: number; // rad
  inc: number; // rad
  node: number; // rad, longitude du noeud
  radius: number; // rayons terrestres
  kind: PlanetKind;
  color: [number, number, number];
  mass: number; // masses terrestres
}

export interface Companion {
  mass: number;
  a: number; // UA
  period: number;
  phase0: number;
  inc: number;
  state: StarState;
}

export interface StarSystem {
  id: string;
  mass: number;
  age: number;
  primary: StarState;
  companion: Companion | null;
  planets: Planet[];
  snowLine: number; // UA
}

function hashu(x: number): number {
  x = x >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16; return x >>> 0;
}

export function buildSystem(id: string, seed: number, mass: number, age: number): StarSystem {
  let h = hashu(seed ^ 0x5bd1e995);
  const rnd = () => { h = hashu(h + 0x9e3779b9); return (h & 0xffffff) / 16777216; };
  const primary = stellarState(mass, age, { L: 0, T: 0, phase: 0, radius: 0 });
  const Lzams = lumMS(Math.max(mass, 0.08));
  const snowLine = 2.7 * Math.sqrt(Lzams);

  // compagnon : fraction croissante avec la masse (naines M ~25 %, solaires ~45 %, massives ~70 %)
  let companion: Companion | null = null;
  const fBin = mass < 0.5 ? 0.25 : mass < 2 ? 0.45 : 0.7;
  if (rnd() < fBin) {
    const q = 0.1 + 0.9 * Math.pow(rnd(), 0.7);
    const cm = Math.max(0.012, mass * q);
    const a = Math.pow(10, -0.5 + 3.5 * rnd()); // 0,3 à 1000 UA
    const period = Math.sqrt((a * a * a) / (mass + cm));
    companion = { mass: cm, a, period, phase0: rnd() * 2 * Math.PI, inc: (rnd() - 0.5) * 0.6, state: stellarState(cm, age, { L: 0, T: 0, phase: 0, radius: 0 }) };
  }

  // planètes : ~ 1 à 8, moins autour des étoiles massives et des naines brunes ; aucune si compagnon serré (< 5 UA)
  const planets: Planet[] = [];
  let nMax = mass < 0.08 ? 2 : mass > 8 ? 3 : 8;
  if (companion && companion.a < 5) nMax = 0;
  const n = Math.min(nMax, Math.floor(rnd() * (nMax + 1)));
  let a = 0.04 + 0.4 * rnd() * Math.sqrt(Math.max(mass, 0.1));
  const inc0 = (rnd() - 0.5) * 0.1, node0 = rnd() * 2 * Math.PI;
  for (let i = 0; i < n; i++) {
    if (companion && a > companion.a / 3) break;
    const beyond = a > snowLine;
    const r = rnd();
    let kind: PlanetKind, radius: number, pmass: number, color: [number, number, number];
    if (a < 0.1 && r < 0.15) { kind = 'jovienne chaude'; radius = 10 + 4 * rnd(); pmass = 100 + 300 * rnd(); color = [0.85, 0.6, 0.4]; }
    else if (!beyond) {
      if (r < 0.55) { kind = 'rocheuse'; radius = 0.4 + 1.0 * rnd(); pmass = Math.pow(radius, 3.7); color = rnd() < 0.5 ? [0.6, 0.5, 0.4] : [0.45, 0.55, 0.7]; }
      else { kind = 'super-terre'; radius = 1.4 + 1.2 * rnd(); pmass = Math.pow(radius, 3.7); color = [0.5, 0.6, 0.75]; }
    } else {
      if (r < 0.5) { kind = 'géante gazeuse'; radius = 8 + 5 * rnd(); pmass = 50 + 400 * rnd(); color = rnd() < 0.5 ? [0.8, 0.7, 0.55] : [0.75, 0.65, 0.5]; }
      else { kind = 'géante de glace'; radius = 3 + 2 * rnd(); pmass = 10 + 15 * rnd(); color = [0.45, 0.65, 0.85]; }
    }
    const period = Math.sqrt((a * a * a) / Math.max(mass, 0.05));
    planets.push({ a, e: 0.02 + 0.15 * rnd() * rnd(), period, phase0: rnd() * 2 * Math.PI, inc: inc0 + (rnd() - 0.5) * 0.06, node: node0, radius, kind, color, mass: pmass });
    a *= 1.4 + 1.0 * rnd();
    if (a > 60) break;
  }
  return { id, mass, age, primary, companion, planets, snowLine };
}

/** position (UA, repère du système : plan de référence xy) d'une planète à l'instant t (années) */
export function orbitPosition(a: number, e: number, period: number, phase0: number, inc: number, node: number, tYears: number, out: Float64Array): void {
  const M = phase0 + (2 * Math.PI * tYears) / period; // anomalie moyenne
  // équation de Kepler (quelques itérations de Newton)
  let E = M;
  for (let i = 0; i < 5; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const x = a * (Math.cos(E) - e), y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  // inclinaison autour de l'axe du noeud
  const cn = Math.cos(node), sn = Math.sin(node), ci = Math.cos(inc), si = Math.sin(inc);
  const xr = x * cn - y * sn, yr = x * sn + y * cn;
  out[0] = xr; out[1] = yr * ci; out[2] = yr * si;
}
