// Rendu du système stellaire le plus proche : disques stellaires résolus, planètes éclairées, orbites.
// Positions calculées en double précision côté CPU, relatives à la caméra.
import * as THREE from 'three';
import { AU_PC, REARTH_RSUN, RSUN_PC, orbitPosition, type StarSystem } from '../galaxy/system';
import { blackbodyRGB } from '../galaxy/stellar';

const BODY_FLOATS = 12; // rel xyz, rayon (pc), couleur rgb, intensité, type, lumière xyz (dir vers l'étoile, monde)
const MAX_BODIES = 12;
const ORBIT_SEG = 96;

const bodyVert = `
in vec2 position;
in vec3 aRel; in float aRadius; in vec3 aColor; in float aIntensity; in float aType; in vec3 aLight;
uniform mat4 uProj; uniform mat4 uView; uniform float uPixelScale;
out vec2 vUv; out vec3 vColor; out float vIntensity; out float vType; out vec3 vLightView; out float vPx;
void main() {
  float d = max(length(aRel), 1e-12);
  float px = aRadius / d * uPixelScale;
  float minPx = aType > 0.5 ? 1.5 : 1.0;
  float r = max(aRadius, minPx * d / uPixelScale);
  float ext = aType > 0.5 ? 1.0 : 3.0; // étoile : marge pour la couronne
  vec4 v = uView * vec4(aRel, 1.0);
  v.xy += position * r * ext;
  gl_Position = uProj * v;
  vUv = position * ext;
  vColor = aColor;
  // brillance par pixel : flux réparti sur le disque affiché (conservation quand le disque est agrandi)
  float rPx = max(px, minPx);
  vIntensity = aIntensity / (3.1416 * rPx * rPx);
  if (aType > 0.5) vIntensity = max(vIntensity, 0.6); // planètes : plancher de visibilité (marqueur)
  vType = aType;
  vLightView = (uView * vec4(aLight, 0.0)).xyz;
  vPx = rPx;
}`;
const bodyFrag = `
precision highp float;
in vec2 vUv; in vec3 vColor; in float vIntensity; in float vType; in vec3 vLightView; in float vPx;
out vec4 fragColor;
void main() {
  float r2 = dot(vUv, vUv);
  if (vType > 0.5) {
    if (r2 > 1.0) discard;
    vec3 n = vec3(vUv, sqrt(max(0.0, 1.0 - r2)));
    float lit = vPx < 2.5 ? 0.6 : max(0.0, dot(n, normalize(vLightView)));
    float aa = smoothstep(1.0, 0.8, r2);
    fragColor = vec4(min(vColor * vIntensity * (0.03 + lit) * aa, 2e4), 1.0);
  } else {
    if (r2 > 9.0) discard;
    float r = sqrt(r2);
    float disk = r < 1.0 ? (1.0 - 0.6 * (1.0 - sqrt(max(0.0, 1.0 - r2)))) : 0.0;
    float corona = r >= 1.0 ? 0.08 * exp(-(r - 1.0) * 2.5) : 0.0;
    float aa = smoothstep(1.02, 0.98, r);
    // plafond : limite l'éblouissement (bloom) d'un disque très brillant ; plus bas si le disque est résolu
    float cap = vPx > 3.0 ? 60.0 : 150.0;
    fragColor = vec4(min(vColor * vIntensity * (disk * aa + corona), cap), 1.0);
  }
}`;

export class SystemRenderer {
  group = new THREE.Group();
  system: StarSystem | null = null;
  private bodies: THREE.Mesh;
  private bodyMat: THREE.RawShaderMaterial;
  private bodyBuf: THREE.InstancedInterleavedBuffer;
  private bodyGeo = new THREE.InstancedBufferGeometry();
  private orbits: THREE.LineSegments;
  private orbitPos: THREE.BufferAttribute;
  private tmp = new Float64Array(3);
  private tmp2 = new Float64Array(3);
  private starPat = new THREE.Vector3();

