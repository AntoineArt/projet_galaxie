// Génération procédurale d'une étoile. gl_VertexID parcourt l'union des plages visibles [a_c, b_c) des 22 tranches
// de population du noeud (voir src/galaxy/bins.ts) ; dans chaque tranche l'index croît avec la masse décroissante.
in float position; // factice (compte de sommets)
in vec4 aA; // origine du cube (relative à l'ancre, réf. motif) xyz, taille
in vec4 aB; // graine, N bulbe, N mince, N épais
in vec4 aC; // N halo, fraction jeune, index de seuil (table uVis), -
in vec4 aD; // gradient de densité (x,y,z), dérive ax
in vec4 aE; // dérive ay, phase x, phase y, facteur bras max du noeud (+2 si les résidus sont inclus)

uniform mat4 uProj;
uniform mat4 uView; // rotation seule
uniform vec3 uAnchorRel; // ancre - caméra (réf. motif)
uniform vec3 uCamPat; // caméra (réf. motif)
uniform float uTheta; // rotation motif -> monde
uniform float uTime; // Myr
uniform float uTRef;
uniform float uFluxMin;
uniform float uExposure;
uniform float uPixelScale; // pixels par unité d'angle
uniform float uMaxSize;
uniform float uSizeGain;
uniform float uQTO[NBINS]; // quantile de turnoff par tranche
uniform float uDebugBin; // 1 : couleur par tranche (rouge jeunes, vert disque mince, bleu autres)
uniform float uArmReject; // 1 : rejet selon le profil de bras (étoiles jeunes)
uniform vec3 uSkip; // (graine, tranche, index) de l'étoile rendue par le système stellaire (résolue à part)
#ifdef VIS_TEXTURE
uniform sampler2D uVis; // quantile visible [seuil x tranche] (GPU à peu de registres uniformes)
#else
uniform vec4 uVisTab[NBINS * 16]; // quantile visible [tranche][seuil], 64 seuils par tranche
#endif

out vec3 vColor;
out float vIntensity;
out float vSize;

#include <stellar>
#include <extinction>

float warp1(float v, float s) {
  if (abs(s) < 1e-3) return v;
  float b = 1.0 - 0.5 * s;
  return (-b + sqrt(b * b + 2.0 * s * v)) / s;
}

float binN(int c) {
  if (c == 0) return aC.x;
  if (c == 1) return 0.85 * aB.y;
  if (c == 2) return 0.15 * aB.y;
  if (c == 3) return aB.w;
  if (c < 21) return aB.z * (1.0 - aC.y) / 17.0;
  return aB.z * aC.y * YOUNG_W[c - 21];
}
// temps de naissance d'une étoile de la tranche c (u uniforme)
float birthInBin(int c, float u) {
  if (c == 0) return u * 1500.0;
  if (c == 1) return 500.0 + u * 2000.0;
  if (c == 2) return 2500.0 + u * 9500.0;
  if (c == 3) return 1000.0 + u * 3000.0;
  if (c < 21) return 3000.0 + float(c - 4) * 1000.0 + u * 1000.0;
  float a0 = YOUNG_AGES[c - 21], a1 = YOUNG_AGES[c - 20];
  float age = a0 - YOUNG_TAU * log(1.0 - u * (1.0 - exp(-(a1 - a0) / YOUNG_TAU)));
  return uTime - age;
}

void cull() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vIntensity = 0.0; }

