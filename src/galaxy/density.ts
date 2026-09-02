import * as P from './params';

// Densité numérique non normalisée par composante en (x,y,z), référentiel du motif spiral.
// out = [bulge, thin, thick, halo], retourne aussi le facteur "bras" (0..1) via out[4].
export type DensityOut = Float64Array; // longueur 5

const cosB = Math.cos(P.BAR_ANGLE);
const sinB = Math.sin(P.BAR_ANGLE);
const TWO_PI = Math.PI * 2;
const ARM_N = P.ARMS.length;
const ARM_K = 1 / Math.tan(P.ARM_PITCH);

// Modulation spirale : 0 hors bras, 1 au coeur d'un bras majeur.
export function armFactor(R: number, phi: number): number {
  if (R < P.ARM_RMIN * 0.7) return 0;
  const base = ARM_K * Math.log(R / P.ARM_R0);
  let f = 0;
  for (let i = 0; i < ARM_N; i++) {
    let d = phi - (base + P.ARMS[i].phi0);
    d -= TWO_PI * Math.round(d / TWO_PI);
    const s = P.ARM_SIGMA * (0.7 + 0.3 * Math.min(R / 8000, 2));
    const g = Math.exp((-0.5 * d * d) / (s * s));
    f += (P.ARMS[i].amp / 1.2) * g;
  }
  // affaiblissement aux bords
  const fadeIn = Math.min(1, Math.max(0, (R - P.ARM_RMIN * 0.7) / (P.ARM_RMIN * 0.5)));
  const fadeOut = Math.max(0, 1 - Math.max(0, R - 16000) / 8000);
  return Math.min(1, f) * fadeIn * fadeOut;
}

export function density(x: number, y: number, z: number, out: DensityOut): void {
  const R2 = x * x + y * y;
  const R = Math.sqrt(R2);
  const az = Math.abs(z);
  const r2 = R2 + z * z;

  // --- bulbe + barre (Hernquist triaxial avec coeur)
  let bulge = 0;
  if (r2 < P.BULGE_RMAX * P.BULGE_RMAX * 1.5) {
    const bx = x * cosB + y * sinB;
    const by = -x * sinB + y * cosB;
    const m2 = (bx * bx) / (P.BAR_AXES.x * P.BAR_AXES.x) + (by * by) / (P.BAR_AXES.y * P.BAR_AXES.y) + (z * z) / (P.BAR_AXES.z * P.BAR_AXES.z);
    const m = Math.sqrt(m2 + 40 * 40);
    const a = P.BULGE_A;
    const hern = 1 / ((m / a) * Math.pow(1 + m / a, 3));
    const trunc = Math.exp(-(m2) / (P.BULGE_RMAX * P.BULGE_RMAX));
    // amas nucléaire central
    const nsc = 40 * Math.exp(-r2 / (60 * 60));
    bulge = hern * trunc + nsc;
  }

  // --- disque mince avec bras
  let thin = 0;
  let arm = 0;
  if (R < P.THIN_RMAX && az < 3000) {
    const phi = Math.atan2(y, x);
    arm = armFactor(R, phi);
    const hz = P.THIN_HZ * (0.6 + 0.4 * Math.min(R / 8000, 2.5)); // évasement
    const hole = 1 - Math.exp(-(R2) / (1200 * 1200)); // trou central (barre)
    thin = Math.exp(-R / P.THIN_RL) * Math.exp(-az / hz) * hole * (1 + 0.5 * arm) * Math.exp(-Math.pow(R / P.THIN_RMAX, 8));
  }

  // --- disque épais
  let thick = 0;
  if (R < P.THIN_RMAX * 1.2 && az < 8000) {
    thick = Math.exp(-R / P.THICK_RL) * Math.exp(-az / P.THICK_HZ) * (1 - 0.6 * Math.exp(-(R2) / (1500 * 1500)));
  }

  // --- halo stellaire aplati
  let halo = 0;
  {
    const q = P.HALO_Q;
    const s2 = R2 + (z * z) / (q * q);
    const rc = P.HALO_RC;
    halo = Math.pow(1 + s2 / (rc * rc), -1.75) * Math.exp(-s2 / (P.HALO_RMAX * P.HALO_RMAX));
  }

  out[0] = bulge;
  out[1] = thin;
  out[2] = thick;
  out[3] = halo;
  out[4] = arm;
}

// Densité de poussière (non normalisée) : disque fin, concentrée dans les bras (légèrement décalés vers l'intérieur).
export function dustDensity(x: number, y: number, z: number): number {
  const R2 = x * x + y * y;
  const R = Math.sqrt(R2);
  const az = Math.abs(z);
  if (R > 18000 || az > 600) return 0;
  const phi = Math.atan2(y, x);
  const arm = armFactor(R * 1.04, phi + 0.03);
  const hole = 1 - Math.exp(-(R2) / (2500 * 2500));
  return Math.exp(-R / 3200) * Math.exp(-az / 110) * hole * (0.25 + 1.6 * arm);
}

// Profondeur optique tau_V entre cam et cam+rel (miroir de extinction.glsl : 4 segments, intégrale verticale analytique).
const DUST_HZ = 110, DUST_HR = 3200;
function dustH(z: number): number { return Math.sign(z) * DUST_HZ * (1 - Math.exp(-Math.abs(z) / DUST_HZ)); }
export function dustTau(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, kappa: number): number {
  const d = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (d < 1) return 0;
  const dx = rx / d, dy = ry / d, m = rz / d;
  let tau = 0;
  for (let k = 0; k < 4; k++) {
    const sa = (d * k) / 4, sb = (d * (k + 1)) / 4, sm = 0.5 * (sa + sb);
    const px = cx + dx * sm, py = cy + dy * sm;
    const R = Math.sqrt(px * px + py * py);
    if (R > 20000) continue;
    const za = cz + m * sa, zb = cz + m * sb;
    const zint = Math.abs(m) > 1e-4 ? (dustH(zb) - dustH(za)) / m : Math.exp(-Math.abs(za) / DUST_HZ) * (sb - sa);
    const arm = armFactor(R * 1.04, Math.atan2(py, px) + 0.03);
    const hole = 1 - Math.exp(-(R * R) / (2500 * 2500));
    tau += Math.exp(-R / DUST_HR) * hole * (0.25 + 1.6 * arm) * zint;
  }
  return tau * kappa;
}
