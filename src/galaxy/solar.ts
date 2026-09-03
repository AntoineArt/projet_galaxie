// Le Système solaire réel, à la position du Soleil : planètes, lunes principales, anneaux, ceintures, comètes.
// Éléments orbitaux J2000 (demi-grand axe, excentricité, anomalie moyenne, longitude du périhélie).
import { stellarState } from './stellar';
import { AU_PC, REARTH_RSUN, RSUN_PC, type Belt, type Comet, type Moon, type Planet, type StarSystem } from './system';
import { SUN_POS, T_PRESENT } from './params';

export const SUN_AGE = 4600; // Myr
export const SUN_ID = 'soleil';
const KM_AU = 1 / 1.496e8;
const DEG = Math.PI / 180;
const T0_YEARS = T_PRESENT * 1e6; // instant "aujourd'hui" en années simulées

/** anomalie moyenne à l'époque courante (t = aujourd'hui) ramenée à une phase à t = 0 */
function phaseFor(meanAnomalyDeg: number, periodYears: number): number {
  const m = meanAnomalyDeg * DEG;
  const cycles = T0_YEARS / periodYears;
  return ((m - 2 * Math.PI * (cycles - Math.floor(cycles))) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
}

function moon(name: string, aKm: number, periodDays: number, radius: number, icy: boolean, inc = 0): Moon {
  return { name, a: aKm * KM_AU, period: periodDays / 365.25, phase0: (name.length * 1.7) % (2 * Math.PI), inc: inc * DEG, radius, color: icy ? [0.8, 0.85, 0.9] : [0.55, 0.52, 0.48], kind: icy ? 'glacée' : 'rocheuse' };
}

function planet(name: string, a: number, e: number, period: number, radius: number, mass: number, color: [number, number, number], kind: Planet['kind'], M: number, peri: number, inc: number, moons: Moon[], rings: Planet['rings'] = null): Planet {
  return { name, a, e, period, phase0: phaseFor(M, period), inc: inc * DEG, node: peri * DEG, radius, kind, color, mass, moons, rings };
}

export function buildSolarSystem(time: number): StarSystem {
  const age = time - (T_PRESENT - SUN_AGE);
  const planets: Planet[] = [
    planet('Mercure', 0.387, 0.206, 0.241, 0.383, 0.055, [0.6, 0.58, 0.55], 'rocheuse', 174.8, 77.46, 7.0, []),
    planet('Vénus', 0.723, 0.007, 0.615, 0.949, 0.815, [0.9, 0.82, 0.6], 'rocheuse', 50.4, 131.53, 3.4, []),
    planet('Terre', 1.0, 0.017, 1.0, 1.0, 1.0, [0.35, 0.5, 0.85], 'rocheuse', 357.5, 102.94, 0.0, [moon('Lune', 384400, 27.32, 0.273, false, 5.1)]),
    planet('Mars', 1.524, 0.093, 1.881, 0.532, 0.107, [0.8, 0.45, 0.3], 'rocheuse', 19.4, 336.04, 1.85, [moon('Phobos', 9377, 0.319, 0.0017, false), moon('Deimos', 23460, 1.263, 0.001, false)]),
    planet('Jupiter', 5.203, 0.048, 11.86, 11.2, 318, [0.8, 0.7, 0.55], 'géante gazeuse', 20.0, 14.75, 1.3, [moon('Io', 421800, 1.769, 0.286, false), moon('Europe', 671100, 3.551, 0.245, true), moon('Ganymède', 1070400, 7.155, 0.413, true), moon('Callisto', 1882700, 16.69, 0.378, true)]),
    planet('Saturne', 9.537, 0.054, 29.46, 9.45, 95.2, [0.85, 0.78, 0.6], 'géante gazeuse', 317.0, 92.43, 2.5, [moon('Encelade', 238000, 1.37, 0.04, true), moon('Rhéa', 527000, 4.52, 0.12, true), moon('Titan', 1221870, 15.95, 0.404, true)], { inner: 1.24, outer: 2.27 }),
    planet('Uranus', 19.19, 0.047, 84.0, 4.0, 14.5, [0.6, 0.85, 0.9], 'géante de glace', 142.2, 170.96, 0.77, [moon('Titania', 436000, 8.71, 0.124, true), moon('Obéron', 583500, 13.46, 0.119, true)], { inner: 1.6, outer: 2.0 }),
    planet('Neptune', 30.07, 0.009, 164.8, 3.88, 17.1, [0.3, 0.45, 0.95], 'géante de glace', 259.9, 44.97, 1.77, [moon('Triton', 354800, 5.88, 0.212, true, 157)]),
    planet('Pluton', 39.48, 0.249, 248.0, 0.186, 0.0022, [0.75, 0.65, 0.55], 'rocheuse', 14.9, 224.07, 17.1, [moon('Charon', 19600, 6.39, 0.095, true)]),
    planet('Cérès', 2.77, 0.076, 4.6, 0.074, 0.00016, [0.5, 0.48, 0.45], 'rocheuse', 95.9, 73.6, 10.6, []),
  ];
  const belts: Belt[] = [
    { inner: 2.1, outer: 3.3, kind: 'astéroïdes', n: 3500, thickness: 0.18, seed: 11 },
    { inner: 30, outer: 50, kind: 'Kuiper', n: 4500, thickness: 0.3, seed: 12 },
  ];
  const comet = (name: string, a: number, e: number, inc: number, M: number, peri: number): Comet => {
    const period = Math.sqrt(a * a * a);
    return { name, a, e, period, phase0: phaseFor(M, period), inc: inc * DEG, node: peri * DEG, radius: 0.002 };
  };
  const comets: Comet[] = [comet('Halley', 17.83, 0.967, 162.3, 180, 111.3), comet('Hale-Bopp', 186, 0.995, 89.4, 3, 130.6), comet('Encke', 2.22, 0.848, 11.8, 90, 186.5)];
  return {
    id: SUN_ID, mass: 1.0, age, primary: stellarState(1.0, age, { L: 0, T: 0, phase: 0, radius: 0 }), companion: null,
    planets, belts, comets, snowLine: 2.7, inc0: 0, node0: 0, pulsarPeriod: 1,
  };
}

/** l'étoile "Soleil" au sens de la sonde (position dans le référentiel du motif, pc) */
export const SUN_STAR_POS = { x: SUN_POS.x, y: SUN_POS.y, z: SUN_POS.z };
export const SUN_RADIUS_PC = RSUN_PC;
export const EARTH_RADIUS_PC = REARTH_RSUN * RSUN_PC;
export const SUN_VISIT_AU = 30 * AU_PC;
