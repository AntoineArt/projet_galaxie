// Unités : parsec (pc), million d'années (Myr), masse solaire, luminosité solaire.

export const N_STARS_TOTAL = 2e11;

// Age de la galaxie à "aujourd'hui" (Myr) et horizon de formation stellaire du disque mince.
export const T_PRESENT = 13000;
export const T_MAX_BIRTH = 20000;

// Fractions d'étoiles par composante (à T_PRESENT).
export const FRAC = { bulge: 0.2, thin: 0.65, thick: 0.13, halo: 0.02 } as const;
export const COMPONENTS = ['bulge', 'thin', 'thick', 'halo'] as const;
export type Component = (typeof COMPONENTS)[number];

// Disque mince
export const THIN_RL = 2600; // longueur d'échelle radiale
export const THIN_HZ = 300; // hauteur d'échelle
export const THIN_RMAX = 25000;
// Disque épais
export const THICK_RL = 3600;
export const THICK_HZ = 900;
// Bulbe / barre
export const BULGE_A = 700; // rayon d'échelle (Hernquist)
export const BULGE_RMAX = 3500;
export const BAR_ANGLE = (25 * Math.PI) / 180;
export const BAR_AXES = { x: 1, y: 0.45, z: 0.35 };
// Halo
export const HALO_RC = 4000;
export const HALO_Q = 0.7;
export const HALO_RMAX = 40000;

// Bras spiraux (logarithmiques)
export const ARMS = [
  { phi0: 0.0, amp: 1.2 },
  { phi0: Math.PI, amp: 1.2 },
  { phi0: Math.PI * 0.5, amp: 0.55 },
  { phi0: Math.PI * 1.5, amp: 0.55 },
];
export const ARM_PITCH = (13 * Math.PI) / 180;
export const ARM_R0 = 3500;
export const ARM_SIGMA = 0.22; // largeur azimutale (rad)
export const ARM_RMIN = 2800;
// Vitesse angulaire du motif spiral (rad/Myr) ; ~ 25 km/s/kpc
export const PATTERN_OMEGA = 25 * 1.0227e-3 / 1000;

// Courbe de rotation plate : v(R) en pc/Myr (220 km/s ≈ 225 pc/Myr)
export function circularVelocity(R: number): number {
  const v0 = 225;
  const rc = 1500;
  return (v0 * R) / Math.sqrt(R * R + rc * rc);
}
export function omega(R: number): number {
  return circularVelocity(R) / Math.max(R, 1);
}

// Position du Soleil (pc), dans le référentiel du motif spiral.
export const SUN_POS = { x: -8200, y: 0, z: 20 };

// Racine de l'octree : cube centré sur l'origine.
export const ROOT_HALF = 32768;
export const MAX_LEVEL = 10; // feuille = 64 pc
export const GRID_LEVEL = 7; // grille précalculée : 512 pc
