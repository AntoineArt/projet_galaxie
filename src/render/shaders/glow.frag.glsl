precision highp float;
in vec2 vUv;
in vec3 vColor;
in float vI0;
out vec4 fragColor;

void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 5.76) discard;
  float g = exp(-0.5 * r2) * (1.0 - r2 / 5.76);
  fragColor = vec4(min(vColor * vI0 * g, 2e4), 1.0);
}
