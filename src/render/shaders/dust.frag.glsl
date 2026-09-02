precision highp float;
in float vAlpha;
uniform vec3 uTint; // transmission colorée (rougissement)
out vec4 fragColor;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  if (r2 > 1.0) discard;
  float a = vAlpha * exp(-r2 * 3.0);
  // blending multiplicatif : sortie = transmission
  fragColor = vec4(mix(vec3(1.0), uTint, a), 1.0);
}
