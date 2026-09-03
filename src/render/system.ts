// Rendu du système stellaire courant : disques stellaires résolus, trous noirs, planètes et lunes éclairées,
// ceintures et anneaux, orbites. Positions calculées en double précision côté CPU, relatives à la caméra.
import * as THREE from 'three';
import beltVert from './shaders/belt.vert.glsl?raw';
import starFrag from './shaders/star.frag.glsl?raw';
import { vertexShader, fragmentShader } from './shaderlib';
import { AU_PC, systemBodies, orbitPosition, type StarSystem, type BodyPos } from '../galaxy/system';
import { blackbodyRGB, PHASE } from '../galaxy/stellar';

const BODY_FLOATS = 12; // rel xyz, rayon (pc), couleur rgb, intensité, type, lumière xyz (dir vers l'étoile, monde)
const MAX_BODIES = 64;
const ORBIT_SEG = 96;
const MAX_ORBITS = 40;
const MAX_TAIL_V = 4 * 12 * 2;

// types : 0 étoile, 1.x planète/lune/comète (fraction = nature de la surface), 3 trou noir, 4 pulsar
const bodyVert = `
in vec2 position;
in vec3 aRel; in float aRadius; in vec3 aColor; in float aIntensity; in float aType; in vec3 aLight;
uniform mat4 uProj; uniform mat4 uView; uniform float uPixelScale;
uniform float uNow; uniform float uPulsarPeriod;
out vec2 vUv; out vec3 vColor; out float vIntensity; out float vType; out vec3 vLightView; out float vPx;
void main() {
  float d = max(length(aRel), 1e-12);
  float px = aRadius / d * uPixelScale;
  float minPx = aType > 3.5 ? 2.0 : (aType > 2.5 ? 3.0 : (aType > 0.5 ? 1.5 : 1.0));
  float r = max(aRadius, minPx * d / uPixelScale);
  float ext = aType > 2.5 ? 14.0 : (aType > 0.5 ? 1.0 : 3.0); // étoile : couronne ; trou noir : disque lentillé ; pulsar : faisceaux
  vec4 v = uView * vec4(aRel, 1.0);
  v.xy += position * r * ext;
  gl_Position = uProj * v;
  vUv = position * ext;
  vColor = aColor;
  float rPx = max(px, minPx);
  vIntensity = aIntensity / (3.1416 * rPx * rPx);
  if (aType > 0.5 && aType < 2.5) vIntensity = clamp(vIntensity, 0.6, 1.4); // planètes : plancher de visibilité (marqueur), plafond (pas d'éblouissement)
  if (aType > 2.5 && aType < 3.5) vIntensity = 1.0; // trou noir : disque d'accrétion à brillance fixe
  if (aType > 3.5) vIntensity = 1.0;
  vType = aType;
  vLightView = (uView * vec4(aLight, 0.0)).xyz;
  vPx = rPx;
}`;
const bodyFrag = `
precision highp float;
in vec2 vUv; in vec3 vColor; in float vIntensity; in float vType; in vec3 vLightView; in float vPx;
uniform float uNow; uniform float uPulsarPeriod;
out vec4 fragColor;
// bruit de valeur 3D (surfaces procédurales)
float hash3(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03) + 0.125 * vnoise(p * 4.07) + 0.0625 * vnoise(p * 8.11); }
void main() {
  float r2 = dot(vUv, vUv);
  if (vType > 3.5) {
    // pulsar : point bleu-blanc et deux faisceaux opposés qui tournent (période réelle, temps réel)
    float r = sqrt(r2);
    if (r > 14.0) discard;
    float ang = 6.2831853 * uNow / uPulsarPeriod;
    float phi = atan(vUv.y, vUv.x);
    float beam = exp(-pow(sin(phi - ang) * 7.0, 2.0)) * exp(-r * 0.35) * 2.0;
    float core = exp(-r2 * 2.0) * 3.0;
    fragColor = vec4(vColor * vIntensity * (core + beam) + vec3(0.4, 0.5, 1.0) * beam * 0.5, 0.0);
    return;
  }
  if (vType > 2.5) {
    // trou noir de Schwarzschild : intégration des géodésiques nulles (a = -1.5 h^2 r / |r|^5, r_s = 1),
    // disque d'accrétion de 3 à 11 r_s vu incliné, images primaire et secondaire, effet Doppler, ombre opaque.
    vec2 uv = vUv; // en r_s (le quad couvre +/- 14 r_s)
    float b = length(uv);
    if (b > 13.5) discard;
    // plan du rayon : e_z = ligne de visée (vers le trou noir), e_r = direction de l'offset écran
    vec3 ez = vec3(0.0, 0.0, 1.0);
    vec3 er = b > 1e-4 ? vec3(uv / b, 0.0) : vec3(1.0, 0.0, 0.0);
    // disque incliné de 75° (normale dans le plan (y, z) de la vue), tourne lentement
    float incl = 1.31;
    vec3 n = vec3(0.12 * sin(uNow * 0.05), sin(incl), cos(incl)); // normale à 75° de la ligne de visée
    n = normalize(n);
    float h2 = b * b;
    vec2 pos = vec2(b, -40.0); // (composante er, composante ez)
    vec2 vel = vec2(0.0, 1.0);
    vec3 acc = vec3(0.0);
    float captured = 0.0;
    float prevSide = dot(pos.x * er + pos.y * ez, n);
    float dt = 0.35;
    for (int i = 0; i < 260; i++) {
      float r2i = dot(pos, pos);
      float ri = sqrt(r2i);
      if (ri < 1.0) { captured = 1.0; break; }
      if (ri > 45.0 && pos.y > 0.0) break;
      // pas adaptatif : fin près du trou noir
      float step = dt * clamp(ri * 0.2, 0.06, 1.0);
      vec2 a = -1.5 * h2 * pos / (r2i * r2i * ri);
      vel += a * step;
      pos += vel * step;
      vec3 p3 = pos.x * er + pos.y * ez;
      float side = dot(p3, n);
      if (side * prevSide < 0.0) {
        // traversée du plan du disque : point d'intersection interpolé
        vec3 pPrev = p3 - (vel.x * er + vel.y * ez) * step;
        float f = prevSide / (prevSide - side);
        vec3 pc = mix(pPrev, p3, f);
        float rd = length(pc);
        p3 = pc;
        if (rd > 3.0 && rd < 11.0) {
          vec3 vdir = normalize(cross(n, p3)); // rotation képlérienne
          float beta = 0.55 / sqrt(rd / 3.0);
          float dop = 1.0 / (1.0 - beta * dot(vdir, -ez)); // vers la caméra
          float dop3 = dop * dop * dop;
          float emis = pow(3.0 / rd, 2.5) * smoothstep(3.0, 3.6, rd) * smoothstep(11.0, 9.0, rd);
          vec3 hot = vec3(1.0, 0.85, 0.6);
          vec3 shifted = mix(vec3(1.0, 0.45, 0.2), vec3(0.75, 0.85, 1.0), clamp((dop - 0.7) * 1.4, 0.0, 1.0));
          acc += hot * shifted * emis * dop3 * 0.7;
        }
      }
      prevSide = side;
    }
    vec3 glow = acc * vIntensity;
    // anneau de photons résiduel (les rayons capturés près de b ~ 2,6 sont brillants dans le disque)
    fragColor = vec4(min(glow, 12.0), captured);
    return;
  }
  if (vType > 0.5) {
    if (r2 > 1.0) discard;
    vec3 n = vec3(vUv, sqrt(max(0.0, 1.0 - r2)));
    float lit = vPx < 2.5 ? 0.6 : max(0.0, dot(n, normalize(vLightView)));
    float aa = smoothstep(1.0, 0.8, r2);
    vec3 albedo = vColor;
    if (vPx > 4.0) {
      // surface procédurale selon la nature du corps (partie fractionnaire du type)
      float kind = fract(vType) * 5.0; // 0 rocheuse, 1 glacée, 2 géante gazeuse, 3 géante de glace, 4 jovienne chaude
      float seed = floor(vIntensity * 977.0) * 0.37; // varie d'un corps à l'autre
      if (kind < 1.5) {
        float f = fbm(n * 6.0 + seed);
        albedo *= 0.7 + 0.6 * f;
        if (kind > 0.5) albedo = mix(albedo, vec3(0.95), smoothstep(0.55, 0.7, f) * 0.6); // calottes / glaces brillantes
      } else {
        // bandes de latitude déformées par turbulence
        float lat = n.y + 0.15 * (fbm(n * 4.0 + seed) - 0.5);
        float bands = 0.5 + 0.5 * sin(lat * (kind > 3.5 ? 14.0 : 22.0) + seed);
        albedo *= 0.75 + 0.45 * bands;
        if (kind > 3.5) albedo = mix(albedo, vec3(0.9, 0.5, 0.3), 0.3 * bands); // jovienne chaude : rougeoiement
      }
    }
    fragColor = vec4(min(albedo * vIntensity * (0.03 + lit), 2e4) * aa, aa); // prémultiplié : disque opaque
  } else {
    if (r2 > 9.0) discard;
    float r = sqrt(r2);
    float disk = r < 1.0 ? (1.0 - 0.6 * (1.0 - sqrt(max(0.0, 1.0 - r2)))) : 0.0;
    float corona = r >= 1.0 ? 0.08 * exp(-(r - 1.0) * 2.5) : 0.0;
    float aa = smoothstep(1.02, 0.98, r);
    float cap = vPx > 3.0 ? 12.0 : 150.0;
    fragColor = vec4(min(vColor * vIntensity * (disk * aa + corona), cap), 1.0);
  }
}`;

