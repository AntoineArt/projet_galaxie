precision highp float;
in vec4 vParams;
in float vIntensity;
in float vSize;
out vec4 fragColor;

float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 x) { vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }

void main() {
  vec2 c = (gl_PointCoord - 0.5) * 2.0; // [-1, 1], 1 = 2,5 rayons
  float type = vParams.x, cosI = max(vParams.y, 0.12), pa = vParams.z, seed = vParams.w;
  float cp = cos(pa), sp = sin(pa);
  vec2 q = vec2(cp * c.x - sp * c.y, sp * c.x + cp * c.y);
  q.y /= cosI; // inclinaison
  float r = length(q) * 2.5; // en rayons
  if (r > 2.5) discard;
  vec3 col;
  float I;
  if (type < 0.5) {
    // elliptique : profil de de Vaucouleurs approché
    I = exp(-3.0 * pow(r, 0.55)) * 1.6;
    col = vec3(1.0, 0.82, 0.62);
  } else {
    float bulge = exp(-r * 6.0) * 2.0;
    float disk = exp(-r * 1.6);
    float ang = atan(q.y, q.x);
    float phase = ang - 3.0 * log(r + 0.08) + seed;
    float arms = pow(0.5 + 0.5 * cos(2.0 * phase), 3.0);
    float mott = 0.6 + 0.8 * n2(q * 9.0 + seed);
    float irr = type > 0.8 ? 0.5 + 0.9 * n2(q * 5.0 + seed * 3.0) : 1.0;
    I = bulge + disk * (0.45 + 0.9 * arms * mott) * irr;
    // bande de poussière quand la galaxie est vue par la tranche
    if (cosI < 0.45) I *= 1.0 - 0.7 * exp(-pow((q.y * cosI - 0.02) / 0.05, 2.0)) * (1.0 - cosI / 0.45) * step(r, 1.6);
    col = mix(vec3(1.0, 0.85, 0.65), vec3(0.65, 0.75, 1.0), clamp(r * 0.9 - 0.1, 0.0, 1.0) * (0.3 + 0.7 * arms));
  }
  float edge = smoothstep(2.5, 1.8, r);
  fragColor = vec4(min(col * I * vIntensity * edge, 600.0), 1.0);
}
