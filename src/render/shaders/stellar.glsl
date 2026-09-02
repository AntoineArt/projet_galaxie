// Miroir GLSL de src/galaxy/stellar.ts : IMF, évolution, formation, couleur.

// ---- hash entier
uint hashu(uint x) { x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }
float rnd(uint h) { return float(h & 0xffffffu) / 16777216.0; }

// ---- IMF de Kroupa (constantes injectées : uImfCum (vec4), uImfC (vec3))
uniform vec4 uImfCum;
uniform vec3 uImfC;
uniform float uImfTotal;
const vec4 IMF_B = vec4(0.01, 0.08, 0.5, 150.0);
const vec3 IMF_P = vec3(0.7, -0.3, -1.3); // 1 - alpha

float imfInv(float u) {
  int i = u < uImfCum.y ? 0 : (u < uImfCum.z ? 1 : 2);
  float p = IMF_P[i];
  float local = (u - uImfCum[i]) * uImfTotal * p / uImfC[i];
  return pow(pow(IMF_B[i], p) + local, 1.0 / p);
}

float lumMS(float m) {
  if (m < 0.43) return 0.23 * pow(m, 2.3);
  if (m < 2.0) return m * m * m * m;
  if (m < 55.0) return 1.4 * pow(m, 3.5);
  return 40000.0 * m;
}
float tempMS(float m) { return min(m < 1.0 ? 5778.0 * pow(m, 0.3) : 5778.0 * pow(m, 0.6), 50000.0); }
float tMS(float m) { return max(3.0, 10000.0 * pow(m, -2.5)); }

// phases : 0 non née, 1 naine brune, 2 SP, 3 géante, 4 supergéante, 5 naine blanche, 6 étoile à neutrons, 7 trou noir, 8 supernova, 9 néb. planétaire
// retourne vec3(L, T, phase)
vec3 stellarState(float m, float age) {
  if (age < 0.0) return vec3(0.0, 3000.0, 0.0);
  if (m < 0.08) return vec3(1e-4 * exp(-age / 500.0) + 1e-7, 1200.0 + 800.0 * exp(-age / 500.0), 1.0);
  float lms = lumMS(m);
  float tms = tMS(m);
  if (age < tms) {
    float f = age / tms;
    return vec3(lms * (1.0 + 0.5 * f * f), tempMS(m) * (1.0 - 0.06 * f), 2.0);
  }
  float tpost = age - tms;
  if (m < 8.0) {
    float tg = 0.15 * tms;
    if (tpost < tg) {
      float f = tpost / tg;
      float peak = 1.0 + 2500.0 / (pow(m, 3.5) + 0.7);
      return vec3(lms * (1.0 + (peak - 1.0) * pow(f, 2.5)), 5000.0 - 1600.0 * f, 3.0);
    }
    float twd = tpost - tg;
    if (twd < 0.03) return vec3(3000.0 * (1.0 - twd / 0.03) + 20.0, 60000.0, 9.0);
    return vec3(0.1 / pow(1.0 + twd / 20.0, 1.4), 60000.0 / pow(1.0 + twd / 20.0, 0.4), 5.0);
  }
  float tsg = 0.1 * tms;
  if (tpost < tsg) {
    float f = tpost / tsg;
    float T = m > 40.0 ? 30000.0 : tempMS(m) * (1.0 - f) + 3600.0 * f;
    return vec3(lms * (2.0 + 2.0 * f), T, 4.0);
  }
  float tsn = tpost - tsg;
  if (tsn < 0.1) return vec3(2e9 * exp(-tsn / 3e-4) + 1e5 * exp(-tsn / 0.02), tsn < 1e-3 ? 12000.0 : 30000.0, 8.0);
  if (m < 25.0) return vec3(1e-5 * exp(-tsn / 1000.0) + 1e-8, 800000.0, 6.0);
  return vec3(0.0, 3000.0, 7.0);
}

// composante : 0 bulbe, 1 disque mince, 2 disque épais, 3 halo
float birthTime(int comp, float u1, float u2) {
  if (comp == 3) return u1 * 1500.0;
  if (comp == 0) return u2 < 0.85 ? 500.0 + u1 * 2000.0 : 2500.0 + u1 * 9500.0;
  if (comp == 2) return 1000.0 + u1 * 3000.0;
  return 3000.0 + u1 * (T_MAX_BIRTH - 3000.0);
}

vec3 blackbody(float T) {
  float t = clamp(T, 1000.0, 40000.0) / 100.0;
  vec3 c;
  if (t <= 66.0) {
    c.r = 1.0;
    c.g = 0.39 * log(t) - 0.6318;
    c.b = t <= 19.0 ? 0.0 : 0.5432 * log(t - 10.0) - 1.1962;
  } else {
    c.r = 1.2929 * pow(t - 60.0, -0.1332);
    c.g = 1.1299 * pow(t - 60.0, -0.0755);
    c.b = 1.0;
  }
  c = clamp(c, 0.0, 1.0);
  return pow(c, vec3(2.2));
}