export interface SystemBodyRef { body: BodyPos; rel: THREE.Vector3; abs: THREE.Vector3; type: number; label: string }

export class SystemRenderer {
  group = new THREE.Group();
  system: StarSystem | null = null;
  /** corps du système à cette frame, positions relatives caméra (monde) : pour la sélection */
  bodies: SystemBodyRef[] = [];
  private bodyMat: THREE.RawShaderMaterial;
  private bhMat: THREE.RawShaderMaterial;
  private bodyBuf: THREE.InstancedInterleavedBuffer;
  private bhBuf: THREE.InstancedInterleavedBuffer;
  private bodyGeo: THREE.InstancedBufferGeometry;
  private bhGeo: THREE.InstancedBufferGeometry;
  private orbits: THREE.LineSegments;
  private orbitPos: THREE.BufferAttribute;
  tailLines: THREE.LineSegments;
  private tailPos: THREE.BufferAttribute;
  private tailCol: THREE.BufferAttribute;
  private belts: THREE.Points | null = null;
  private beltMat: THREE.RawShaderMaterial;
  private beltSystemId = '';
  private beltT0 = 0; // époque (années) des phases des ceintures : uT reste petit (précision float)
  private tmp = new Float64Array(3);
  private tmp2 = new Float64Array(3);
  private posList: BodyPos[] = [];

