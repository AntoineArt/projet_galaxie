precision highp float;
in vec3 vColor;
in float vIntensity;
in float vSize;
uniform float uDebug;
uniform float uProfile; // 0 étoile (coeur + halo), 1 lueur gaussienne douce
out vec4 fragColor;

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
  // compression douce : garde la teinte des étoiles brillantes (le coeur sature, le halo reste coloré)
  float I = vIntensity * a;
  float Ic = 3.0 * I / (1.0 + I / 3.0);
  fragColor = vec4(vColor * Ic + vec3(1.0) * max(I - Ic, 0.0) * 0.15, 1.0);
}
