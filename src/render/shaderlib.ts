import stellarGlsl from './shaders/stellar.glsl?raw';
import extinctionGlsl from './shaders/extinction.glsl?raw';
import { ARMS, ARM_PITCH, ARM_R0, ARM_SIGMA, T_MAX_BIRTH } from '../galaxy/params';
import { YOUNG_TAU, IMF_CUM } from '../galaxy/stellar';
import { F_CAP, NBINS, YOUNG_AGES, YOUNG_ARM, YOUNG_BASE, YOUNG_W } from '../galaxy/bins';
import { GLOW_FAR, GLOW_NEAR, NEAR_D, NEAR_MIN } from '../galaxy/lod';
import * as THREE from 'three';

const DEFINES = `#define T_MAX_BIRTH ${T_MAX_BIRTH.toFixed(1)}
#define YOUNG_TAU ${YOUNG_TAU.toFixed(1)}
#define F_CAP ${F_CAP.toFixed(7)}
#define NBINS ${NBINS}
#define YOUNG_BASE ${YOUNG_BASE.toFixed(5)}
#define YOUNG_ARM ${YOUNG_ARM.toFixed(5)}
#define GLOW_NEAR ${GLOW_NEAR.toFixed(2)}
#define GLOW_FAR ${GLOW_FAR.toFixed(2)}
#define NEAR_D ${NEAR_D.toFixed(1)}
#define NEAR_MIN ${NEAR_MIN.toExponential(4)}
// bonus de proximité du seuil de flux (miroir de lod.ts nearScale)
float nearScale(float d) { float x = d / NEAR_D; return clamp(x * x, NEAR_MIN, 1.0); }
const float YOUNG_AGES[7] = float[7](${YOUNG_AGES.map((a) => a.toFixed(1)).join(', ')});
#define ARM_K ${(1 / Math.tan(ARM_PITCH)).toFixed(6)}
#define ARM_R0 ${ARM_R0.toFixed(1)}
#define ARM_SIGMA ${ARM_SIGMA.toFixed(4)}
const float ARM_PHI[4] = float[4](${ARMS.map((a) => a.phi0.toFixed(6)).join(', ')});
const float ARM_AMP[4] = float[4](${ARMS.map((a) => (a.amp / 1.2).toFixed(4)).join(', ')});
const float YOUNG_W[6] = float[6](${YOUNG_W.map((a) => a.toFixed(6)).join(', ')});
`;

/** assemble un vertex shader GLSL 300 es avec les includes maison */
export function vertexShader(src: string): string {
  return `precision highp float;\nprecision highp int;\n${DEFINES}` + src.replace('#include <stellar>', stellarGlsl).replace('#include <extinction>', extinctionGlsl);
}
export function fragmentShader(src: string): string {
  return src;
}

// extinction : calibrée pour ~0.8 mag/kpc (tau_V) dans le plan au voisinage solaire
import { dustDensity } from '../galaxy/density';
import { SUN_POS } from '../galaxy/params';
export const DUST_KAPPA = 0.8e-3 / dustDensity(SUN_POS.x, SUN_POS.y, 0);
export function dustUniforms(): Record<string, THREE.IUniform> {
  return { uKappa: { value: DUST_KAPPA }, uDustOn: { value: 1 } };
}

// uniforms IMF partagés (mêmes valeurs que stellar.ts)
const IMF_C = [1, Math.pow(0.08, 1.0), Math.pow(0.08, 1.0) * Math.pow(0.5, 1.0)];
const seg = [0.3, 1.3, 2.3].map((a, i) => {
  const p = 1 - a; const B = [0.01, 0.08, 0.5, 150];
  return (IMF_C[i] * (Math.pow(B[i + 1], p) - Math.pow(B[i], p))) / p;
});
export function imfUniforms(): Record<string, THREE.IUniform> {
  return {
    uImfCum: { value: new THREE.Vector4(IMF_CUM[0], IMF_CUM[1], IMF_CUM[2], IMF_CUM[3]) },
    uImfC: { value: new THREE.Vector3(IMF_C[0], IMF_C[1], IMF_C[2]) },
    uImfTotal: { value: seg[0] + seg[1] + seg[2] },
  };
}
