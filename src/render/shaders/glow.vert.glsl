// Lueur gaussienne d'un noeud : quad instancié dans le plan de vue, taille en unités monde (pas de limite de taille).
in vec2 position; // coin du quad, [-1, 1]
in vec3 aCenter; // centre (réf. motif, absolu)
in float aSigma; // écart-type (pc)
in float aL; // luminosité totale (L_sun)
in vec3 aColor;

uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCamPat;
uniform float uTheta;
uniform float uExposure;
uniform float uPixelScale;

#include <extinction>

out vec2 vUv; // en unités de sigma
out vec3 vColor;
out float vI0;

void main() {
  vec3 p = aCenter - uCamPat;
  float c = cos(uTheta), s = sin(uTheta);
  vec3 rel = vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
  float d2 = max(dot(rel, rel), 1e-6);
  float d = sqrt(d2);
  vec3 trans = dustTransmission(uCamPat, p);
  float b = aL / d2 * uExposure * trans.g;
  vec4 v = uView * vec4(rel, 1.0);
  v.xy += position * (2.4 * aSigma);
  gl_Position = uProj * v;
  vUv = position * 2.4;
  float sigPx = aSigma / d * uPixelScale;
  vI0 = b / (6.2831853 * sigPx * sigPx);
  // lueur trop diluée pour être visible (caméra dans ou près du noeud) : on évite le remplissage plein écran
  if (vI0 < 8e-4) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vI0 = 0.0; }
  vColor = aColor * trans / max(trans.g, 1e-4);
}
