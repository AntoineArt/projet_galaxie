// Lueur des noeuds : lumière des étoiles sous le seuil de flux, rendue par noeud de l'octree (résolution adaptative)
// sous forme de quads gaussiens instanciés.
import * as THREE from 'three';
import glowVert from './shaders/glow.vert.glsl?raw';
import glowFrag from './shaders/glow.frag.glsl?raw';
import { vertexShader, fragmentShader, dustUniforms } from './shaderlib';
import { GLOW_FLOATS, LodBuilder } from '../galaxy/lod';

export class GlowRenderer {
  mesh: THREE.Mesh;
  material: THREE.RawShaderMaterial;
  private buf: THREE.InstancedInterleavedBuffer;
  private geo = new THREE.InstancedBufferGeometry();

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.buf = new THREE.InstancedInterleavedBuffer(new Float32Array(GLOW_FLOATS * 1024), GLOW_FLOATS);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    this.bind();
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo.instanceCount = 0;
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertexShader(glowVert),
      fragmentShader: fragmentShader(glowFrag),
      uniforms: {
        uProj: { value: new THREE.Matrix4() }, uView: { value: new THREE.Matrix4() },
        uCamPat: { value: new THREE.Vector3() }, uTheta: { value: 0 },
        uExposure: { value: 1 }, uPixelScale: { value: 1000 },
        ...dustUniforms(),
      },
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  private bind(): void {
    this.geo.setAttribute('aCenter', new THREE.InterleavedBufferAttribute(this.buf, 3, 0));
    this.geo.setAttribute('aSigma', new THREE.InterleavedBufferAttribute(this.buf, 1, 3));
    this.geo.setAttribute('aL', new THREE.InterleavedBufferAttribute(this.buf, 1, 4));
    this.geo.setAttribute('aColor', new THREE.InterleavedBufferAttribute(this.buf, 3, 5));
  }

  upload(lod: LodBuilder): void {
    const need = lod.glow.count * GLOW_FLOATS;
    if (this.buf.array.length < need) {
      this.buf = new THREE.InstancedInterleavedBuffer(new Float32Array(Math.max(need, this.buf.array.length * 2)), GLOW_FLOATS);
      this.buf.setUsage(THREE.DynamicDrawUsage);
      this.bind();
    }
    (this.buf.array as Float32Array).set(lod.glow.data.subarray(0, need));
    this.buf.needsUpdate = true;
    this.buf.clearUpdateRanges();
    this.buf.addUpdateRange(0, need);
    this.geo.instanceCount = lod.glow.count;
    this.mesh.visible = lod.glow.count > 0;
  }
}
