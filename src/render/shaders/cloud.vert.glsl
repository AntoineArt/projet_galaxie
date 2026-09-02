// Sprites génériques : amas, nébuleuses, objets ponctuels. Position en réf. motif.
in vec3 position;
in float aL; // luminosité (L_sun)
in vec3 aColor; // couleur linéaire
in float aRadius; // rayon physique (pc), 0 = ponctuel

uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCamPat;
uniform float uTheta;
uniform float uExposure;
uniform float uPixelScale;
uniform float uMaxSize;
uniform float uLumScale;
uniform float uSoft; // 1 = profil doux (nébuleuse)

#define EXT_FAST
#include <extinction>

out vec3 vColor;
out float vIntensity;
out float vSize;

void main() {
  vec3 p = position - uCamPat;
  float c = cos(uTheta), s = sin(uTheta);
  vec3 rel = vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
  float d2 = max(dot(rel, rel), 1e-8);
  float d = sqrt(d2);
  vec3 trans = dustTransmission(uCamPat, p);
  float b = aL * uLumScale / d2 * uExposure * trans.g;
  gl_Position = uProj * (uView * vec4(rel, 1.0));
  float px = aRadius / d * uPixelScale * 2.0;
  float sz = clamp(max(px, 1.5 + 0.9 * log2(max(b, 1.0))), 1.0, uMaxSize);
  b *= min(1.0, (sz / max(px, 1.0)) * (sz / max(px, 1.0))); // taille plafonnée : conserve la brillance par pixel
  gl_PointSize = sz;
  vSize = sz;
  vIntensity = b / max(1.0, 0.35 * sz * sz) * (uSoft > 0.5 ? 0.6 : 1.0);
  if (d < aRadius) vIntensity *= d / aRadius; // à l'intérieur : atténue
  vColor = aColor * trans / max(trans.g, 1e-4);
}
