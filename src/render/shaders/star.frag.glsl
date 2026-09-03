precision highp float;
in vec3 vColor;
in float vIntensity;
in float vSize;
in float vProfile;
uniform float uDebug;
uniform float uProfile; // 0 étoile (coeur + halo), 1 lueur gaussienne douce
out vec4 fragColor;

// bruit de valeur 2D (structure des coquilles)
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 x) { vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }

void main() {
  if (vIntensity <= 0.0) discard;
  if (uDebug > 0.5) { if (vSize < uDebug) discard; fragColor = vec4(1.0, 0.0, 0.0, 1.0); return; }
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0; // 0 centre, 1 bord
  if (r2 > 1.0) discard;
  // profil : coeur gaussien + halo doux
  float core = exp(-r2 * 6.0);
  float halo = exp(-r2 * 1.5) * 0.15;
  float edge = (1.0 - r2) * (1.0 - r2); // extinction douce au bord du sprite
  float a = vSize <= 1.5 ? 1.0 : (core + halo) * edge * 1.15;
  if (uProfile > 0.5) a = exp(-r2 * 2.5) * edge * 1.6;
  if (uProfile > 1.5) {
    // nébuleuse : nuage irrégulier (bruit multi-échelle, graine par sprite via l'intensité)
    float seed = fract(vIntensity * 613.7) * 40.0;
    vec2 q = c * 3.0 + seed;
    float f = 0.55 * n2(q * 2.0) + 0.3 * n2(q * 4.3 + 1.7) + 0.15 * n2(q * 9.1 + 3.3);
    float shape = smoothstep(0.28, 0.75, f * (1.0 - r2 * 0.7));
    a = (0.25 * exp(-r2 * 2.0) + 1.6 * shape) * edge;
  }
  if (vProfile > 0.5) {
    float r = sqrt(r2);
    float ang = atan(c.y, c.x);
    float nz = 0.55 + 0.6 * n2(vec2(ang * 2.2 + vSize * 0.01, r * 6.0)) + 0.3 * n2(vec2(ang * 5.0, r * 14.0));
    a = (exp(-pow((r - 0.78) / 0.13, 2.0)) * 1.3 * nz + 0.1 * (1.0 - r2) * nz) * edge;
  }
  // compression douce : garde la teinte des étoiles brillantes (le coeur sature, le halo reste coloré)
  float I = vIntensity * a;
  float Ic = 3.0 * I / (1.0 + I / 3.0);
  fragColor = vec4(min(vColor * Ic + vec3(1.0) * max(I - Ic, 0.0) * 0.15, 600.0), 1.0); // plafond : cible en demi-flottants
}
