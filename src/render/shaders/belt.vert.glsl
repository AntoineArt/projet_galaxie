// Ceintures d'astéroïdes, ceinture de Kuiper, anneaux planétaires : points en orbite circulaire (repère du système).
in float aA; // rayon orbital (UA)
in float aPeriod; // années
in float aPhase; // rad
in float aInc; // rad (dispersion)
in float aNode; // rad
in float aParent; // -1 : étoile, sinon indice du corps parent dans uCenters
in float aSize;

uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCenters[10]; // positions relatives caméra (monde, pc) : 0 étoile, 1.. planètes
uniform float uT; // années
uniform float uInc0;
uniform float uNode0;
uniform float uExposure;
uniform float uPixelScale;

out vec3 vColor;
out float vIntensity;
out float vSize;
out float vProfile;

#define AU_PC 4.848e-6

void main() {
  float th = aPhase + 6.2831853 * uT / aPeriod;
  float x = aA * cos(th), y = aA * sin(th);
  // inclinaison propre puis plan du système
  float ci = cos(aInc), si = sin(aInc);
  float cn = cos(aNode), sn = sin(aNode);
  vec3 p = vec3(x * cn - y * sn, (x * sn + y * cn) * ci, (x * sn + y * cn) * si);
  float c0 = cos(uNode0), s0 = sin(uNode0), ci0 = cos(uInc0), si0 = sin(uInc0);
  vec3 q = vec3(p.x * c0 - p.y * s0, (p.x * s0 + p.y * c0) * ci0 - p.z * si0, (p.x * s0 + p.y * c0) * si0 + p.z * ci0);
  int parent = int(aParent + 1.5); // -1 -> 0
  vec3 rel = uCenters[parent] + q * AU_PC;
  float d = length(rel);
  vec4 v = uView * vec4(rel, 1.0);
  gl_Position = uProj * v;
  float sz = clamp(aSize, 1.0, 2.0);
  gl_PointSize = sz;
  vSize = sz;
  vProfile = 0.0;
  // marqueur : brillance constante, atténuée si le point est très loin par rapport à son rayon orbital
  vIntensity = 0.22 * clamp(aA * AU_PC * 3.0 / max(d, 1e-9), 0.02, 1.0);
  vColor = vec3(0.75, 0.7, 0.62);
}