  constructor() {
    this.bodyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    this.bodyGeo.setIndex([0, 1, 2, 0, 2, 3]);
    this.bodyBuf = new THREE.InstancedInterleavedBuffer(new Float32Array(BODY_FLOATS * MAX_BODIES), BODY_FLOATS);
    this.bodyBuf.setUsage(THREE.DynamicDrawUsage);
    const b = this.bodyBuf;
    this.bodyGeo.setAttribute('aRel', new THREE.InterleavedBufferAttribute(b, 3, 0));
    this.bodyGeo.setAttribute('aRadius', new THREE.InterleavedBufferAttribute(b, 1, 3));
    this.bodyGeo.setAttribute('aColor', new THREE.InterleavedBufferAttribute(b, 3, 4));
    this.bodyGeo.setAttribute('aIntensity', new THREE.InterleavedBufferAttribute(b, 1, 7));
    this.bodyGeo.setAttribute('aType', new THREE.InterleavedBufferAttribute(b, 1, 8));
    this.bodyGeo.setAttribute('aLight', new THREE.InterleavedBufferAttribute(b, 3, 9));
    this.bodyGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.bodyGeo.instanceCount = 0;
    this.bodyMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: `precision highp float;\n` + bodyVert, fragmentShader: bodyFrag,
      uniforms: { uProj: { value: new THREE.Matrix4() }, uView: { value: new THREE.Matrix4() }, uPixelScale: { value: 1000 } },
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, side: THREE.DoubleSide,
    });
    this.bodies = new THREE.Mesh(this.bodyGeo, this.bodyMat);
    this.bodies.frustumCulled = false;
    this.bodies.renderOrder = 40;
    this.group.add(this.bodies);

    const ogeo = new THREE.BufferGeometry();
    this.orbitPos = new THREE.BufferAttribute(new Float32Array(MAX_BODIES * ORBIT_SEG * 2 * 3), 3);
    this.orbitPos.setUsage(THREE.DynamicDrawUsage);
    ogeo.setAttribute('position', this.orbitPos);
    ogeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.orbits = new THREE.LineSegments(ogeo, new THREE.LineBasicMaterial({ color: 0x6f86b3, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthTest: false }));
    this.orbits.frustumCulled = false;
    this.orbits.renderOrder = 39;
    this.group.add(this.orbits);
    this.group.visible = false;
  }

  /** starPat : position de l'étoile (réf. motif) ; theta : rotation motif->monde ; camWorld : caméra (monde) */
  update(system: StarSystem | null, starPat: THREE.Vector3, theta: number, camWorld: THREE.Vector3, camera: THREE.PerspectiveCamera, viewRot: THREE.Matrix4, time: number, exposure: number, pixelScale: number, showOrbits: boolean): void {
    this.system = system;
    if (!system) { this.group.visible = false; return; }
    this.group.visible = true;
    this.starPat.copy(starPat);
    const c = Math.cos(theta), s = Math.sin(theta);
    // étoile relative caméra (double)
    const sx = c * starPat.x - s * starPat.y - camWorld.x, sy = s * starPat.x + c * starPat.y - camWorld.y, sz = starPat.z - camWorld.z;
    const tYears = time * 1e6;
    const data = this.bodyBuf.array as Float32Array;
    let n = 0;
    const col = new Float32Array(3);
    const push = (rx: number, ry: number, rz: number, radius: number, r: number, g: number, b: number, L: number, type: number, lx: number, ly: number, lz: number) => {
      if (n >= MAX_BODIES) return;
      const d2 = rx * rx + ry * ry + rz * rz;
      const o = n * BODY_FLOATS;
      data[o] = rx; data[o + 1] = ry; data[o + 2] = rz; data[o + 3] = radius;
      data[o + 4] = r; data[o + 5] = g; data[o + 6] = b;
      data[o + 7] = (L / Math.max(d2, 1e-20)) * exposure;
      data[o + 8] = type; data[o + 9] = lx; data[o + 10] = ly; data[o + 11] = lz;
      n++;
    };
    // primaire
    const P = system.primary;
    blackbodyRGB(P.T, col);
    push(sx, sy, sz, Math.max(P.radius, 1e-3) * RSUN_PC, col[0], col[1], col[2], P.L, 0, 0, 0, 1);
    // compagnon (orbite autour du barycentre approximé par la primaire)
    let cx = 0, cy = 0, cz = 0;
    if (system.companion) {
      const C = system.companion;
      orbitPosition(C.a, 0.05, C.period, C.phase0, C.inc, 0, tYears, this.tmp);
      cx = this.tmp[0] * AU_PC; cy = this.tmp[1] * AU_PC; cz = this.tmp[2] * AU_PC;
      blackbodyRGB(C.state.T, col);
      push(sx + cx, sy + cy, sz + cz, Math.max(C.state.radius, 1e-3) * RSUN_PC, col[0], col[1], col[2], C.state.L, 0, 0, 0, 1);
    }
    // planètes
    const op = this.orbitPos.array as Float32Array;
    let ov = 0;
    for (const pl of system.planets) {
      orbitPosition(pl.a, pl.e, pl.period, pl.phase0, pl.inc, pl.node, tYears, this.tmp);
      const px = this.tmp[0] * AU_PC, py = this.tmp[1] * AU_PC, pz = this.tmp[2] * AU_PC;
      const rp = pl.radius * REARTH_RSUN * RSUN_PC;
      // lumière réfléchie : L * albédo * (R / 2a)^2 (albédo 0,3)
      const dist = Math.sqrt(px * px + py * py + pz * pz);
      const Lref = P.L * 0.3 * Math.pow(rp / (2 * dist), 2);
      const ln = 1 / Math.max(dist, 1e-12);
      push(sx + px, sy + py, sz + pz, rp, pl.color[0], pl.color[1], pl.color[2], Lref, 1, -px * ln, -py * ln, -pz * ln);
      if (showOrbits) {
        for (let k = 0; k < ORBIT_SEG; k++) {
          const t0 = ((k / ORBIT_SEG) * pl.period), t1 = (((k + 1) / ORBIT_SEG) * pl.period);
          orbitPosition(pl.a, pl.e, pl.period, pl.phase0, pl.inc, pl.node, t0, this.tmp);
          orbitPosition(pl.a, pl.e, pl.period, pl.phase0, pl.inc, pl.node, t1, this.tmp2);
          op[ov++] = sx + this.tmp[0] * AU_PC; op[ov++] = sy + this.tmp[1] * AU_PC; op[ov++] = sz + this.tmp[2] * AU_PC;
          op[ov++] = sx + this.tmp2[0] * AU_PC; op[ov++] = sy + this.tmp2[1] * AU_PC; op[ov++] = sz + this.tmp2[2] * AU_PC;
        }
      }
    }
    this.bodyGeo.instanceCount = n;
    this.bodyBuf.needsUpdate = true;
    this.orbitPos.needsUpdate = true;
    (this.orbits.geometry as THREE.BufferGeometry).setDrawRange(0, ov / 3);
    this.orbits.visible = showOrbits && ov > 0;
    const u = this.bodyMat.uniforms;
    u.uProj.value.copy(camera.projectionMatrix);
    u.uView.value.copy(viewRot);
    u.uPixelScale.value = pixelScale;
  }
}
