// The live blob: Three.js scene, smooth easing of every visual parameter, body gestures, surface
// ripples, cursor and touch behavior, birth (forming out of mist), waking up, pulses, the listening
// shimmer, the dim offline state, and a little scenery (halo, floor shadow, drifting dust).

import * as THREE from 'three';
import { hueDelta } from '../../../shared/math';
import type { Emotion } from '../../../shared/types';
import { DEFAULT_VISUAL, HUE_KEYS, VISUAL_KEYS, type VisualParams } from '../../../shared/visuals';
import { BEHAVIOR_DURATION, behaviorFrame, GestureRig, scaleFrame, type BehaviorKind, type GestureKind } from './gestures';
import { applyVisual, createBlobGeometry, createBlobMaterial } from './material';
import { mistFragmentShader, mistVertexShader, RIPPLE_COUNT } from './shaders';

const MIST_COUNT = 900;
const STREAM_COUNT = 72;
const DUST_COUNT = 70;
const BIRTH_MS = 5200;
const DEFAULT_TAU = 0.75; // seconds; ~95% of a change after ~2.2 s
const STREAM_TRAVEL = 0.72; // seconds for an entry's light to reach the blob
const FLOOR_Y = -1.45;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export type BlobEvent =
  | { type: 'birth-start' }
  | { type: 'birth-pop' }
  | { type: 'absorb' }
  | { type: 'wake' }
  | { type: 'poke'; strength: number; pan: number };

export interface ReactionOptions {
  /** 0..1, how strong the feeling in the entry was. */
  intensity: number;
  /** The second emotion when the reaction was mixed. */
  second?: Emotion;
  /** 0..1, how evenly the reaction was split between its top two emotions. */
  mixed?: number;
  /** 0..1, how clear-cut the reaction was (model confidence). */
  clarity?: number;
}

interface Ripple {
  dir: THREE.Vector3;
  start: number;
  amp: number;
}

interface StreamParticle {
  from: THREE.Vector3;
  ctrl: THREE.Vector3;
  to: THREE.Vector3;
  delay: number;
  size: number;
}

