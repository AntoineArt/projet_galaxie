// Extinction interstellaire : profondeur optique intégrée le long de la ligne de visée dans le modèle de
// poussière (disque exponentiel R/3200 pc, |z|/110 pc, renforcé dans les bras, trou central).
// L'intégrale verticale est analytique par segment ; la partie radiale/azimutale est échantillonnée.
uniform float uKappa; // calibration : tau_V par unité de densité de poussière * pc
uniform float uDustOn;

#define DUST_HZ 110.0
#define DUST_HR 3200.0

// facteur de bras (identique à density.ts : armFactor)
float armFactor(float R, float phi) {
  if (R < 1960.0) return 0.0;
  float base = ARM_K * log(R / ARM_R0);
  float f = 0.0;
  float s = ARM_SIGMA * (0.7 + 0.3 * min(R / 8000.0, 2.0));
  for (int i = 0; i < 4; i++) {
    float d = phi - (base + ARM_PHI[i]);
    d -= 6.2831853 * floor(d / 6.2831853 + 0.5);
    f += ARM_AMP[i] * exp(-0.5 * d * d / (s * s));
  }
  float fadeIn = clamp((R - 1960.0) / 1400.0, 0.0, 1.0);
  float fadeOut = max(0.0, 1.0 - max(0.0, R - 16000.0) / 8000.0);
  return min(f, 1.0) * fadeIn * fadeOut;
}

// primitive de exp(-|z|/hz)
float dustH(float z) {
  float a = abs(z);
  return sign(z) * DUST_HZ * (1.0 - exp(-a / DUST_HZ));
}

// tau_V entre la caméra (cam, réf. motif) et cam + rel
float dustTau(vec3 cam, vec3 rel) {
  const int N = 4;
  float d = length(rel);
  if (d < 1.0) return 0.0;
  vec3 dir = rel / d;
  // au-delà de 25 kpc du centre, plus de poussière : on tronque le segment
  float tau = 0.0;
  float m = dir.z;
  for (int k = 0; k < N; k++) {
    float sa = d * float(k) / float(N), sb = d * float(k + 1) / float(N);
    vec3 pm = cam + dir * (0.5 * (sa + sb));
    float R = length(pm.xy);
    if (R > 20000.0) continue;
    float za = cam.z + m * sa, zb = cam.z + m * sb;
    float zint = abs(m) > 1e-4 ? (dustH(zb) - dustH(za)) / m : exp(-abs(za) / DUST_HZ) * (sb - sa);
    float phi = atan(pm.y, pm.x);
    float arm = armFactor(R * 1.04, phi + 0.03);
    float hole = 1.0 - exp(-(R * R) / (2500.0 * 2500.0));
    float radial = exp(-R / DUST_HR) * hole * (0.25 + 1.6 * arm);
    tau += radial * zint;
  }
  return tau * uKappa;
}

// variante rapide (objets nombreux) : 2 segments, sans modulation par les bras
float dustTauFast(vec3 cam, vec3 rel) {
  float d = length(rel);
  if (d < 1.0) return 0.0;
  vec3 dir = rel / d;
  float m = dir.z;
  float tau = 0.0;
  for (int k = 0; k < 2; k++) {
    float sa = d * float(k) * 0.5, sb = d * float(k + 1) * 0.5;
    vec3 pm = cam + dir * (0.5 * (sa + sb));
    float R = length(pm.xy);
    if (R > 20000.0) continue;
    float za = cam.z + m * sa, zb = cam.z + m * sb;
    float zint = abs(m) > 1e-4 ? (dustH(zb) - dustH(za)) / m : exp(-abs(za) / DUST_HZ) * (sb - sa);
    float hole = 1.0 - exp(-(R * R) / (2500.0 * 2500.0));
    tau += exp(-R / DUST_HR) * hole * 0.6 * zint;
  }
  return tau * uKappa;
}

// transmission RGB (rougissement : loi ~ 1/lambda)
vec3 dustTransmission(vec3 cam, vec3 rel) {
  if (uDustOn < 0.5) return vec3(1.0);
#ifdef EXT_FAST
  float tau = dustTauFast(cam, rel);
#else
  float tau = dustTau(cam, rel);
#endif
  return exp(-tau * vec3(0.75, 1.0, 1.45));
}
