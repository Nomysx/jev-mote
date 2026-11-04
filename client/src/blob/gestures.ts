// One-off body gestures: short, hand-shaped animation curves layered on top of the mood-driven look.
// Pure functions of time, so they are easy to tune and test. Every gesture returns to rest at its end.

import type { Emotion } from '../../../shared/types';

export type GestureKind = Emotion | 'poke' | 'absorb' | 'wake' | 'pop' | 'pulse' | 'soothe' | 'puzzled';

/** Additive offsets applied to the blob for one frame. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  /** > 0 stretches tall, < 0 squashes flat (volume-preserving). */
  squash: number;
  roll: number;
  pitch: number;
  yaw: number;
  /** Uniform scale offset (0 = unchanged). */
  scale: number;
  /** Extra spikes (anger flare). */
  spikes: number;
  /** Extra jelly wobble. */
  wobble: number;
}

export const restPose = (): Pose => ({ x: 0, y: 0, z: 0, squash: 0, roll: 0, pitch: 0, yaw: 0, scale: 0, spikes: 0, wobble: 0 });

export const GESTURE_DURATION: Record<GestureKind, number> = {
  joy: 1.4,
  anger: 1.5,
  sadness: 3.4,
  fear: 2.0,
  calm: 2.7,
  curiosity: 2.1,
  disgust: 1.9,
  poke: 1.1,
  absorb: 0.9,
  wake: 2.1,
  pop: 1.3,
  pulse: 1.0,
  soothe: 3.6,
  puzzled: 1.8,
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Rises smoothly from a to peak and falls back by b. */
const bump = (a: number, b: number, x: number) => Math.sin(Math.PI * clamp01((x - a) / (b - a)));
/** On between a-b, fading in quickly and out over [c, d]. */
const hold = (a: number, b: number, c: number, d: number, x: number) => smooth(a, b, x) * (1 - smooth(c, d, x));
const TAU = Math.PI * 2;

/**
 * The pose of one gesture `t` seconds after it started. `amount` (0..1+) scales it; `shake` (0..1)
 * scales fast oscillations separately, so reduced-motion users get calmer gestures.
 */
export function gesturePose(kind: GestureKind, t: number, amount = 1, shake = 1): Pose {
  const p = restPose();
  const dur = GESTURE_DURATION[kind];
  if (t < 0 || t >= dur) return p;
  const a = amount;
  switch (kind) {
    case 'joy': {
      // A quick crouch, two happy hops (stretching in the air, squashing on contact), then a jiggle.
      if (t < 0.12) {
        const c = smooth(0, 0.12, t);
        p.squash = -0.12 * c * a;
        p.y = -0.03 * c * a;
      } else if (t < 0.88) {
        const tt = t - 0.12;
        const h = 1 - 0.45 * smooth(0.3, 0.46, tt); // the second hop is lower
        const air = Math.abs(Math.sin((Math.PI * tt) / 0.38));
        p.y = (0.3 * air - 0.03 * Math.pow(1 - air, 3)) * h * a;
        p.squash = (0.12 * air - 0.12 * Math.pow(1 - air, 3)) * h * a;
      } else {
        const s = t - 0.88;
        const settle = Math.exp(-s * 6) * Math.cos(s * 20);
        p.squash = -0.12 * 0.55 * settle * a;
        p.y = -0.03 * 0.55 * settle * a;
      }
      p.scale = 0.04 * bump(0, 1.2, t) * a;
      p.roll = 0.05 * Math.sin(t * 9) * bump(0, 1.2, t) * a * shake;
      break;
    }
    case 'anger': {
      // A hot shudder: puffs up, flares spikes, shakes side to side.
      const env = smooth(0, 0.06, t) * Math.exp(-t * 3.0);
      p.x = 0.055 * Math.sin(TAU * 9 * t) * env * a * shake;
      p.spikes = 0.55 * smooth(0, 0.22, t) * Math.exp(-t * 1.8) * a;
      p.scale = 0.07 * env * a;
      p.squash = -0.05 * env * a;
      p.pitch = -0.06 * env * a;
      break;
    }
    case 'sadness': {
      // A sigh: a small breath in, then it deflates and slumps forward before slowly recovering.
      const slump = smooth(0.5, 1.4, t) * (1 - smooth(2.2, 3.4, t));
      p.scale = 0.05 * bump(0, 0.7, t) * a - 0.04 * slump * a;
      p.y = -0.14 * slump * a;
      p.squash = -0.1 * slump * a;
      p.pitch = 0.12 * slump * a;
      break;
    }
    case 'fear': {
      // A flinch: jumps back and shrinks at once, trembles, then creeps back.
      const f = smooth(0, 0.2, t) * (1 - smooth(0.45, 1.9, t));
      p.z = -0.55 * f * a;
      p.y = 0.05 * f * a;
      p.scale = -0.15 * f * a;
      p.x = 0.018 * Math.sin(TAU * 24 * t) * f * a * shake;
      break;
    }
    case 'calm': {
      // One slow, deep breath.
      const b = Math.pow(Math.sin(Math.PI * clamp01(t / 2.5)), 2);
      p.scale = 0.08 * b * a;
      p.y = 0.05 * b * a;
      p.squash = 0.03 * b * a;
      break;
    }
    case 'curiosity': {
      // Tilts its head and leans in to look closer.
      const g = hold(0, 0.45, 1.3, 2.05, t);
      p.roll = 0.28 * g * a;
      p.z = 0.28 * g * a;
      p.y = 0.05 * g * a;
      p.scale = 0.03 * g * a;
      break;
    }
    case 'disgust': {
      // Recoils and turns away with a little shudder.
      const r = hold(0, 0.18, 0.8, 1.85, t);
      p.z = -0.32 * r * a;
      p.yaw = 0.45 * r * a;
      p.roll = -0.12 * r * a;
      p.squash = -0.07 * r * a;
      p.x = (0.12 * r + 0.012 * Math.sin(TAU * 18 * t) * r * shake) * a;
      break;
    }
    case 'poke': {
      // Squishes where it was touched and springs back.
      const on = smooth(0, 0.05, t);
      p.squash = -0.1 * Math.exp(-t * 5) * Math.cos(t * 22) * on * a;
      p.scale = -0.03 * Math.exp(-t * 8) * on * a;
      p.wobble = 0.25 * Math.exp(-t * 3) * on * a;
      break;
    }
    case 'absorb': {
      // A gulp as the entry arrives.
      p.squash = (0.06 * bump(0, 0.3, t) - 0.04 * bump(0.3, 0.85, t)) * a;
      p.scale = 0.035 * bump(0, 0.35, t) * a;
      p.y = -0.03 * bump(0.1, 0.6, t) * a;
      break;
    }
    case 'wake': {
      // A long stretch upward, a little sway, then it settles.
      p.squash = (0.22 * bump(0.15, 1.1, t) - 0.07 * bump(1.1, 1.7, t)) * a;
      p.scale = 0.04 * bump(0.15, 1.1, t) * a;
      p.roll = 0.08 * Math.sin(t * 4) * bump(0.2, 1.9, t) * a * shake;
      p.y = 0.06 * bump(0.15, 1.1, t) * a;
      break;
    }
    case 'pop': {
      // The end of the birth: an elastic overshoot.
      p.scale = 0.2 * Math.exp(-t * 3.6) * Math.sin(t * 12) * a;
      p.squash = 0.06 * Math.exp(-t * 4) * Math.sin(t * 14) * a;
      break;
    }
    case 'pulse': {
      // A surprised jolt.
      p.scale = 0.1 * Math.exp(-t * 6) * Math.sin(t * 18) * a;
      p.y = 0.06 * bump(0, 0.35, t) * a;
      p.wobble = 0.2 * Math.exp(-t * 3.5) * smooth(0, 0.05, t) * a;
      break;
    }
    case 'soothe': {
      // Very slow, soft breathing: gentle, never startling.
      const b = Math.pow(Math.sin(Math.PI * clamp01(t / 3.4)), 2);
      p.scale = 0.05 * b * a;
      p.y = 0.03 * b * a;
      break;
    }
    case 'puzzled': {
      // Couldn't read it: a small tilt one way, then the other.
      const g = hold(0, 0.3, 1.1, 1.75, t);
      p.roll = 0.14 * Math.sin(t * 3.2) * g * a;
      p.z = 0.08 * g * a;
      break;
    }
  }
  // Fade every gesture out over its last 15% so removing it never causes a jump.
  const fade = 1 - smooth(dur * 0.85, dur, t);
  for (const k of Object.keys(p) as (keyof Pose)[]) p[k] *= fade;
  return p;
}

interface Active {
  kind: GestureKind;
  start: number;
  amount: number;
}

/** Sums all running gestures. Times are in seconds on any monotonic clock. */
export class GestureRig {
  private active: Active[] = [];
  /** 1 normally; lower for users who prefer reduced motion. */
  constructor(public motion = 1) {}

  play(kind: GestureKind, now: number, amount = 1, delay = 0) {
    this.active.push({ kind, start: now + delay, amount });
    if (this.active.length > 12) this.active.shift();
  }

  isPlaying(now: number): boolean {
    return this.active.some((g) => now - g.start < GESTURE_DURATION[g.kind]);
  }

  pose(now: number): Pose {
    const sum = restPose();
    this.active = this.active.filter((g) => now - g.start < GESTURE_DURATION[g.kind]);
    for (const g of this.active) {
      const p = gesturePose(g.kind, now - g.start, g.amount * this.motion, this.motion < 1 ? 0.2 : 1);
      for (const k of Object.keys(sum) as (keyof Pose)[]) sum[k] += p[k];
    }
    return sum;
  }
}