/** A soft round sprite texture drawn on a canvas (no image files). */
function radialTexture(stops: [number, string][]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function pointsMaterial(pixelRatio: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uPixelRatio: { value: pixelRatio } },
    vertexShader: mistVertexShader,
    fragmentShader: mistFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

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
  private stream: THREE.Points;
  private streamMat: THREE.ShaderMaterial;
  private streamData: StreamParticle[] = [];
  private streamStart = -1;
  private streamArrived: (() => void) | null = null;
  private dust: THREE.Points;
  private dustMat: THREE.ShaderMaterial;
  private dustData: { base: THREE.Vector3; speed: number; sway: number; phase: number }[] = [];
  private halo: THREE.Sprite;
  private shadow: THREE.Mesh;

  private current: VisualParams = { ...DEFAULT_VISUAL };
  private target: VisualParams = { ...DEFAULT_VISUAL };
  private override: VisualParams | null = null;
  private tau = DEFAULT_TAU;
  private tauResetAt = 0;

  private rig: GestureRig;
  private ripples: Ripple[] = [];
  private reduceMotion: boolean;
  private dark: boolean;
  private seedPhase: number;

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
  private lastTyping = -1e9;
  private lastTypingRipple = -1e9;
  private attention = 0;
  private lastPoke = -1e9;
  private hovering = false;
  private parallax = new THREE.Vector2(0, 0);
  private birthStart: number | null = null;
  private birthPopped = false;
  private birthDone: (() => void) | null = null;
  private last = performance.now();
  private running = true;
  private tmpQuat = new THREE.Quaternion();
  private behavior: { kind: BehaviorKind; start: number; dur: number; release: number | null } | null = null;
  private haloBoost = 0;

  /** Called every frame with the current (eased) visual, e.g. to tint the page background. */
  onFrame: ((v: VisualParams) => void) | null = null;
  /** Moments worth a sound: birth, pokes, an entry arriving, waking up. */
  onEvent: ((e: BlobEvent) => void) | null = null;

  constructor(private container: HTMLElement, seed: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'blob-canvas';
    container.appendChild(this.canvas);

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.reduceMotion = motionQuery.matches;
    this.dark = darkQuery.matches;
    this.rig = new GestureRig(this.reduceMotion ? 0.35 : 1);
    motionQuery.addEventListener('change', (e) => {
      this.reduceMotion = e.matches;
      this.rig.motion = e.matches ? 0.35 : 1;
    });
    darkQuery.addEventListener('change', (e) => {
      this.dark = e.matches;
      this.applyTheme();
    });
    this.seedPhase = (seed % 1000) / 159;

    this.material.uniforms.uSeed.value = (seed % 997) / 97;
    this.mesh = new THREE.Mesh(createBlobGeometry(), this.material);
    this.mesh.renderOrder = 2;
    this.scene.add(this.mesh);
    this.camera.position.set(0, 0.1, 5.6);

    const pr = this.renderer.getPixelRatio();

    // Halo: a soft glow behind the blob, tinted with its color.
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture([
          [0, 'rgba(255,255,255,0.9)'],
          [0.35, 'rgba(255,255,255,0.35)'],
          [1, 'rgba(255,255,255,0)'],
        ]),
        transparent: true,
        depthWrite: false,
        opacity: 0,
      }),
    );
    this.halo.renderOrder = 0;
    this.scene.add(this.halo);

    // Floor shadow (light theme) / light pool (dark theme): grounds the floating blob.
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: radialTexture([
          [0, 'rgba(255,255,255,1)'],
          [0.45, 'rgba(255,255,255,0.45)'],
          [1, 'rgba(255,255,255,0)'],
        ]),
        transparent: true,
        depthWrite: false,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = FLOOR_Y;
    this.shadow.renderOrder = 1;
    this.scene.add(this.shadow);

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
    this.mistMat = pointsMaterial(pr);
    this.mist = new THREE.Points(geo, this.mistMat);
    this.mist.renderOrder = 3;
    this.scene.add(this.mist);

    // The stream of light that carries a new entry from the text box into the blob.
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STREAM_COUNT * 3), 3));
    sgeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(STREAM_COUNT), 1));
    sgeo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(STREAM_COUNT), 1));
    this.streamMat = pointsMaterial(pr);
    this.stream = new THREE.Points(sgeo, this.streamMat);
    this.stream.visible = false;
    this.stream.frustumCulled = false;
    this.stream.renderOrder = 4;
    this.scene.add(this.stream);

    // Slow dust in the background, with a little parallax when the cursor moves.
    const dgeo = new THREE.BufferGeometry();
    const dsize = new Float32Array(DUST_COUNT);
    const dalpha = new Float32Array(DUST_COUNT);
    for (let i = 0; i < DUST_COUNT; i++) {
      this.dustData.push({
        base: new THREE.Vector3((Math.random() * 2 - 1) * 8, (Math.random() * 2 - 1) * 4.5, -3 - Math.random() * 6),
        speed: 0.04 + Math.random() * 0.1,
        sway: 0.1 + Math.random() * 0.3,
        phase: Math.random() * Math.PI * 2,
      });
      dsize[i] = 8 + Math.random() * 30;
      dalpha[i] = 0.15 + Math.random() * 0.55;
    }
    dgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST_COUNT * 3), 3));
    dgeo.setAttribute('aSize', new THREE.BufferAttribute(dsize, 1));
    dgeo.setAttribute('aAlpha', new THREE.BufferAttribute(dalpha, 1));
    this.dustMat = pointsMaterial(pr);
    this.dust = new THREE.Points(dgeo, this.dustMat);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = -1;
    this.scene.add(this.dust);

    this.applyTheme();

    window.addEventListener('pointermove', (e) => {
      this.cursor.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
      this.lastPointerMove = performance.now();
      const over = e.target === this.canvas && this.hitTest(e.clientX, e.clientY) !== null;
      if (over !== this.hovering) {
        this.hovering = over;
        this.canvas.style.cursor = over ? 'pointer' : '';
      }
    });
    document.addEventListener('pointerleave', () => (this.lastPointerMove = -1e9));
    this.canvas.addEventListener('pointerdown', (e) => this.poke(e.clientX, e.clientY));

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    requestAnimationFrame(this.frame);
  }

  private applyTheme() {
    // Additive light reads as glow on dark backgrounds; on light ones normal blending keeps color visible.
    const glow = this.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    for (const m of [this.mistMat, this.streamMat, this.dustMat]) {
      m.blending = glow;
      m.needsUpdate = true;
    }
    const hm = this.halo.material as THREE.SpriteMaterial;
    hm.blending = glow;
    hm.needsUpdate = true;
    const sm = this.shadow.material as THREE.MeshBasicMaterial;
    sm.blending = this.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    sm.needsUpdate = true;
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

  /** A surprising entry: a jolt, a flash and a wave running down from the top. */
  pulse() {
    this.pulseValue = 1;
    this.rig.play('pulse', this.time);
    this.addRipple(new THREE.Vector3(0, 1, 0), 1.2);
  }

  /** A body gesture for the blob's reaction to an entry. */
  react(emotion: Emotion, o: ReactionOptions) {
    const clarity = o.clarity ?? 0.8;
    const amount = (0.55 + 0.6 * clamp01(o.intensity)) * (clarity < 0.35 ? 0.65 : 1);
    this.rig.play(emotion, this.time, amount);
    if (o.second && o.second !== emotion && (o.mixed ?? 0) > 0.35) this.rig.play(o.second, this.time, amount * 0.5, 0.45);
  }

  /** Distress safeguard: only slow, soft breathing. */
  soothe() {
    this.rig.play('soothe', this.time);
  }

  /** An entry the model could not read (e.g. language): a small puzzled tilt. */
  puzzled() {
    this.rig.play('puzzled', this.time);
  }

  /** Preview any gesture (debug panel). */
  gesture(kind: GestureKind, amount = 1) {
    this.rig.play(kind, this.time, amount);
  }

  /** A sustained action Mote decided on: come closer, hide, nap, wander... Replaces the current one. */
  behave(kind: BehaviorKind, seconds = BEHAVIOR_DURATION[kind]) {
    this.cancelBehavior();
    this.behavior = { kind, start: this.time, dur: seconds, release: null };
    if (kind === 'stretch') this.rig.play('wake', this.time, 0.8);
  }

  /** Eases the current behavior out over about a second (e.g. when a new entry arrives). */
  cancelBehavior() {
    if (this.behavior && this.behavior.release === null) this.behavior.release = this.time;
  }

  get behaving(): BehaviorKind | null {
    return this.behavior && this.behavior.release === null ? this.behavior.kind : null;
  }

  /** Where the blob is on screen (center and radius in CSS px), for thoughts to float around it. */
  getScreenAnchor(): { x: number; y: number; r: number } {
    const rect = this.canvas.getBoundingClientRect();
    const c = this.mesh.position.clone().project(this.camera);
    const e = this.mesh.position.clone().add(new THREE.Vector3(this.mesh.scale.x, 0, 0)).project(this.camera);
    const x = rect.left + (c.x * 0.5 + 0.5) * rect.width;
    const y = rect.top + (-c.y * 0.5 + 0.5) * rect.height;
    return { x, y, r: Math.abs(rect.left + (e.x * 0.5 + 0.5) * rect.width - x) };
  }

  /** The user is typing: the blob attends to the text box, with a tiny ripple now and then. */
  notifyTyping() {
    this.lastTyping = this.time;
    if (this.time - this.lastTypingRipple > 0.14) {
      this.lastTypingRipple = this.time;
      this.addRipple(this.dirToComposer(), this.reduceMotion ? 0.08 : 0.22);
    }
  }

  /**
   * Sends a stream of light from a screen point (the text box) into the blob. Resolves when it
   * arrives, which is when the blob gulps and ripples.
   */
  absorb(screenX: number, screenY: number): Promise<void> {
    const from = this.screenToWorld(screenX, screenY, 1.2);
    const center = this.mesh.position.clone();
    const s = this.mesh.scale.x;
    this.streamData = [];
    const sizes = this.stream.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    for (let i = 0; i < STREAM_COUNT; i++) {
      const start = from.clone().add(new THREE.Vector3((Math.random() * 2 - 1) * 0.7, (Math.random() * 2 - 1) * 0.08, (Math.random() * 2 - 1) * 0.1));
      const dir = new THREE.Vector3((Math.random() * 2 - 1) * 0.8, -0.3 - Math.random() * 0.6, 0.4 + Math.random() * 0.6).normalize();
      const to = center.clone().add(dir.multiplyScalar(s * 0.92));
      const ctrl = start.clone().lerp(to, 0.5).add(new THREE.Vector3((Math.random() * 2 - 1) * 0.6, 0.5 + Math.random() * 0.4, 0.3));
      const size = 10 + Math.random() * 22;
      this.streamData.push({ from: start, ctrl, to, delay: Math.random() * 0.3, size });
      sizes.setX(i, size);
    }
    sizes.needsUpdate = true;
    this.streamStart = this.time;
    this.stream.visible = true;
    this.streamArrived?.();
    return new Promise((resolve) => (this.streamArrived = resolve));
  }

  /** Waking up: start from the old look, sleepy and dim, then stretch and ease into the current one. */
  wake(before: VisualParams, after: VisualParams) {
    this.current = { ...before, dim: Math.max(before.dim, 0.55), speed: before.speed * 0.3, amplitude: before.amplitude * 0.3 };
    this.setTarget(after, { tau: 1.1, holdMs: 5000 });
    this.rig.play('wake', this.time, 1, 0.5);
    this.onEvent?.({ type: 'wake' });
  }

  /** The birth animation: the blob forms out of swirling mist, then pops into shape. */
  playBirth(): Promise<void> {
    this.birthStart = performance.now();
    this.birthPopped = false;
    this.onEvent?.({ type: 'birth-start' });
    return new Promise((resolve) => (this.birthDone = resolve));
  }

  dispose() {
    this.running = false;
    this.renderer.dispose();
  }

  // ---- helpers ----

  private addRipple(dirWorld: THREE.Vector3, amp: number) {
    // Store in object space, so the ripple stays on the same spot of the surface as the blob turns.
    const inv = this.tmpQuat.copy(this.mesh.quaternion).invert();
    const dir = dirWorld.clone().applyQuaternion(inv).normalize();
    this.ripples.push({ dir, start: this.time, amp });
    if (this.ripples.length > RIPPLE_COUNT) this.ripples.shift();
  }

  /** Direction from the blob's center toward the text box (bottom of the screen). */
  private dirToComposer(): THREE.Vector3 {
    const p = this.screenToWorld(window.innerWidth / 2, window.innerHeight - 60, 1.2);
    return p.sub(this.mesh.position).normalize();
  }

  private screenToWorld(x: number, y: number, planeZ: number): THREE.Vector3 {
    const ndc = new THREE.Vector3((x / window.innerWidth) * 2 - 1, -((y / window.innerHeight) * 2 - 1), 0.5);
    ndc.unproject(this.camera);
    const dir = ndc.sub(this.camera.position).normalize();
    const t = (planeZ - this.camera.position.z) / dir.z;
    return this.camera.position.clone().add(dir.multiplyScalar(t));
  }

  /** Where a screen point hits the blob (approximated by its bounding sphere), or null. */
  private hitTest(x: number, y: number): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -((y / window.innerHeight) * 2 - 1)), this.camera);
    const sphere = new THREE.Sphere(this.mesh.position.clone(), this.mesh.scale.x * 1.02);
    return ray.ray.intersectSphere(sphere, new THREE.Vector3());
  }

  private poke(x: number, y: number) {
    const hit = this.hitTest(x, y);
    if (!hit || this.time - this.lastPoke < 0.12) return;
    this.lastPoke = this.time;
    const dir = hit.clone().sub(this.mesh.position).normalize();
    this.addRipple(dir, 1);
    this.rig.play('poke', this.time, 0.8 + Math.random() * 0.3);
    this.onEvent?.({ type: 'poke', strength: 1, pan: Math.max(-1, Math.min(1, dir.x)) });
  }

  // ---- the frame loop ----

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
    const typing = this.time - this.lastTyping < 1.3 ? 1 : 0;
    this.attention += (typing - this.attention) * (1 - Math.exp(-dt / 0.45));

    const pose = this.rig.pose(this.time);
    // A decided-on behavior layers its own pose and look on top (eased in, out, or released).
    let sleepy = 0;
    this.haloBoost = 0;
    const base = { ...this.current, dim: Math.max(this.current.dim, this.dimValue) };
    if (this.behavior) {
      const b = this.behavior;
      const bf = behaviorFrame(b.kind, this.time - b.start, b.dur);
      if (b.release !== null) scaleFrame(bf, 1 - smooth(b.release, b.release + 1.1, this.time));
      if (this.time - b.start >= b.dur || (b.release !== null && this.time - b.release > 1.1)) this.behavior = null;
      for (const key of Object.keys(pose) as (keyof typeof pose)[]) pose[key] += bf.pose[key];
      base.brightness = Math.max(0, base.brightness + bf.brightness - 0.22 * bf.sleepy);
      base.speed = Math.max(0.05, base.speed * (1 + bf.speed) * (1 - 0.6 * bf.sleepy));
      base.amplitude *= 1 - 0.5 * bf.sleepy;
      base.grey = clamp01(base.grey + bf.grey);
      sleepy = bf.sleepy;
      this.haloBoost = bf.halo;
    }
    const v: VisualParams = { ...base, spikes: clamp01(base.spikes + pose.spikes), wobble: clamp01(base.wobble + pose.wobble) };
    const still = 1 - 0.93 * v.dim;
    const motion = this.reduceMotion ? 0.4 : 1;

    // 2. Integrate movement phases (speed changes never cause jumps).
    this.phase += dt * v.speed * still;
    this.breathPhase += dt * (0.75 + 0.9 * v.speed * (1 - 0.6 * v.breathe)) * (0.4 + 0.6 * still);
    this.bouncePhase += dt * (3.2 + 2.2 * v.speed);

    // 3. Birth progress.
    let birth = 1;
    if (this.birthStart !== null) {
      birth = Math.min(1, (nowMs - this.birthStart) / BIRTH_MS);
      if (birth >= 0.93 && !this.birthPopped) {
        this.birthPopped = true;
        this.rig.play('pop', this.time);
        this.onEvent?.({ type: 'birth-pop' });
      }
      if (birth >= 1) {
        this.birthStart = null;
        this.birthDone?.();
        this.birthDone = null;
      }
    }
    const formed = smooth(0.5, 0.95, birth);

    // 4. Body: trust -> size and closeness; sadness sinks; joy bounces; fear trembles and avoids
    //    the cursor; gestures layered on top; a gentle look-around when idle.
    const breath = 1 + (0.018 + 0.03 * v.breathe + 0.02 * sleepy) * Math.sin(this.breathPhase) * (1 - 0.7 * v.dim);
    const bounce = Math.abs(Math.sin(this.bouncePhase)) * 0.2 * v.bounce * still * motion;
    const squash = 0.07 * v.bounce * Math.cos(this.bouncePhase * 2) * still * motion + pose.squash;
    const s = v.scale * breath * (1 + this.pulseValue * 0.09) * (0.55 + 0.45 * smooth(0.45, 1, birth)) * (1 + pose.scale);
    const sy = 1 + squash;
    const sxz = 1 / Math.sqrt(Math.max(0.2, sy));
    this.mesh.scale.set(s * sxz, s * sy, s * sxz);

    const dir = new THREE.Vector3(this.cursor.x * 2.2, this.cursor.y * 1.4, 1).normalize();
    const cursorDir = new THREE.Vector3(0, 0, 1).lerp(dir, this.cursorActive).normalize();
    const pull = (v.lean * 0.3 - v.avoid * 0.38) * this.cursorActive;
    const tremble = this.reduceMotion ? 0 : v.shrink * 0.012 * Math.sin(this.time * 37) * still;
    const bob = Math.sin(this.time * 0.7) * 0.06 * (1 - 0.6 * v.droop) * still;
    this.mesh.position.set(
      cursorDir.x * pull + tremble + pose.x,
      -v.sink * 0.55 - v.dim * 0.22 + bob + bounce + cursorDir.y * pull * 0.6 + pose.y - 0.05 * this.attention,
      cursorDir.z * pull * 0.2 + pose.z + 0.12 * this.attention,
    );

    // Where it "looks": wanders slowly when idle, follows the cursor when curious, turns away when afraid.
    const wander = (1 - this.cursorActive) * still * motion;
    const look = this.cursorActive * (0.25 + 0.5 * v.lean - 0.6 * v.avoid) * still;
    const yaw = (0.16 * Math.sin(this.time * 0.11 + this.seedPhase) + 0.08 * Math.sin(this.time * 0.29)) * wander + this.cursor.x * 0.45 * look + pose.yaw;
    const pitch = 0.06 * Math.sin(this.time * 0.17 + 1.3) * wander - this.cursor.y * 0.25 * look + pose.pitch + 0.1 * this.attention;
    const roll = 0.05 * Math.sin(this.time * 0.13 + this.seedPhase * 2) * wander + pose.roll;
    this.mesh.rotation.set(pitch, yaw, roll);

    this.camera.position.z = 6.6 - 1.2 * v.closeness;
    this.camera.lookAt(0, -0.05, 0);

    // 5. Uniforms.
    const u = this.material.uniforms;
    applyVisual(u, v);
    u.uPhase.value = this.phase;
    u.uTime.value = this.time;
    u.uListen.value = this.listen;
    u.uPulse.value = this.pulseValue;
    u.uGlow.value += this.pulseValue * 0.5 + this.listen * 0.15;
    u.uOpacity.value = formed;
    // The cursor direction is used on the surface, so it goes into the blob's own (rotated) space.
    u.uCursorDir.value.copy(cursorDir).applyQuaternion(this.tmpQuat.copy(this.mesh.quaternion).invert()).normalize();
    this.ripples = this.ripples.filter((r) => this.time - r.start < 3.2);
    for (let i = 0; i < RIPPLE_COUNT; i++) {
      const r = this.ripples[i];
      if (r) {
        u.uRipples.value[i].set(r.dir.x, r.dir.y, r.dir.z, this.time - r.start);
        u.uRippleAmp.value[i] = r.amp;
      } else {
        u.uRipples.value[i].w = -1;
        u.uRippleAmp.value[i] = 0;
      }
    }

    // 6. Particles and scenery.
    this.updateMist(v, birth);
    this.updateStream(v);
    this.updateDust(v, dt);
    this.updateScenery(v, formed, s);

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
    const up = THREE.Object3D.DEFAULT_UP;
    for (let i = 0; i < MIST_COUNT; i++) {
      const d = this.mistData[i];
      const a = d.phase + this.time * d.speed * (0.4 + 0.6 * v.speed);
      orbit.copy(d.dir).applyAxisAngle(up, a).multiplyScalar(d.r * s).add(center);
      if (birth < 1) {
        // The birth cloud swirls inward as it gathers into a body.
        const p = easeOutCubic(Math.min(1, Math.max(0, (birth - d.delay) / 0.5)));
        tmp.copy(d.start).lerp(d.dir.clone().multiplyScalar(s), p);
        tmp.applyAxisAngle(up, (1 - p) * 2.6 * (d.speed > 0 ? 1 : -1));
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
    this.mistMat.uniforms.uOpacity.value = ((0.03 + v.haze * 0.4 + this.listen * 0.08) * (1 - 0.6 * v.dim) + birthMist) * (this.dark ? 1 : 0.7);
    (this.mistMat.uniforms.uColor.value as THREE.Color).setHSL(v.hueA, Math.min(1, v.saturation * 0.8), this.dark ? 0.62 : 0.5);
  }

  private updateStream(v: VisualParams) {
    if (this.streamStart < 0) return;
    const t = this.time - this.streamStart;
    const pos = this.stream.geometry.getAttribute('position') as THREE.BufferAttribute;
    const al = this.stream.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
    const p = new THREE.Vector3();
    let anyAlive = false;
    for (let i = 0; i < this.streamData.length; i++) {
      const d = this.streamData[i];
      const u = (t - d.delay) / STREAM_TRAVEL;
      if (u < 0 || u > 1) {
        al.setX(i, 0);
        if (u < 0) anyAlive = true;
        continue;
      }
      anyAlive = true;
      const e = easeInOut(u);
      // Quadratic Bezier from the text box, arcing up, into the blob's surface.
      p.copy(d.from).multiplyScalar((1 - e) * (1 - e)).addScaledVector(d.ctrl, 2 * (1 - e) * e).addScaledVector(d.to, e * e);
      pos.setXYZ(i, p.x, p.y, p.z);
      al.setX(i, Math.sin(Math.PI * Math.min(1, u * 1.15)) * 0.9);
    }
    pos.needsUpdate = true;
    al.needsUpdate = true;
    this.streamMat.uniforms.uOpacity.value = 1;
    (this.streamMat.uniforms.uColor.value as THREE.Color).setHSL(v.hueA, Math.min(1, v.saturation + 0.2), this.dark ? 0.7 : 0.55);
    if (this.streamArrived && t >= STREAM_TRAVEL + 0.05) {
      this.addRipple(this.dirToComposer(), 0.9);
      this.rig.play('absorb', this.time);
      this.onEvent?.({ type: 'absorb' });
      this.streamArrived();
      this.streamArrived = null;
    }
    if (!anyAlive) {
      this.streamStart = -1;
      this.stream.visible = false;
    }
  }

  private updateDust(v: VisualParams, dt: number) {
    const pos = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.parallax.x += (-this.cursor.x * 0.35 * this.cursorActive - this.parallax.x) * (1 - Math.exp(-dt / 1.5));
    this.parallax.y += (-this.cursor.y * 0.2 * this.cursorActive - this.parallax.y) * (1 - Math.exp(-dt / 1.5));
    const drift = this.reduceMotion ? 0.3 : 1;
    for (let i = 0; i < DUST_COUNT; i++) {
      const d = this.dustData[i];
      let y = d.base.y + ((this.time * d.speed * drift) % 9);
      if (y > 4.5) y -= 9;
      const x = d.base.x + Math.sin(this.time * 0.2 + d.phase) * d.sway + this.parallax.x * (1 + d.base.z / -9);
      pos.setXYZ(i, x, y + this.parallax.y, d.base.z);
    }
    pos.needsUpdate = true;
    this.dustMat.uniforms.uOpacity.value = (this.dark ? 0.32 : 0.22) * (1 - 0.6 * v.dim);
    (this.dustMat.uniforms.uColor.value as THREE.Color).setHSL(v.hueA, v.saturation * 0.4, this.dark ? 0.75 : 0.45);
  }

  private updateScenery(v: VisualParams, formed: number, s: number) {
    const hm = this.halo.material as THREE.SpriteMaterial;
    this.halo.position.set(this.mesh.position.x, this.mesh.position.y, this.mesh.position.z - 0.9);
    this.halo.scale.setScalar(3.6 * s);
    hm.color.setHSL(v.hueA, Math.min(1, v.saturation + 0.1), this.dark ? 0.6 : 0.65);
    hm.opacity = (0.16 + 0.22 * Math.max(0, v.brightness - 0.85) + 0.15 * this.listen + 0.35 * this.pulseValue + 0.3 * this.haloBoost) * (1 - 0.7 * v.dim) * formed * (this.dark ? 1 : 0.55);

    // How far the blob has risen above its resting height (0): the shadow fades and spreads.
    const height = Math.max(0, this.mesh.position.y);
    const sm = this.shadow.material as THREE.MeshBasicMaterial;
    const w = 2.3 * s * (1 + 0.35 * height);
    this.shadow.scale.set(w, w * 0.55, 1);
    this.shadow.position.x = this.mesh.position.x;
    this.shadow.position.z = this.mesh.position.z;
    if (this.dark) sm.color.setHSL(v.hueA, v.saturation, 0.5);
    else sm.color.setRGB(0.12, 0.08, 0.16);
    sm.opacity = (this.dark ? 0.16 : 0.2) * (1 - 0.55 * clamp01(height)) * (1 - 0.5 * v.haze) * formed;
  }
}
