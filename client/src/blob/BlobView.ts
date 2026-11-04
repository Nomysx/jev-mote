// The live blob: Three.js scene, smooth easing of every visual parameter, cursor behavior,
// birth (forming out of mist), waking up, pulses, listening shimmer and the dim offline state.

import * as THREE from 'three';
import { hueDelta } from '../../../shared/math';
import { DEFAULT_VISUAL, HUE_KEYS, VISUAL_KEYS, type VisualParams } from '../../../shared/visuals';
import { applyVisual, createBlobGeometry, createBlobMaterial } from './material';
import { mistFragmentShader, mistVertexShader } from './shaders';

const MIST_COUNT = 900;
const BIRTH_MS = 5200;
const DEFAULT_TAU = 0.75; // seconds; ~95% of a change after ~2.2 s

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class BlobView {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  private material = createBlobMaterial();
  private mesh: THREE.Mesh;
  private mist: THREE.Points;
  private mistMat: THREE.ShaderMaterial;
  private mistData: { dir: THREE.Vector3; r: number; speed: number; phase: number; start: THREE.Vector3; delay: number; size: number }[] = [];

  private current: VisualParams = { ...DEFAULT_VISUAL };
  private target: VisualParams = { ...DEFAULT_VISUAL };
  private override: VisualParams | null = null;
  private tau = DEFAULT_TAU;
  private tauResetAt = 0;

  private phase = 0;
  private breathPhase = 0;
  private bouncePhase = 0;
  private time = 0;
  private listen = 0;
  private listenTarget = 0;
  private pulseValue = 0;
  private dimTarget = 0;
  private dimValue = 0;
  private cursor = new THREE.Vector2(0, 0);
  private cursorActive = 0;
  private lastPointerMove = -1e9;
  private birthStart: number | null = null;
  private birthDone: (() => void) | null = null;
  private last = performance.now();
  private running = true;

  /** Called every frame with the current (eased) visual, e.g. to tint the page background. */
  onFrame: ((v: VisualParams) => void) | null = null;

  constructor(private container: HTMLElement, seed: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'blob-canvas';
    container.appendChild(this.canvas);

    this.material.uniforms.uSeed.value = (seed % 997) / 97;
    this.mesh = new THREE.Mesh(createBlobGeometry(), this.material);
    this.scene.add(this.mesh);
    this.camera.position.set(0, 0.1, 5.6);

    // Mist particles: the birth cloud, then a faint haze that thickens when the blob is unsure.
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MIST_COUNT * 3);
    const size = new Float32Array(MIST_COUNT);
    const alpha = new Float32Array(MIST_COUNT);
    for (let i = 0; i < MIST_COUNT; i++) {
      const dir = new THREE.Vector3().randomDirection();
      const start = new THREE.Vector3().randomDirection().multiplyScalar(2.6 + Math.random() * 2.2);
      this.mistData.push({
        dir,
        r: 1.12 + Math.random() * 0.7,
        speed: (Math.random() * 0.25 + 0.05) * (Math.random() < 0.5 ? -1 : 1),
        phase: Math.random() * Math.PI * 2,
        start,
        delay: Math.random() * 0.45,
        size: 14 + Math.random() * 26,
      });
      size[i] = this.mistData[i].size;
      alpha[i] = 0.3 + Math.random() * 0.7;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    this.mistMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uPixelRatio: { value: this.renderer.getPixelRatio() } },
      vertexShader: mistVertexShader,
      fragmentShader: mistFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mist = new THREE.Points(geo, this.mistMat);
    this.scene.add(this.mist);

    window.addEventListener('pointermove', (e) => {
      this.cursor.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
      this.lastPointerMove = performance.now();
    });
    document.addEventListener('pointerleave', () => (this.lastPointerMove = -1e9));

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    requestAnimationFrame(this.frame);
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the blob comfortably sized on narrow (phone) screens.
    this.camera.fov = w / h < 0.8 ? 48 : 34;
    this.camera.updateProjectionMatrix();
  }

  /** Ease toward a new look. Never snaps unless `immediate` (first load only). */
  setTarget(v: VisualParams, opts: { immediate?: boolean; tau?: number; holdMs?: number } = {}) {
    this.target = { ...v };
    if (opts.immediate) this.current = { ...v };
    if (opts.tau) {
      this.tau = opts.tau;
      this.tauResetAt = performance.now() + (opts.holdMs ?? 4000);
    }
  }

  getTarget(): VisualParams {
    return { ...this.target };
  }

  getCurrent(): VisualParams {
    return { ...this.current };
  }

  /** Debug sliders: drive the blob directly (still eased). */
  setOverride(v: VisualParams | null) {
    this.override = v ? { ...v } : null;
  }

  setListening(on: boolean) {
    this.listenTarget = on ? 1 : 0;
  }

  setDim(on: boolean) {
    this.dimTarget = on ? 1 : 0;
  }

  pulse() {
    this.pulseValue = 1;
  }

  /** Waking up: start from the old look, sleepy and dim, then ease into the current one. */
  wake(before: VisualParams, after: VisualParams) {
    this.current = { ...before, dim: Math.max(before.dim, 0.55), speed: before.speed * 0.3, amplitude: before.amplitude * 0.3 };
    this.setTarget(after, { tau: 1.1, holdMs: 5000 });
  }

  /** The birth animation: the blob forms out of mist. */
  playBirth(): Promise<void> {
    this.birthStart = performance.now();
    return new Promise((resolve) => (this.birthDone = resolve));
  }

  dispose() {
    this.running = false;
    this.renderer.dispose();
  }

  private frame = (nowMs: number) => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, Math.max(0, (nowMs - this.last) / 1000));
    this.last = nowMs;
    this.time += dt;
    if (this.tauResetAt && nowMs > this.tauResetAt) {
      this.tau = DEFAULT_TAU;
      this.tauResetAt = 0;
    }

    // 1. Ease every parameter toward its target.
    const target = this.override ?? this.target;
    const k = 1 - Math.exp(-dt / this.tau);
    for (const key of VISUAL_KEYS) {
      if (HUE_KEYS.includes(key)) {
        this.current[key] = (((this.current[key] + hueDelta(this.current[key], target[key]) * k) % 1) + 1) % 1;
      } else {
        this.current[key] += (target[key] - this.current[key]) * k;
      }
    }
    const kFast = 1 - Math.exp(-dt / 0.5);
    this.listen += (this.listenTarget - this.listen) * kFast;
    this.dimValue += (this.dimTarget - this.dimValue) * (1 - Math.exp(-dt / 1.2));
    this.pulseValue *= Math.exp(-dt / 0.45);
    const pointerRecent = nowMs - this.lastPointerMove < 4000 ? 1 : 0;
    this.cursorActive += (pointerRecent - this.cursorActive) * (1 - Math.exp(-dt / 0.8));

    const v = { ...this.current, dim: Math.max(this.current.dim, this.dimValue) };
    const still = 1 - 0.93 * v.dim;

    // 2. Integrate movement phases (speed changes never cause jumps).
    this.phase += dt * v.speed * still;
    this.breathPhase += dt * (0.75 + 0.9 * v.speed * (1 - 0.6 * v.breathe)) * (0.4 + 0.6 * still);
    this.bouncePhase += dt * (3.2 + 2.2 * v.speed);

    // 3. Birth progress.
    let birth = 1;
    if (this.birthStart !== null) {
      birth = Math.min(1, (nowMs - this.birthStart) / BIRTH_MS);
      if (birth >= 1) {
        this.birthStart = null;
        this.birthDone?.();
        this.birthDone = null;
      }
    }
    const formed = smooth(0.5, 0.95, birth);

    // 4. Transform: trust -> size and closeness; sadness sinks; joy bounces; fear trembles and avoids the cursor.
    const breath = 1 + (0.018 + 0.03 * v.breathe) * Math.sin(this.breathPhase) * (1 - 0.7 * v.dim);
    const bounce = Math.abs(Math.sin(this.bouncePhase)) * 0.2 * v.bounce * still;
    const squash = 0.07 * v.bounce * Math.cos(this.bouncePhase * 2) * still;
    const s = v.scale * breath * (1 + this.pulseValue * 0.09) * (0.55 + 0.45 * smooth(0.45, 1, birth));
    this.mesh.scale.set(s * (1 - squash * 0.5), s * (1 + squash), s * (1 - squash * 0.5));

    const dir = new THREE.Vector3(this.cursor.x * 2.2, this.cursor.y * 1.4, 1).normalize();
    const cursorDir = new THREE.Vector3(0, 0, 1).lerp(dir, this.cursorActive).normalize();
    const pull = (v.lean * 0.3 - v.avoid * 0.38) * this.cursorActive;
    const tremble = v.shrink * 0.012 * Math.sin(this.time * 37) * still;
    const bob = Math.sin(this.time * 0.7) * 0.06 * (1 - 0.6 * v.droop) * still;
    this.mesh.position.set(
      cursorDir.x * pull + tremble,
      -v.sink * 0.55 - v.dim * 0.22 + bob + bounce + cursorDir.y * pull * 0.6,
      cursorDir.z * pull * 0.2,
    );
    this.camera.position.z = 6.6 - 1.2 * v.closeness;
    this.camera.lookAt(0, -0.05, 0);

    // 5. Uniforms.
    const u = this.material.uniforms;
    applyVisual(u, v);
    u.uPhase.value = this.phase;
    u.uTime.value = this.time;
    u.uListen.value = this.listen;
    u.uPulse.value = this.pulseValue;
    u.uOpacity.value = formed;
    u.uCursorDir.value.copy(cursorDir);

    // 6. Mist.
    this.updateMist(v, birth);

    this.renderer.render(this.scene, this.camera);
    this.onFrame?.(v);
  };

  private updateMist(v: VisualParams, birth: number) {
    const pos = this.mist.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const center = this.mesh.position;
    const s = this.mesh.scale.x;
    const tmp = new THREE.Vector3();
    const orbit = new THREE.Vector3();
    for (let i = 0; i < MIST_COUNT; i++) {
      const d = this.mistData[i];
      const a = d.phase + this.time * d.speed * (0.4 + 0.6 * v.speed);
      orbit.copy(d.dir).applyAxisAngle(THREE.Object3D.DEFAULT_UP, a).multiplyScalar(d.r * s).add(center);
      if (birth < 1) {
        const p = easeOutCubic(Math.min(1, Math.max(0, (birth - d.delay) / 0.5)));
        tmp.copy(d.start).lerp(d.dir.clone().multiplyScalar(s), p);
        tmp.lerp(orbit, smooth(0.8, 1, birth));
      } else {
        tmp.copy(orbit);
      }
      arr[i * 3] = tmp.x;
      arr[i * 3 + 1] = tmp.y;
      arr[i * 3 + 2] = tmp.z;
    }
    pos.needsUpdate = true;
    const birthMist = birth < 1 ? 0.9 * (1 - smooth(0.75, 1, birth)) : 0;
    this.mistMat.uniforms.uOpacity.value = (0.03 + v.haze * 0.4 + this.listen * 0.08) * (1 - 0.6 * v.dim) + birthMist;
    (this.mistMat.uniforms.uColor.value as THREE.Color).setHSL(v.hueA, Math.min(1, v.saturation * 0.8), 0.62);
  }
}
