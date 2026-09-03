// Système stellaire procédural (compagnon, planètes, lunes, anneaux, ceintures) généré depuis l'identité d'une étoile.
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
  moons: Moon[];
  rings: { inner: number; outer: number } | null; // en rayons planétaires
}

export interface Moon {
  a: number; // UA (distance à la planète)
  period: number; // années
  phase0: number;
  inc: number;
  radius: number; // rayons terrestres
  color: [number, number, number];
  kind: 'rocheuse' | 'glacée';
}

export interface Belt {
  inner: number; // UA
  outer: number; // UA
  kind: 'astéroïdes' | 'Kuiper';
  n: number; // nombre de points rendus
  thickness: number; // demi-épaisseur relative (inclinaisons)
  seed: number;
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
  belts: Belt[];
  snowLine: number; // UA
  inc0: number; // plan du système
  node0: number;
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
    // lunes : géantes 1-7 (Hill), rocheuses 0-2 ; distance en rayons planétaires, période képlérienne autour de la planète
    const moons: Moon[] = [];
    const giant = kind === 'géante gazeuse' || kind === 'géante de glace';
    const nMoons = giant ? 1 + Math.floor(rnd() * 7) : (kind === 'jovienne chaude' ? 0 : Math.floor(rnd() * 2.6));
    const rpAU = radius * REARTH_RSUN * RSUN_PC / AU_PC; // rayon planétaire en UA
    let am = (giant ? 5 : 8) + 6 * rnd();
    for (let k = 0; k < nMoons; k++) {
      const aMoon = am * rpAU;
      const hill = a * Math.cbrt(pmass / (3 * 333000 * Math.max(mass, 0.05)));
      if (aMoon > hill * 0.4) break;
      const mr = giant ? 0.05 + 0.4 * rnd() : 0.03 + 0.25 * rnd() * radius;
      const icy = beyond || rnd() < 0.3;
      const periodM = Math.sqrt(Math.pow(aMoon, 3) / (pmass / 333000)) ; // années, masse planète en M☉
      moons.push({ a: aMoon, period: periodM, phase0: rnd() * 2 * Math.PI, inc: (rnd() - 0.5) * 0.08, radius: mr, color: icy ? [0.8, 0.85, 0.9] : [0.55, 0.52, 0.48], kind: icy ? 'glacée' : 'rocheuse' });
      am *= 1.6 + 0.8 * rnd();
    }
    const rings = giant && rnd() < 0.35 ? { inner: 1.3 + 0.4 * rnd(), outer: 2.0 + 0.8 * rnd() } : null;
    planets.push({ a, e: 0.02 + 0.15 * rnd() * rnd(), period, phase0: rnd() * 2 * Math.PI, inc: inc0 + (rnd() - 0.5) * 0.06, node: node0, radius, kind, color, mass: pmass, moons, rings });
    a *= 1.4 + 1.0 * rnd();
    if (a > 60) break;
  }
  // ceintures : d'astéroïdes dans un grand intervalle entre deux planètes (vers la ligne des glaces), de Kuiper au-delà
  const belts: Belt[] = [];
  for (let i = 0; i + 1 < planets.length; i++) {
    const p0 = planets[i], p1 = planets[i + 1];
    if (p1.a / p0.a > 2.6 && rnd() < 0.7) belts.push({ inner: p0.a * 1.4, outer: p1.a * 0.7, kind: 'astéroïdes', n: 3000, thickness: 0.06, seed: hashu(seed + 7 * i) });
  }
  if (planets.length > 0 && rnd() < 0.7 && !(companion && companion.a < planets[planets.length - 1].a * 6)) {
    const aLast = planets[planets.length - 1].a;
    belts.push({ inner: aLast * 1.6, outer: aLast * 3.2, kind: 'Kuiper', n: 4000, thickness: 0.15, seed: hashu(seed + 991) });
  }
  return { id, mass, age, primary, companion, planets, belts, snowLine, inc0, node0 };
}

/** position (UA, repère du système : plan de référence xy) d'un corps en orbite à l'instant t (années) */
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

export interface BodyPos {
  kind: 'star' | 'companion' | 'planet' | 'moon';
  planet: number; // index de la planète (planète ou lune)
  moon: number; // index de la lune, -1 sinon
  x: number; y: number; z: number; // UA, repère du système
  radius: number; // pc
}

/** positions de tous les corps du système à l'instant t (années), repère du système (UA) */
export function systemBodies(sys: StarSystem, tYears: number, out: BodyPos[] = []): BodyPos[] {
  out.length = 0;
  const tmp = new Float64Array(3);
  out.push({ kind: 'star', planet: -1, moon: -1, x: 0, y: 0, z: 0, radius: Math.max(sys.primary.radius, 1e-3) * RSUN_PC });
  if (sys.companion) {
    const C = sys.companion;
    orbitPosition(C.a, 0.05, C.period, C.phase0, C.inc, 0, tYears, tmp);
    out.push({ kind: 'companion', planet: -1, moon: -1, x: tmp[0], y: tmp[1], z: tmp[2], radius: Math.max(C.state.radius, 1e-3) * RSUN_PC });
  }
  sys.planets.forEach((pl, i) => {
    orbitPosition(pl.a, pl.e, pl.period, pl.phase0, pl.inc, pl.node, tYears, tmp);
    const px = tmp[0], py = tmp[1], pz = tmp[2];
    out.push({ kind: 'planet', planet: i, moon: -1, x: px, y: py, z: pz, radius: pl.radius * REARTH_RSUN * RSUN_PC });
    pl.moons.forEach((m, k) => {
      orbitPosition(m.a, 0.01, m.period, m.phase0, pl.inc + m.inc, pl.node, tYears, tmp);
      out.push({ kind: 'moon', planet: i, moon: k, x: px + tmp[0], y: py + tmp[1], z: pz + tmp[2], radius: m.radius * REARTH_RSUN * RSUN_PC });
    });
  });
  return out;
}
