// Champ lointain : chaque point représente ~N_rep étoiles (luminosité moyenne de population).
in vec3 position; // réf. motif, absolu
in float aW; // poids (densité locale / densité moyenne de la cellule)
in float aComp; // composante
in float aArm; // facteur bras

uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCamPat;
uniform float uTheta;
uniform float uNrep;
uniform vec4 uPopL; // L moyenne par étoile par composante à t
uniform mat4 uPopRGB; // couleurs moyennes (colonnes)
uniform float uYoungL;
uniform vec3 uYoungRGB;
uniform float uFluxMin;
uniform float uExposure;
uniform sampler2D uKeep; // fraction de L des étoiles de L_MS < Lcut ; lignes = (composante, temps), dernière = jeunes
uniform vec2 uLumRange; // logLmin, logLmax
uniform vec3 uKeepT; // (indice temps fractionnaire, nT, rows)
uniform float uPointBase;
uniform float uCellRadius; // rayon physique représenté par un point (pc)
uniform float uPixelScale;
uniform float uMaxSize;
uniform vec2 uYoung; // base, supplément bras

#include <extinction>

out vec3 vColor;
out float vIntensity;
out float vSize;

void main() {
  vec3 p = position - uCamPat;
  float c = cos(uTheta), s = sin(uTheta);
  vec3 rel = vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
  float d2 = dot(rel, rel);
  float d = sqrt(d2);
  int comp = int(aComp + 0.5);
  float y = comp == 1 ? uYoung.x + uYoung.y * aArm : 0.0;
  float Lold = uPopL[comp] * (1.0 - y);
  float Lyoung = uYoungL * y;
  // masque : retire la part de lumière rendue en étoiles individuelles à cette distance
  float Lcut = uFluxMin * d2;
  float fx = clamp((log(Lcut) / 2.302585 - uLumRange.x) / (uLumRange.y - uLumRange.x), 0.0, 1.0);
  float k0 = floor(uKeepT.x), ka = uKeepT.x - k0;
  float row0 = float(comp) * uKeepT.y + k0;
  float keepOld = mix(texture(uKeep, vec2(fx, (row0 + 0.5) / uKeepT.z)).r, texture(uKeep, vec2(fx, (row0 + 1.5) / uKeepT.z)).r, ka);
  float keepYoung = texture(uKeep, vec2(fx, (uKeepT.z - 0.5) / uKeepT.z)).r;
  Lold *= keepOld; Lyoung *= keepYoung;
  float L = aW * uNrep * (Lold + Lyoung);
  vec3 rgb = (uPopRGB[comp].rgb * Lold + uYoungRGB * Lyoung) / max(Lold + Lyoung, 1e-12);
  vec3 trans = dustTransmission(uCamPat, p);
  float flux = L / max(d2, 1e-6) * trans.g;
  rgb *= trans / max(trans.g, 1e-4);
  float b = flux * uExposure;
  vec4 vp = uView * vec4(rel, 1.0);
  gl_Position = uProj * vp;
  // points proches : étalés sur l'angle que couvre la cellule qu'ils représentent (lueur diffuse)
  float px = uCellRadius / d * uPixelScale * 2.0;
  float sz = clamp(max(px, uPointBase + 0.8 * log2(max(b, 1.0))), 1.0, uMaxSize);
  gl_PointSize = sz;
  vSize = sz;
  vIntensity = b / max(1.0, 0.35 * sz * sz);
  vColor = rgb;
}
