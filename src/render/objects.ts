// Objets discrets : amas globulaires, régions HII / nébuleuses, trou noir central.
import * as THREE from 'three';
import cloudVert from './shaders/cloud.vert.glsl?raw';
import starFrag from './shaders/star.frag.glsl?raw';
import { vertexShader, fragmentShader, dustUniforms } from './shaderlib';
import { Grid } from '../galaxy/grid';
import { density } from '../galaxy/density';
import { buildPopTable, samplePop, youngPopMean, type PopTable } from '../galaxy/stellar';

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gauss(rng: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

interface Cloud { points: THREE.Points; mat: THREE.RawShaderMaterial }

export interface GlobularInfo { pos: THREE.Vector3; members: number; radius: number }

export class Objects {
  group = new THREE.Group();
  globulars: GlobularInfo[] = [];
  private clouds: Cloud[] = [];
  private haloPop: PopTable;
  private tmp = new Float32Array(4);

  constructor(_grid: Grid) {
    const rng = mulberry(98765);
    this.haloPop = buildPopTable('halo');

    // --- amas globulaires (157)
    {
      const NG = 157, PER = 1200;
      const pos = new Float32Array(NG * PER * 3), L = new Float32Array(NG * PER), col = new Float32Array(NG * PER * 3), rad = new Float32Array(NG * PER);
      let k = 0;
      for (let g = 0; g < NG; g++) {
        // distribution r^-3.5 entre 1 et 40 kpc, aplatissement léger
        const r = 1000 * Math.pow(1 - rng() * (1 - Math.pow(40, -2.5)), -1 / 2.5);
        const cth = rng() * 2 - 1, ph = rng() * 2 * Math.PI;
        const sth = Math.sqrt(1 - cth * cth);
        const gx = r * sth * Math.cos(ph), gy = r * sth * Math.sin(ph), gz = r * cth * 0.8;
        const members = Math.pow(10, 4.5 + rng() * 1.7);
        const rc = 2 + rng() * 6; // rayon de Plummer (pc)
        this.globulars.push({ pos: new THREE.Vector3(gx, gy, gz), members, radius: rc });
        for (let i = 0; i < PER; i++) {
          // profil de Plummer
          const u = rng();
          const rr = rc / Math.sqrt(Math.pow(Math.max(u, 1e-6), -2 / 3) - 1);
          const c2 = rng() * 2 - 1, p2 = rng() * 2 * Math.PI, s2 = Math.sqrt(1 - c2 * c2);
          pos[k * 3] = gx + rr * s2 * Math.cos(p2); pos[k * 3 + 1] = gy + rr * s2 * Math.sin(p2); pos[k * 3 + 2] = gz + rr * c2;
          L[k] = members / PER; // × L moyenne halo (uniform)
          col[k * 3] = 1.0; col[k * 3 + 1] = 0.82; col[k * 3 + 2] = 0.62;
          rad[k] = 0;
          k++;
        }
      }
      this.clouds.push(this.makeCloud(pos, L, col, rad, 0, 24));
    }

    // --- régions HII / nébuleuses dans les bras jeunes
    {
      const NN = 5000;
      const pos = new Float32Array(NN * 3), L = new Float32Array(NN), col = new Float32Array(NN * 3), rad = new Float32Array(NN);
      const d = new Float64Array(5);
      let k = 0, tries = 0;
      while (k < NN && tries < NN * 400) {
        tries++;
        const x = (rng() * 2 - 1) * 16000, y = (rng() * 2 - 1) * 16000, z = gauss(rng) * 60;
        density(x, y, z, d);
        const w = d[1] * d[4] * d[4] * Math.exp(Math.sqrt(x * x + y * y) / 4000); // favorise les bras externes aussi
        if (rng() * 0.004 > w) continue;
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        const big = rng() < 0.08;
        rad[k] = big ? 40 + rng() * 60 : 8 + rng() * 20;
        L[k] = (big ? 3e5 : 3e4) * (0.5 + rng());
        const t = rng();
        // rose Hα dominant, parfois bleu (réflexion) ou vert-bleu (OIII)
        if (t < 0.7) { col[k * 3] = 1.0; col[k * 3 + 1] = 0.3; col[k * 3 + 2] = 0.42; }
        else if (t < 0.85) { col[k * 3] = 0.45; col[k * 3 + 1] = 0.6; col[k * 3 + 2] = 1.0; }
        else { col[k * 3] = 0.5; col[k * 3 + 1] = 0.95; col[k * 3 + 2] = 0.85; }
        k++;
      }
      this.clouds.push(this.makeCloud(pos.subarray(0, k * 3), L.subarray(0, k), col.subarray(0, k * 3), rad.subarray(0, k), 1, 160));
    }

    // --- amas ouverts jeunes dans les bras (population jeune, dissous après ~300 Ma : rendus fixes, lumière jeune)
    {
      const NO = 2500, PER = 80;
      const young = youngPopMean();
      const pos = new Float32Array(NO * PER * 3), L = new Float32Array(NO * PER), col = new Float32Array(NO * PER * 3), rad = new Float32Array(NO * PER);
      const d = new Float64Array(5);
      let k = 0, nc = 0, tries = 0;
      while (nc < NO && tries < NO * 400) {
        tries++;
        const x = (rng() * 2 - 1) * 15000, y = (rng() * 2 - 1) * 15000, z = gauss(rng) * 70;
        density(x, y, z, d);
        const w = d[1] * (0.05 + d[4]) * Math.exp(Math.sqrt(x * x + y * y) / 5000);
        if (rng() * 0.003 > w) continue;
        const members = 100 + Math.pow(10, 1.5 + rng() * 1.8);
        const rc = 1.5 + rng() * 3;
        for (let i = 0; i < PER; i++) {
          const u = rng();
          const rr = rc / Math.sqrt(Math.pow(Math.max(u, 1e-6), -2 / 3) - 1);
          const c2 = rng() * 2 - 1, p2 = rng() * 2 * Math.PI, s2 = Math.sqrt(1 - c2 * c2);
          pos[k * 3] = x + rr * s2 * Math.cos(p2); pos[k * 3 + 1] = y + rr * s2 * Math.sin(p2); pos[k * 3 + 2] = z + rr * c2 * 0.7;
          L[k] = (members * young.L) / PER;
          col[k * 3] = young.rgb[0]; col[k * 3 + 1] = young.rgb[1]; col[k * 3 + 2] = young.rgb[2];
          rad[k] = 0;
          k++;
        }
        nc++;
      }
      this.clouds.push(this.makeCloud(pos.subarray(0, k * 3), L.subarray(0, k), col.subarray(0, k * 3), rad.subarray(0, k), 0, 24));
    }

    // --- Sgr A* : source compacte au centre
    {
      const pos = new Float32Array([0, 0, 0, 0, 0, 0]);
      const L = new Float32Array([4e4, 2e5]);
      const col = new Float32Array([1.0, 0.5, 0.2, 0.6, 0.4, 1.0]);
      const rad = new Float32Array([0.3, 3]);
      this.clouds.push(this.makeCloud(pos, L, col, rad, 1, 64));
    }
    for (const c of this.clouds) this.group.add(c.points);
  }

  private makeCloud(pos: Float32Array, L: Float32Array, col: Float32Array, rad: Float32Array, soft: number, maxSize: number): Cloud {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aL', new THREE.BufferAttribute(L, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aRadius', new THREE.BufferAttribute(rad, 1));
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertexShader(cloudVert),
      fragmentShader: fragmentShader(starFrag),
      uniforms: {
        uProj: { value: new THREE.Matrix4() }, uView: { value: new THREE.Matrix4() },
        uCamPat: { value: new THREE.Vector3() }, uTheta: { value: 0 },
        uExposure: { value: 1 }, uPixelScale: { value: 1000 }, uMaxSize: { value: maxSize },
        uLumScale: { value: 1 }, uSoft: { value: soft },
        ...dustUniforms(),
      },
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 5;
    return { points, mat };
  }

  setDust(on: boolean): void {
    for (const c of this.clouds) c.mat.uniforms.uDustOn.value = on ? 1 : 0;
  }

  update(camera: THREE.PerspectiveCamera, viewRot: THREE.Matrix4, camPat: THREE.Vector3, theta: number, time: number, exposure: number, pixelScale: number): void {
    samplePop(this.haloPop, time, this.tmp);
    const haloL = this.tmp[0];
    const diskOn = Math.min(1, Math.max(0, (time - 3000) / 1000));
    const globOn = Math.min(1, Math.max(0, (time - 300) / 500));
    const scales = [haloL * globOn, diskOn, diskOn, 1];
    this.clouds.forEach((c, i) => {
      const u = c.mat.uniforms;
      u.uProj.value.copy(camera.projectionMatrix);
      u.uView.value.copy(viewRot);
      u.uCamPat.value.copy(camPat);
      u.uTheta.value = theta;
      u.uExposure.value = exposure;
      u.uPixelScale.value = pixelScale;
      u.uLumScale.value = scales[i];
      c.points.visible = scales[i] > 0;
    });
  }
}
