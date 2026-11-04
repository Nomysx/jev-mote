// Shared material setup for the live blob and the journal thumbnails.

import * as THREE from 'three';
import { VISUAL_TUNING, type VisualParams } from '../../../shared/visuals';
import { fragmentShader, vertexShader } from './shaders';

export type BlobUniforms = {
  [K in
    | 'uPhase'
    | 'uAmp'
    | 'uLump'
    | 'uSpikes'
    | 'uDroop'
    | 'uRound'
    | 'uInward'
    | 'uWobble'
    | 'uLean'
    | 'uAvoid'
    | 'uSeed'
    | 'uSplit'
    | 'uHaze'
    | 'uBright'
    | 'uGrey'
    | 'uDim'
    | 'uListen'
    | 'uPulse'
    | 'uTime'
    | 'uOpacity']: { value: number };
} & {
  uCursorDir: { value: THREE.Vector3 };
  uColorA: { value: THREE.Color };
  uColorB: { value: THREE.Color };
  uLightTint: { value: THREE.Color };
};

export function createBlobMaterial(): THREE.ShaderMaterial & { uniforms: BlobUniforms } {
  const uniforms: BlobUniforms = {
    uPhase: { value: 0 },
    uAmp: { value: 0.3 },
    uLump: { value: 0.3 },
    uSpikes: { value: 0 },
    uDroop: { value: 0 },
    uRound: { value: 0 },
    uInward: { value: 0 },
    uWobble: { value: 0 },
    uLean: { value: 0 },
    uAvoid: { value: 0 },
    uSeed: { value: 0 },
    uSplit: { value: 0 },
    uHaze: { value: 0 },
    uBright: { value: 1 },
    uGrey: { value: 0 },
    uDim: { value: 0 },
    uListen: { value: 0 },
    uPulse: { value: 0 },
    uTime: { value: 0 },
    uOpacity: { value: 1 },
    uCursorDir: { value: new THREE.Vector3(0, 0, 1) },
    uColorA: { value: new THREE.Color() },
    uColorB: { value: new THREE.Color() },
    uLightTint: { value: new THREE.Color(1, 1, 1) },
  };
  const m = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true });
  return m as THREE.ShaderMaterial & { uniforms: BlobUniforms };
}

const WARM = new THREE.Color(1.06, 0.98, 0.9);
const COOL = new THREE.Color(0.9, 0.97, 1.08);
const NEUTRAL = new THREE.Color(1, 1, 1);
const WARM_BODY = new THREE.Color(...VISUAL_TUNING.warmRgb);
const COLD_BODY = new THREE.Color(...VISUAL_TUNING.coldRgb);

/** Writes the per-frame-independent visual params into the uniforms. */
export function applyVisual(u: BlobUniforms, v: VisualParams) {
  u.uAmp.value = v.amplitude * (1 - v.dim);
  u.uLump.value = v.lumpiness;
  u.uSpikes.value = v.spikes;
  u.uDroop.value = v.droop;
  u.uRound.value = v.roundness;
  u.uInward.value = v.inward;
  u.uWobble.value = v.wobble * (1 - v.dim);
  u.uLean.value = v.lean;
  u.uAvoid.value = v.avoid;
  u.uSplit.value = v.split;
  u.uHaze.value = v.haze;
  u.uBright.value = v.brightness;
  u.uGrey.value = v.grey;
  u.uDim.value = v.dim;
  const light = 0.55;
  const w = Math.max(-1, Math.min(1, v.warmth));
  const temp = w >= 0 ? WARM_BODY : COLD_BODY;
  const mix = Math.abs(w) * VISUAL_TUNING.temperatureMix;
  u.uColorA.value.setHSL(v.hueA, v.saturation, light).lerp(temp, mix);
  u.uColorB.value.setHSL(v.hueB, Math.min(1, v.saturation + 0.05), light).lerp(temp, mix);
  u.uLightTint.value.copy(NEUTRAL).lerp(w >= 0 ? WARM : COOL, Math.abs(w));
}

/** Indexed sphere: smooth, and far fewer vertices than a subdivided icosahedron. */
export function createBlobGeometry(widthSegments = 192, heightSegments = 144): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, widthSegments, heightSegments);
}
