// Rendu des étoiles individuelles : un draw call instancié par "bucket" (2^b sommets par noeud).
import * as THREE from 'three';
import starVert from './shaders/star.vert.glsl?raw';
import starFrag from './shaders/star.frag.glsl?raw';
import { vertexShader, fragmentShader, imfUniforms, dustUniforms } from './shaderlib';
import { FLOATS_PER_INSTANCE, NUM_BUCKETS } from '../galaxy/lod';
import { NBINS } from '../galaxy/bins';
import { VIS_NL } from '../galaxy/visq';

export class StarRenderer {
  group = new THREE.Group();
  material: THREE.RawShaderMaterial;
  private meshes: THREE.Points[] = [];
  private attrs: THREE.InstancedInterleavedBuffer[] = [];

  constructor() {
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertexShader(starVert),
      fragmentShader: fragmentShader(starFrag),
      uniforms: {
        ...imfUniforms(),
        ...dustUniforms(),
        uProj: { value: new THREE.Matrix4() },
        uView: { value: new THREE.Matrix4() },
        uAnchorRel: { value: new THREE.Vector3() },
        uCamPat: { value: new THREE.Vector3() },
        uTheta: { value: 0 },
        uTime: { value: 13000 },
        uTRef: { value: 13000 },
        uFluxMin: { value: 1e-6 },
        uExposure: { value: 1 },
        uPixelScale: { value: 1000 },
        uMaxSize: { value: 48 },
        uSizeGain: { value: 0.85 },
        uDebug: { value: 0 },
        uSkip: { value: new THREE.Vector3(-1, -1, -1) },
        uArmReject: { value: 1 },
        uDebugBin: { value: 0 },
        uQTO: { value: new Float32Array(NBINS) },
        uVisTab: { value: new Float32Array(NBINS * VIS_NL) },
      },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    for (let b = 0; b < NUM_BUCKETS; b++) {
      const count = 1 << b;
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count), 1));
      const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(FLOATS_PER_INSTANCE * 64), FLOATS_PER_INSTANCE);
      buf.setUsage(THREE.DynamicDrawUsage);
      StarRenderer.bind(geo, buf);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      geo.instanceCount = 0;
      const mesh = new THREE.Points(geo, this.material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10 + b;
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.attrs.push(buf);
    }
  }

  private static bind(geo: THREE.InstancedBufferGeometry, buf: THREE.InstancedInterleavedBuffer): void {
    for (let k = 0; k < 5; k++) geo.setAttribute('a' + 'ABCDE'[k], new THREE.InterleavedBufferAttribute(buf, 4, k * 4));
  }

  /** copie les buffers produits par le LodBuilder */
  upload(lod: { buckets: { count: number; data: Float32Array<ArrayBufferLike> }[]; vis: { data: Float32Array<ArrayBufferLike> } }): void {
    (this.material.uniforms.uVisTab.value as Float32Array).set(lod.vis.data);
    for (let b = 0; b < NUM_BUCKETS; b++) {
      const bk = lod.buckets[b];
      const geo = this.meshes[b].geometry as THREE.InstancedBufferGeometry;
      geo.instanceCount = bk.count;
      this.meshes[b].visible = bk.count > 0;
      if (bk.count === 0) continue;
      let buf = this.attrs[b];
      const need = bk.count * FLOATS_PER_INSTANCE;
      if (buf.array.length < need) {
        buf = new THREE.InstancedInterleavedBuffer(new Float32Array(Math.max(need, buf.array.length * 2)), FLOATS_PER_INSTANCE);
        buf.setUsage(THREE.DynamicDrawUsage);
        this.attrs[b] = buf;
        StarRenderer.bind(geo, buf);
      }
      (buf.array as Float32Array).set(bk.data.subarray(0, need));
      buf.count = bk.count;
      // three.js fige _maxInstanceCount lors de la première configuration des attributs : on le resynchronise
      (geo as unknown as { _maxInstanceCount: number })._maxInstanceCount = bk.count;
      buf.needsUpdate = true;
      buf.clearUpdateRanges();
      buf.addUpdateRange(0, need);
    }
  }
}