  constructor() {
    const mk = (blending: THREE.Blending) => {
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(BODY_FLOATS * MAX_BODIES), BODY_FLOATS);
      buf.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aRel', new THREE.InterleavedBufferAttribute(buf, 3, 0));
      geo.setAttribute('aRadius', new THREE.InterleavedBufferAttribute(buf, 1, 3));
      geo.setAttribute('aColor', new THREE.InterleavedBufferAttribute(buf, 3, 4));
      geo.setAttribute('aIntensity', new THREE.InterleavedBufferAttribute(buf, 1, 7));
      geo.setAttribute('aType', new THREE.InterleavedBufferAttribute(buf, 1, 8));
      geo.setAttribute('aLight', new THREE.InterleavedBufferAttribute(buf, 3, 9));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      geo.instanceCount = 0;
      const mat = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: `precision highp float;\n` + bodyVert, fragmentShader: bodyFrag,
        uniforms: { uProj: { value: new THREE.Matrix4() }, uView: { value: new THREE.Matrix4() }, uPixelScale: { value: 1000 }, uNow: { value: 0 }, uPulsarPeriod: { value: 1 } },
        blending, depthTest: false, depthWrite: false, transparent: true, side: THREE.DoubleSide,
        premultipliedAlpha: blending === THREE.NormalBlending, // trou noir : ombre opaque + lueur additive
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      return { geo, buf, mat, mesh };
    };
    const a = mk(THREE.AdditiveBlending);
    this.bodyGeo = a.geo; this.bodyBuf = a.buf; this.bodyMat = a.mat; a.mesh.renderOrder = 40;
    const b = mk(THREE.NormalBlending);
    this.bhGeo = b.geo; this.bhBuf = b.buf; this.bhMat = b.mat; b.mesh.renderOrder = 41;
    this.group.add(a.mesh, b.mesh);

