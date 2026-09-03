// Auto-exposition par relecture de l'image HDR : sous-échantillonnage 24x24 de la luminance (avant bloom
// et tone mapping), puis asservissement de l'exposition sur la moyenne des blocs les plus lumineux.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const N = 24;

export class ExposurePass extends Pass {
  private rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  private quad: FullScreenQuad;
  private mat: THREE.RawShaderMaterial;
  private pixels = new Float32Array(N * N * 4);
  private frame = 0;
  /** luminance mesurée (moyenne des 20 % de blocs les plus lumineux) à l'exposition courante */
  measured = 0;
  target = 0.16;
  private logExp = Math.log(4);
  exposure = 4;

  constructor() {
    super();
    this.needsSwap = false;
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { tDiffuse: { value: null } },
      vertexShader: `precision highp float; in vec3 position; in vec2 uv; out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }`,
      fragmentShader: `precision highp float; in vec2 vUv; uniform sampler2D tDiffuse; out vec4 fragColor;
        void main(){
          // moyenne de 64 texels répartis dans le bloc (bloc = 1/${N} de l'image)
          float s = 0.0;
          for (int i = 0; i < 8; i++) for (int j = 0; j < 8; j++) {
            vec2 o = (vec2(float(i), float(j)) - 3.5) * (1.0 / ${N}.0 / 8.0);
            vec3 c = texture(tDiffuse, vUv + o).rgb;
            s += dot(c, vec3(0.2126, 0.7152, 0.0722));
          }
          fragColor = vec4(s / 64.0, 0.0, 0.0, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
  }

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    this.frame++;
    if (this.frame % 3 !== 0) return;
    this.mat.uniforms.tDiffuse.value = read.texture;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    this.quad.render(renderer);
    renderer.readRenderTargetPixels(this.rt, 0, 0, N, N, this.pixels);
    renderer.setRenderTarget(prev);
    const lum: number[] = [];
    for (let i = 0; i < N * N; i++) lum.push(this.pixels[i * 4]);
    lum.sort((a, b) => b - a);
    // mélange : blocs les plus lumineux (évite la saturation d'un petit objet) et 20 % supérieurs (scène étendue)
    const n3 = Math.max(1, Math.floor(N * N * 0.03)), n20 = Math.max(1, Math.floor(N * N * 0.2));
    let s3 = 0, s20 = 0;
    for (let i = 0; i < n20; i++) { if (i < n3) s3 += lum[i]; s20 += lum[i]; }
    this.measured = 0.5 * (s3 / n3) + 0.5 * (s20 / n20);
  }

  /** met à jour l'exposition (appelée chaque frame) et la retourne */
  update(dt: number): number {
    if (this.measured > 0) {
      const want = this.logExp + Math.log(this.target / this.measured);
      const clamped = Math.max(Math.log(0.05), Math.min(Math.log(400), want));
      const k = 1 - Math.exp(-dt * 3);
      this.logExp += (clamped - this.logExp) * k;
      this.exposure = Math.exp(this.logExp);
    }
    return this.exposure;
  }
}
