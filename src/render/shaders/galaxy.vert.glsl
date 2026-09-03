// Galaxies d'arrière-plan : sprites procéduraux (réf. motif, positions absolues très lointaines).
in vec3 position;
in float aRadius; // pc, rayon caractéristique
in float aL; // L_sun
in vec4 aParams; // type (0 elliptique .. 1 spirale), cos(inclinaison), angle de position, graine

uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCamPat;
uniform float uTheta;
uniform float uExposure;
uniform float uPixelScale;

out vec4 vParams;
out float vIntensity;
out float vSize;

void main() {
  vec3 p = position - uCamPat;
  float c = cos(uTheta), s = sin(uTheta);
  vec3 rel = vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
  float d2 = max(dot(rel, rel), 1.0);
  float d = sqrt(d2);
  gl_Position = uProj * (uView * vec4(rel, 1.0));
  float px = 2.5 * aRadius / d * uPixelScale * 2.0; // le sprite couvre 2,5 rayons
  float sz = clamp(px, 2.0, 400.0);
  gl_PointSize = sz;
  vSize = sz;
  float b = aL / d2 * uExposure * 10.0; // brillance de surface relevée (le ciel de la Voie lactée est ~10x trop brillant par rapport aux galaxies)
  vIntensity = b / max(1.0, 0.12 * sz * sz);
  vParams = aParams;
}