    const ogeo = new THREE.BufferGeometry();
    this.orbitPos = new THREE.BufferAttribute(new Float32Array(MAX_ORBITS * ORBIT_SEG * 2 * 3), 3);
    this.orbitPos.setUsage(THREE.DynamicDrawUsage);
    ogeo.setAttribute('position', this.orbitPos);
    ogeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.orbits = new THREE.LineSegments(ogeo, new THREE.LineBasicMaterial({ color: 0x6f86b3, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthTest: false }));
    this.orbits.frustumCulled = false;
    this.orbits.renderOrder = 39;
    this.group.add(this.orbits);
    const tgeo = new THREE.BufferGeometry();
    this.tailPos = new THREE.BufferAttribute(new Float32Array(MAX_TAIL_V * 3), 3);
    this.tailCol = new THREE.BufferAttribute(new Float32Array(MAX_TAIL_V * 3), 3);
    this.tailPos.setUsage(THREE.DynamicDrawUsage); this.tailCol.setUsage(THREE.DynamicDrawUsage);
    tgeo.setAttribute('position', this.tailPos);
    tgeo.setAttribute('color', this.tailCol);
    tgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.tailLines = new THREE.LineSegments(tgeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthTest: false }));
    this.tailLines.frustumCulled = false;
    this.tailLines.renderOrder = 39;
    this.group.add(this.tailLines);

    this.beltMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertexShader(beltVert),
      fragmentShader: fragmentShader(starFrag),
      uniforms: {
        uProj: { value: new THREE.Matrix4() }, uView: { value: new THREE.Matrix4() },
        uCenters: { value: new Float32Array(30) }, uT: { value: 0 }, uInc0: { value: 0 }, uNode0: { value: 0 },
        uExposure: { value: 1 }, uPixelScale: { value: 1000 }, uDebug: { value: 0 }, uProfile: { value: 0 },
      },
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    });
    this.group.visible = false;
  }

  /** construit le nuage de points des ceintures et anneaux d'un système */
  private buildBelts(sys: StarSystem, t0: number): void {
    this.beltT0 = t0;
    if (this.belts) { this.group.remove(this.belts); this.belts.geometry.dispose(); this.belts = null; }
    const items: { a: number; period: number; phase: number; inc: number; node: number; parent: number; size: number }[] = [];
    const push = (a: number, period: number, phase: number, inc: number, node: number, parent: number, size: number) => items.push({ a, period, phase, inc, node, parent, size });
    let h = 12345;
    const rnd = () => { h = (Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; return (h & 0xffffff) / 16777216; };
    const M = Math.max(sys.mass, 0.05);
    for (const belt of sys.belts) {
      h = belt.seed;
      for (let i = 0; i < belt.n; i++) {
        const a = belt.inner + (belt.outer - belt.inner) * Math.pow(rnd(), 0.8);
        push(a, Math.sqrt((a * a * a) / M), rnd() * 2 * Math.PI, sys.inc0 + (rnd() - 0.5) * belt.thickness * 2, sys.node0 + (rnd() - 0.5) * 0.4, -1, 1.0 + rnd());
      }
    }
    sys.planets.forEach((pl, i) => {
      if (!pl.rings) return;
      const rp = (pl.radius * 0.009168 * 2.25e-8) / AU_PC; // rayon planétaire en UA
      const mp = pl.mass / 333000;
      for (let k = 0; k < 700; k++) {
        const a = rp * (pl.rings.inner + (pl.rings.outer - pl.rings.inner) * rnd());
        push(a, Math.sqrt((a * a * a) / mp), rnd() * 2 * Math.PI, pl.inc + (rnd() - 0.5) * 0.004, pl.node, i, 1.2);
      }
    });
    if (items.length === 0) return;
    // phases ramenées à l'époque t0 (double précision) : le shader n'ajoute que t - t0
    for (const it of items) it.phase = (it.phase + 2 * Math.PI * ((t0 / it.period) % 1)) % (2 * Math.PI);
    const n = items.length;
    const arr = (f: (it: (typeof items)[0]) => number) => new THREE.BufferAttribute(Float32Array.from(items, f), 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aA', arr((it) => it.a));
    geo.setAttribute('aPeriod', arr((it) => it.period));
    geo.setAttribute('aPhase', arr((it) => it.phase));
    geo.setAttribute('aInc', arr((it) => it.inc));
    geo.setAttribute('aNode', arr((it) => it.node));
    geo.setAttribute('aParent', arr((it) => it.parent));
    geo.setAttribute('aSize', arr((it) => it.size));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.belts = new THREE.Points(geo, this.beltMat);
    this.belts.frustumCulled = false;
    this.belts.renderOrder = 38;
    this.group.add(this.belts);
  }

  /** starPat : position de l'étoile (réf. motif) ; theta : rotation motif->monde ; camWorld : caméra (monde) */
  update(system: StarSystem | null, starPat: THREE.Vector3, theta: number, camWorld: THREE.Vector3, camera: THREE.PerspectiveCamera, viewRot: THREE.Matrix4, time: number, exposure: number, pixelScale: number, showOrbits: boolean): void {
    this.system = system;
    this.bodies.length = 0;
    if (!system) { this.group.visible = false; return; }
    this.group.visible = true;
    const c = Math.cos(theta), s = Math.sin(theta);
    const sx = c * starPat.x - s * starPat.y - camWorld.x, sy = s * starPat.x + c * starPat.y - camWorld.y, sz = starPat.z - camWorld.z;
    const tYears = time * 1e6;
    if (system.id !== this.beltSystemId || Math.abs(tYears - this.beltT0) > 3e4) { this.buildBelts(system, tYears); this.beltSystemId = system.id; }
    const list = systemBodies(system, tYears, this.posList);
    const tails: { x: number; y: number; z: number; dx: number; dy: number; dz: number; len: number }[] = [];
    const data = this.bodyBuf.array as Float32Array;
    const bhData = this.bhBuf.array as Float32Array;
    let n = 0, nbh = 0;
    const col = new Float32Array(3);
    const centers = this.beltMat.uniforms.uCenters.value as Float32Array;
    centers.fill(0);
    centers[0] = sx; centers[1] = sy; centers[2] = sz;
    const P = system.primary;
    const push = (rx: number, ry: number, rz: number, radius: number, r: number, g: number, b: number, L: number, type: number, lx: number, ly: number, lz: number) => {
      const d2 = rx * rx + ry * ry + rz * rz;
      const opaque = type >= 1; // planètes, lunes, comètes, trou noir, pulsar : mélange normal (corps opaques)
      const arr = opaque ? bhData : data;
      const idx = opaque ? nbh : n;
      if (idx >= MAX_BODIES) return;
      const o = idx * BODY_FLOATS;
      arr[o] = rx; arr[o + 1] = ry; arr[o + 2] = rz; arr[o + 3] = radius;
      arr[o + 4] = r; arr[o + 5] = g; arr[o + 6] = b;
      arr[o + 7] = (L / Math.max(d2, 1e-20)) * exposure;
      arr[o + 8] = type; arr[o + 9] = lx; arr[o + 10] = ly; arr[o + 11] = lz;
      if (opaque) nbh++; else n++;
    };
    const starColor = (st: { T: number; phase: number }): [number, number, number] => {
      if (st.phase === PHASE.BLACK_HOLE) return [1.0, 0.75, 0.45];
      blackbodyRGB(st.T, col);
      return [col[0], col[1], col[2]];
    };
    for (const b of list) {
      const rx = sx + b.x * AU_PC, ry = sy + b.y * AU_PC, rz = sz + b.z * AU_PC;
      let type = 0, L = 0, color: [number, number, number], label = '', radius = b.radius;
      if (b.kind === 'star' || b.kind === 'companion') {
        const st = b.kind === 'star' ? P : system.companion!.state;
        color = starColor(st);
        if (st.phase === PHASE.BLACK_HOLE) { type = 3; L = 1; radius = 9.6e-14 * (b.kind === 'star' ? system.mass : system.companion!.mass) * 3; label = 'trou noir'; } // r_s (x3 pour la visibilité)
        else if (st.phase === PHASE.NEUTRON_STAR) { type = 4; L = 1; label = 'pulsar'; }
        else { L = st.L; label = b.kind === 'star' ? 'étoile' : 'compagnon'; }
      } else if (b.kind === 'comet') {
        type = 1.02; color = [0.8, 0.85, 0.9]; label = system.comets[b.planet].name ?? `comète ${b.planet + 1}`;
        const dist = Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z);
        L = P.L * 0.3 * Math.pow(radius / (2 * dist * AU_PC), 2);
        // queue : s'éloigne de l'étoile, longueur ~ 0,5 UA * (2 UA / r)^2, plafonnée
        const len = 0.5 * Math.min(6, Math.pow(2 / Math.max(dist, 0.1), 2));
        if (len > 0.05) tails.push({ x: rx, y: ry, z: rz, dx: b.x / dist, dy: b.y / dist, dz: b.z / dist, len: len * AU_PC });
      } else {
        const pl = system.planets[b.planet];
        const src = b.kind === 'moon' ? pl.moons[b.moon] : pl;
        color = src.color;
        const kindIdx = b.kind === 'moon' ? (pl.moons[b.moon].kind === 'glacée' ? 1 : 0) : (pl.kind === 'rocheuse' || pl.kind === 'super-terre' ? 0 : pl.kind === 'géante gazeuse' ? 2 : pl.kind === 'géante de glace' ? 3 : 4);
        type = 1 + kindIdx / 5 + 0.02;
        // lumière réfléchie : L * albédo * (R / 2a)^2 (albédo 0,3)
        const dist = Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z);
        L = P.L * 0.3 * Math.pow(radius / (2 * dist * AU_PC), 2);
        label = b.kind === 'moon' ? (pl.moons[b.moon].name ?? `lune ${b.moon + 1} de ${pl.name ?? 'la planète ' + (b.planet + 1)}`) : (pl.name ?? `planète ${b.planet + 1}`);
        if (b.kind === 'planet') { centers[(b.planet + 1) * 3] = rx; centers[(b.planet + 1) * 3 + 1] = ry; centers[(b.planet + 1) * 3 + 2] = rz; }
      }
      const dist = Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z);
      const ln = dist > 0 ? -1 / (dist * AU_PC) : 0;
      push(rx, ry, rz, radius, color[0], color[1], color[2], L, type, b.x * AU_PC * ln, b.y * AU_PC * ln, b.z * AU_PC * ln);
      this.bodies.push({ body: { ...b }, rel: new THREE.Vector3(rx, ry, rz), abs: new THREE.Vector3(rx + camWorld.x, ry + camWorld.y, rz + camWorld.z), type, label });
    }
    // orbites : planètes autour de l'étoile, lunes autour de leur planète
    const op = this.orbitPos.array as Float32Array;
    let ov = 0;
    if (showOrbits) {
      const drawOrbit = (a: number, e: number, period: number, phase0: number, inc: number, node: number, cx: number, cy: number, cz: number) => {
        if (ov / 6 + ORBIT_SEG > MAX_ORBITS * ORBIT_SEG) return;
        for (let k = 0; k < ORBIT_SEG; k++) {
          orbitPosition(a, e, period, phase0, inc, node, (k / ORBIT_SEG) * period, this.tmp);
          orbitPosition(a, e, period, phase0, inc, node, ((k + 1) / ORBIT_SEG) * period, this.tmp2);
          op[ov++] = cx + this.tmp[0] * AU_PC; op[ov++] = cy + this.tmp[1] * AU_PC; op[ov++] = cz + this.tmp[2] * AU_PC;
          op[ov++] = cx + this.tmp2[0] * AU_PC; op[ov++] = cy + this.tmp2[1] * AU_PC; op[ov++] = cz + this.tmp2[2] * AU_PC;
        }
      };
      system.planets.forEach((pl, i) => {
        drawOrbit(pl.a, pl.e, pl.period, pl.phase0, pl.inc, pl.node, sx, sy, sz);
        const cx = centers[(i + 1) * 3], cy = centers[(i + 1) * 3 + 1], cz = centers[(i + 1) * 3 + 2];
        for (const m of pl.moons) drawOrbit(m.a, 0.01, m.period, m.phase0, pl.inc + m.inc, pl.node, cx, cy, cz);
      });
    }
    // queues de comètes : segments dégradés dans la direction anti-stellaire
    const tp = this.tailPos.array as Float32Array, tc = this.tailCol.array as Float32Array;
    let tv = 0;
    for (const t of tails) {
      for (let k = 0; k < 12 && tv / 3 + 2 <= MAX_TAIL_V; k++) {
        const f0 = k / 12, f1 = (k + 1) / 12;
        tp[tv] = t.x + t.dx * t.len * f0; tp[tv + 1] = t.y + t.dy * t.len * f0; tp[tv + 2] = t.z + t.dz * t.len * f0;
        tp[tv + 3] = t.x + t.dx * t.len * f1; tp[tv + 4] = t.y + t.dy * t.len * f1; tp[tv + 5] = t.z + t.dz * t.len * f1;
        const b0 = (1 - f0) * 0.8, b1 = (1 - f1) * 0.8;
        tc[tv] = 0.7 * b0; tc[tv + 1] = 0.85 * b0; tc[tv + 2] = b0; tc[tv + 3] = 0.7 * b1; tc[tv + 4] = 0.85 * b1; tc[tv + 5] = b1;
        tv += 6;
      }
    }
    this.tailPos.needsUpdate = true; this.tailCol.needsUpdate = true;
    (this.tailLines.geometry as THREE.BufferGeometry).setDrawRange(0, tv / 3);
    this.tailLines.visible = tv > 0;
    this.bodyGeo.instanceCount = n; this.bodyBuf.needsUpdate = true;
    this.bhGeo.instanceCount = nbh; this.bhBuf.needsUpdate = true;
    this.orbitPos.needsUpdate = true;
    (this.orbits.geometry as THREE.BufferGeometry).setDrawRange(0, ov / 3);
    this.orbits.visible = showOrbits && ov > 0;
    for (const u of [this.bodyMat.uniforms, this.bhMat.uniforms]) {
      u.uNow.value = performance.now() / 1000;
      u.uPulsarPeriod.value = system.pulsarPeriod;
      u.uProj.value.copy(camera.projectionMatrix);
      u.uView.value.copy(viewRot);
      u.uPixelScale.value = pixelScale;
    }
    const bu = this.beltMat.uniforms;
    bu.uProj.value.copy(camera.projectionMatrix);
    bu.uView.value.copy(viewRot);
    bu.uT.value = tYears - this.beltT0;
    bu.uInc0.value = 0;
    bu.uNode0.value = 0;
    bu.uExposure.value = exposure;
    bu.uPixelScale.value = pixelScale;
  }
}
