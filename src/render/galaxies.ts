// Galaxies d'arrière-plan : satellites (nuages de Magellan, naines sphéroïdales), groupe local, champ jusqu'à 80 Mpc.
import * as THREE from 'three';
import galVert from './shaders/galaxy.vert.glsl?raw';
import galFrag from './shaders/galaxy.frag.glsl?raw';
import { vertexShader, fragmentShader } from './shaderlib';
import type { Pickable } from './objects';

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Galaxies {
  points: THREE.Points;
  material: THREE.RawShaderMaterial;
  pickables: Pickable[] = [];

  constructor() {
    const rng = mulberry(4242);
    const pos: number[] = [], rad: number[] = [], L: number[] = [], par: number[] = [];
    const add = (x: number, y: number, z: number, radius: number, lum: number, type: number, cosI: number, pa: number, seed: number, name: string, info: string[]) => {
      pos.push(x, y, z); rad.push(radius); L.push(lum); par.push(type, cosI, pa, seed);
      this.pickables.push({ kind: 'galaxie', pos: new THREE.Vector3(x, y, z), radius: radius * 1.5, info: [name, ...info] });
    };
    // satellites proches
    add(-1000, -44000, -28000, 3200, 2e9, 0.9, 0.7, 0.6, 1.3, 'Grand Nuage (irrégulière)', ['~50 kpc, 2×10⁹ L☉, formation stellaire active']);
    add(9000, -55000, -37000, 1600, 5e8, 0.95, 0.6, 1.9, 2.7, 'Petit Nuage (irrégulière)', ['~65 kpc, 5×10⁸ L☉']);
    for (let i = 0; i < 12; i++) {
      const d = 60000 + rng() * 200000, th = rng() * Math.PI * 2, ph = (rng() - 0.5) * Math.PI;
      add(d * Math.cos(ph) * Math.cos(th), d * Math.cos(ph) * Math.sin(th), d * Math.sin(ph), 400 + rng() * 800, 1e6 + rng() * 5e7, 0, 0.6 + 0.4 * rng(), rng() * Math.PI, rng() * 10, 'naine sphéroïdale', [`${(d / 1000).toFixed(0)} kpc, vieilles étoiles, sans gaz`]);
    }
    // groupe local
    add(420000, 380000, -530000, 30000, 2.6e10, 1, 0.22, 0.9, 0.4, 'grande spirale voisine', ['780 kpc, 2,6×10¹⁰ L☉, inclinée à 77°']);
    add(300000, 520000, -600000, 10000, 4e9, 1, 0.75, 2.2, 5.1, 'spirale du groupe local', ['850 kpc, 4×10⁹ L☉']);
    // champ lointain : 3 à 80 Mpc, hors du plan galactique (zone d'évitement)
    for (let i = 0; i < 700; i++) {
      const d = Math.pow(10, 6.5 + 1.4 * rng());
      const th = rng() * Math.PI * 2;
      let sinB = rng() * 2 - 1;
      if (Math.abs(sinB) < 0.12) continue;
      const cosB = Math.sqrt(1 - sinB * sinB);
      const type = rng() < 0.35 ? 0 : rng() < 0.85 ? 1 : 0.95;
      const radius = 3000 + Math.pow(rng(), 1.5) * 25000;
      const lum = Math.pow(10, 9 + 2.2 * rng());
      add(d * cosB * Math.cos(th), d * cosB * Math.sin(th), d * sinB, radius, lum, type, 0.15 + 0.85 * rng(), rng() * Math.PI, rng() * 20,
        type < 0.5 ? 'galaxie elliptique' : type > 0.9 ? 'galaxie irrégulière' : 'galaxie spirale', [`${(d / 1e6).toFixed(1)} Mpc, ${(lum / 1e9).toFixed(1)}×10⁹ L☉, rayon ${(radius / 1000).toFixed(0)} kpc`]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pos), 3));
    geo.setAttribute('aRadius', new THREE.BufferAttribute(Float32Array.from(rad), 1));
    geo.setAttribute('aL', new THREE.BufferAttribute(Float32Array.from(L), 1));
    geo.setAttribute('aParams', new THREE.BufferAttribute(Float32Array.from(par), 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertexShader(galVert),
      fragmentShader: fragmentShader(galFrag),
      uniforms: {
        uProj: { value: new THREE.Matrix4() }, uView: { value: new THREE.Matrix4() },
        uCamPat: { value: new THREE.Vector3() }, uTheta: { value: 0 }, uExposure: { value: 1 }, uPixelScale: { value: 1000 },
      },
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 0;
  }

  update(camera: THREE.PerspectiveCamera, viewRot: THREE.Matrix4, camPat: THREE.Vector3, theta: number, exposure: number, pixelScale: number): void {
    const u = this.material.uniforms;
    u.uProj.value.copy(camera.projectionMatrix);
    u.uView.value.copy(viewRot);
    u.uCamPat.value.copy(camPat);
    u.uTheta.value = theta;
    u.uExposure.value = exposure;
    u.uPixelScale.value = pixelScale;
  }
}