void main() {
  float v = float(gl_VertexID);
  bool includeDead = aE.w >= 2.0;
  int visIdx = int(aC.z + 0.5);
  // localisation de la tranche
  int bin = -1;
  float j = 0.0, N = 0.0;
  float acc = 0.0;
  for (int c = 0; c < NBINS; c++) {
    float n = binN(c);
    if (n <= 0.0) continue;
    float a = includeDead ? 0.0 : floor(n * uQTO[c]);
#ifdef VIS_TEXTURE
    float qv = texelFetch(uVis, ivec2(visIdx, c), 0).r;
#else
    int vi = c * 64 + visIdx;
    float qv = uVisTab[vi >> 2][vi & 3];
#endif
    float b = floor(n * qv + 0.5);
    float len = b - a;
    if (len <= 0.0) continue;
    if (v < acc + len) { bin = c; j = a + (v - acc); N = n; break; }
    acc += len;
  }
  if (bin < 0) {
    if (uDebugBin > 2.5) {
      // débogage : sommet sans tranche -> point rouge au centre du noeud
      vec3 pc = uAnchorRel + aA.xyz + vec3(0.5 * aA.w);
      float cs0 = cos(uTheta), sn0 = sin(uTheta);
      vec3 relc = vec3(cs0 * pc.x - sn0 * pc.y, sn0 * pc.x + cs0 * pc.y, pc.z);
      gl_Position = uProj * (uView * vec4(relc, 1.0)); gl_PointSize = 3.0; vSize = 3.0; vIntensity = 0.3; vColor = vec3(1.0, 0.0, 0.0); return;
    }
    cull(); return;
  }
  if (aB.x == uSkip.x && float(bin) == uSkip.y && j == uSkip.z) { cull(); return; }

  uint seed = uint(aB.x);
  uint i = uint(j) + uint(bin) * 0x01000193u;
  uint base = hashu(seed ^ (i * 0x9E3779B9u));
  float r0 = rnd(hashu(base + 1u)), r2 = rnd(hashu(base + 3u));
  float r3 = rnd(hashu(base + 4u)), r4 = rnd(hashu(base + 5u));
  float r5 = rnd(hashu(base + 6u)), r6 = rnd(hashu(base + 7u)), r8 = rnd(hashu(base + 9u)), r9 = rnd(hashu(base + 10u));

  // masse : quantile décroissant dans la tranche
  float q = 1.0 - (j + r0) / N;
  if (bin >= 4 && bin < 21) q *= F_CAP;
  float m = imfInv(clamp(q, 1e-7, 1.0 - 1e-7));

  float tb = birthInBin(bin, r6 * 0.9999);
  float age = uTime - tb;
  vec3 st = stellarState(m, age);
  float L = st.x;
  if (uDebugBin > 1.5) L = 1e6;
  if (L <= 0.0) { cull(); return; }

  // position : dérive azimutale + repliement + déformation par gradient
  float size = aA.w;
  float dt = uTime - uTRef;
  bool diskStar = bin >= 3;
  vec2 disp = (vec2(r8, r9) - 0.5) * (diskStar ? 30.0 : 120.0) / size; // dispersion (pc/Myr) en unités de cube
  vec2 ph = aE.yz + vec2(aD.w, aE.x) * dt + disp * uTime;
  vec3 u = vec3(fract(r2 + ph.x), fract(r3 + ph.y), r4);
  u = vec3(warp1(u.x, aD.x), warp1(u.y, aD.y), warp1(u.z, aD.z));
  vec3 p = uAnchorRel + aA.xyz + u * size; // relatif caméra, réf. motif
  if (bin >= 21 && uArmReject > 0.5) {
    // étoiles jeunes : le compte du noeud suppose le facteur de bras maximal ; rejet selon le profil local exact
    vec3 pa = uCamPat + p;
    float armMax = aE.w >= 2.0 ? aE.w - 2.0 : aE.w;
    float a = armFactor(length(pa.xy), atan(pa.y, pa.x));
    float keep = (YOUNG_BASE + YOUNG_ARM * a) / (YOUNG_BASE + YOUNG_ARM * armMax);
    if (r5 > keep && uDebugBin < 1.5) { cull(); return; }
  }
  float cs = cos(uTheta), sn = sin(uTheta);
  vec3 rel = vec3(cs * p.x - sn * p.y, sn * p.x + cs * p.y, p.z);

  float d2 = dot(rel, rel);
  float d = sqrt(d2);
  float flux = L / max(d2, 1e-10);
  if (flux < uFluxMin * 0.5 && uDebugBin < 1.5) { cull(); return; }
  vec3 trans = dustTransmission(uCamPat, p);
  flux *= trans.g;

  gl_Position = uProj * (uView * vec4(rel, 1.0));

  float b = flux * uExposure;
  float sz = 1.5 + uSizeGain * log2(max(b, 1.0));
  float radiusPc = sqrt(L) * pow(5778.0 / st.y, 2.0) * 2.25e-8;
  float physPx = radiusPc / d * uPixelScale * 2.0;
  sz = clamp(max(sz, physPx), 1.0, uMaxSize);
  gl_PointSize = sz;
  vSize = sz;
  vIntensity = b / max(1.0, 0.35 * sz * sz);
  vColor = blackbody(st.y) * trans / max(trans.g, 1e-4);
  if (uDebugBin > 0.5) { vColor = uDebugBin > 2.5 ? vec3(0.1, 1.0, 0.1) : (bin >= 21 ? vec3(1.0, 0.1, 0.1) : (bin >= 4 ? vec3(0.1, 1.0, 0.1) : vec3(0.2, 0.3, 1.0))); vIntensity = 0.5; }
  if (st.z == 8.0) vColor = mix(vColor, vec3(1.0, 0.9, 0.8), 0.5);
}
