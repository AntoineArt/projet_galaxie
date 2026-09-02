in vec3 position;
in float aW;
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCamPat;
uniform float uTheta;
uniform float uPixelScale;
uniform float uMaxSize;
uniform float uRadius; // rayon physique d'un nuage (pc)
uniform float uOpacity;
out float vAlpha;

void main() {
  vec3 p = position - uCamPat;
  float c = cos(uTheta), s = sin(uTheta);
  vec3 rel = vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
  float d = length(rel);
  vec4 vp = uView * vec4(rel, 1.0);
  gl_Position = uProj * vp;
  float px = uRadius / max(d, 1.0) * uPixelScale * 2.0;
  float sz = clamp(px, 2.0, uMaxSize);
  gl_PointSize = sz;
  // conservation de l'extinction quand la taille est plafonnée/planchée
  float ratio = px / sz;
  vAlpha = clamp(uOpacity * aW * ratio * ratio, 0.0, 0.95);
  if (d < uRadius * 0.5) vAlpha = 0.0;
}
