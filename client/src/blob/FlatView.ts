// A simple 2D Mote for computers where 3D (WebGL) can't start, for example with a blocked graphics
// driver. Same interface as BlobView, so everything else (thoughts, sleep, dreams, the journal) keeps
// working: a soft, breathing blob in Mote's colors that swells when it reacts and sinks when it's sad.

import { hueDelta } from '../../../shared/math';
import type { Emotion } from '../../../shared/types';
import { DEFAULT_VISUAL, HUE_KEYS, VISUAL_KEYS, type VisualParams } from '../../../shared/visuals';
import type { BlobEvent, ReactionOptions } from './BlobView';
import { BEHAVIOR_DURATION, type BehaviorFrame, type BehaviorKind, type GestureKind } from './gestures';

export class FlatView {
  readonly canvas: HTMLCanvasElement;
  onFrame: ((v: VisualParams) => void) | null = null;
  onEvent: ((e: BlobEvent) => void) | null = null;
  private ctx: CanvasRenderingContext2D;
  private current: VisualParams = { ...DEFAULT_VISUAL };
  private target: VisualParams = { ...DEFAULT_VISUAL };
  private override: VisualParams | null = null;
  private bump = 0;
  private sleepOn = false;
  private dimOn = false;
  private listen = false;
  private behavior: { kind: BehaviorKind; until: number } | null = null;
  private last = performance.now();
  private t = 0;
  private center = { x: 0, y: 0, r: 0 };

  constructor(private container: HTMLElement, _seed: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'blob-canvas';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.canvas.addEventListener('pointerdown', (e) => {
      const d = Math.hypot(e.clientX - this.center.x, e.clientY - this.center.y);
      if (d > this.center.r) return;
      this.bump = Math.max(this.bump, 0.5);
      this.onEvent?.({ type: 'poke', strength: 1, pan: (e.clientX - this.center.x) / Math.max(1, this.center.r), asleep: this.sleepOn });
    });
    requestAnimationFrame(this.frame);
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round((this.container.clientWidth || window.innerWidth) * dpr);
    this.canvas.height = Math.round((this.container.clientHeight || window.innerHeight) * dpr);
  }

  setTarget(v: VisualParams, opts: { immediate?: boolean; tau?: number; holdMs?: number } = {}) {
    this.target = { ...v };
    if (opts.immediate) this.current = { ...v };
  }
  getTarget(): VisualParams {
    return { ...this.target };
  }
  getCurrent(): VisualParams {
    return { ...this.current };
  }
  setOverride(v: VisualParams | null) {
    this.override = v ? { ...v } : null;
  }
  setListening(on: boolean) {
    this.listen = on;
  }
  setDim(on: boolean) {
    this.dimOn = on;
  }
  setSleep(asleep: boolean, _dreaming = false) {
    this.sleepOn = asleep;
  }
  get asleep(): boolean {
    return this.sleepOn;
  }
  setDreamMotion(_fn: (() => BehaviorFrame) | null) {}
  pulse() {
    this.bump = 1;
  }
  react(_emotion: Emotion, o: ReactionOptions) {
    this.bump = Math.max(this.bump, 0.4 + 0.5 * (o.intensity ?? 0.5));
  }
  soothe() {}
  puzzled() {
    this.bump = Math.max(this.bump, 0.3);
  }
  gesture(_kind: GestureKind, amount = 1) {
    this.bump = Math.max(this.bump, 0.3 * amount);
  }
  behave(kind: BehaviorKind, seconds = BEHAVIOR_DURATION[kind]) {
    this.behavior = { kind, until: this.t + seconds };
  }
  cancelBehavior() {
    this.behavior = null;
  }
  get behaving(): BehaviorKind | null {
    return this.behavior && this.t < this.behavior.until ? this.behavior.kind : null;
  }
  getScreenAnchor() {
    return { ...this.center };
  }
  notifyTyping() {}
  absorb(_x: number, _y: number): Promise<void> {
    return new Promise((resolve) =>
      setTimeout(() => {
        this.bump = Math.max(this.bump, 0.4);
        this.onEvent?.({ type: 'absorb' });
        resolve();
      }, 600),
    );
  }
  wake(_before: VisualParams, after: VisualParams) {
    this.setTarget(after);
    this.onEvent?.({ type: 'wake' });
  }
  playBirth(): Promise<void> {
    this.onEvent?.({ type: 'birth-start' });
    return new Promise((resolve) =>
      setTimeout(() => {
        this.bump = 1;
        this.onEvent?.({ type: 'birth-pop' });
        resolve();
      }, 1500),
    );
  }
  dispose() {}

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const target = this.override ?? this.target;
    const k = 1 - Math.exp(-dt / 0.8);
    for (const key of VISUAL_KEYS) {
      if (HUE_KEYS.includes(key)) this.current[key] = (((this.current[key] + hueDelta(this.current[key], target[key]) * k) % 1) + 1) % 1;
      else this.current[key] += (target[key] - this.current[key]) * k;
    }
    this.bump *= Math.exp(-dt / 0.5);
    const v = this.current;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = W / Math.max(1, this.canvas.clientWidth || W);
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    const breath = 1 + (0.02 + 0.03 * v.breathe) * Math.sin(this.t * (0.8 + 0.8 * v.speed) * (this.sleepOn ? 0.5 : 1));
    const r = Math.min(W, H) * 0.2 * v.scale * breath * (1 + 0.08 * this.bump);
    const x = W / 2;
    const y = H * 0.45 + (v.sink * 0.12 + (this.sleepOn ? 0.05 : 0)) * H;
    const light = Math.max(18, Math.min(78, 34 + 22 * v.brightness - (this.dimOn ? 15 : 0) - (this.sleepOn ? 10 : 0)));
    const sat = Math.round(v.saturation * 75 * (1 - v.grey));
    const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, `hsl(${Math.round(v.hueA * 360)} ${sat}% ${Math.min(92, light + 22)}%)`);
    g.addColorStop(0.7, `hsl(${Math.round(v.hueA * 360)} ${sat}% ${light}%)`);
    g.addColorStop(1, `hsl(${Math.round((v.split > 0.3 ? v.hueB : v.hueA) * 360)} ${sat}% ${Math.max(10, light - 12)}%)`);
    c.shadowColor = `hsl(${Math.round(v.hueA * 360)} ${sat}% 60% / ${this.listen ? 0.7 : 0.45})`;
    c.shadowBlur = r * 0.5;
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(x, y, r * (1 + 0.04 * Math.sin(this.t * 1.3)), r * (1 - 0.05 * v.droop), 0, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
    this.center = { x: x / dpr, y: y / dpr, r: r / dpr };
    this.onFrame?.(v);
  };
}
