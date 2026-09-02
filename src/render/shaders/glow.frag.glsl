precision highp float;
in vec2 vUv;
in vec3 vColor;
in float vI0;
out vec4 fragColor;

void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 9.0) discard;
  float g = exp(-0.5 * r2) * (1.0 - r2 / 9.0);
  fragColor = vec4(vColor * vI0 * g, 1.0);
}
