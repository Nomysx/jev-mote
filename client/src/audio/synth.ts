// Mote's sounds, synthesized live with the Web Audio API: no audio files, nothing downloaded.
// Every recipe is played in the Mote's own voice (see voice.ts), colored by its current mood.
// Works with a live AudioContext or an OfflineAudioContext (used to render previews and in tests).

import { clamp } from '../../../shared/math';
import type { Emotion } from '../../../shared/types';
import { moodPitch, moodTempo, type MoodTone, type Voice } from './voice';

export type SoundKind = Emotion | 'pulse' | 'absorb' | 'poke' | 'birth' | 'pop' | 'wake' | 'soothe' | 'puzzled' | 'thought' | 'decide' | 'hum' | 'snore' | 'hmph';

export const SOUND_KINDS: SoundKind[] = [
  'joy',
  'sadness',
  'anger',
  'fear',
  'calm',
  'curiosity',
  'disgust',
  'pulse',
  'absorb',
  'poke',
  'birth',
  'pop',
  'wake',
  'soothe',
  'puzzled',
  'thought',
  'decide',
  'hum',
  'snore',
  'hmph',
];

export interface SoundOptions {
  /** 0..1, how strong the feeling was: louder and fuller. */
  intensity?: number;
  /** Second emotion of a mixed reaction: both are voiced, the second a little later and softer. */
  second?: Emotion;
  /** 0..1, how evenly mixed the reaction was. */
  mixed?: number;
  /** 0..1, how clear-cut it was. Unclear reactions sound muffled, wavery and far away. */
  clarity?: number;
  /** -1..1 stereo position. */
  pan?: number;
  /** Small pitch variation, so repeated sounds (pokes) are never identical. */
  variant?: number;
}

/** The output chain: soft compression and a small, warm room. */
export interface Chain {
  dry: AudioNode;
  wet: AudioNode;
  master: GainNode;
}

interface Ctx {
  ctx: BaseAudioContext;
  out: AudioNode;
  t0: number;
  noise: AudioBuffer;
  /** 0..1, adds random detune for unclear reactions. */
  unsure: number;
}

/** Voice + mood, resolved to numbers for one sound. */
interface V {
  /** Pitch (Hz). */
  P: number;
  /** Brightness multiplier for filters. */
  B: number;
  /** Duration multiplier. */
  K: number;
  /** Gain multiplier. */
  g: number;
  wave: OscillatorType;
  fm: { ratio: number; index: number };
  vib: { rate: number; depth: number };
  breath: number;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

/** A soft, generated room reverb (decaying, slightly darkened noise). */
function impulse(ctx: BaseAudioContext, seconds = 1.8, decay = 3.2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = last * 0.55 + (Math.random() * 2 - 1) * 0.45;
      d[i] = last * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

export function createChain(ctx: BaseAudioContext, destination: AudioNode, volume = 0.7): Chain {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  const soft = ctx.createBiquadFilter();
  soft.type = 'lowpass';
  soft.frequency.value = 9000;
  const master = ctx.createGain();
  master.gain.value = volume;
  const dry = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.buffer = impulse(ctx);
  const wetGain = ctx.createGain();
  wetGain.gain.value = 0.9;
  dry.connect(comp);
  conv.connect(wetGain).connect(comp);
  comp.connect(soft).connect(master).connect(destination);
  return { dry, wet: conv, master };
}

// ---- building blocks ----

interface ToneSpec {
  /** Start, in seconds after the sound begins. */
  at: number;
  dur: number;
  /** Pitch curve: [seconds after start, Hz] points joined by exponential glides. */
  freq: [number, number][];
  type?: OscillatorType;
  gain: number;
  attack?: number;
  release?: number;
  fm?: { ratio: number; index: number };
  /** Depth in cents. */
  vibrato?: { rate: number; depth: number };
  /** Depth 0..1. */
  tremolo?: { rate: number; depth: number };
  filter?: { type: BiquadFilterType; freq: number; q?: number; to?: number };
  pan?: number;
  detune?: number;
}

interface NoiseSpec {
  at: number;
  dur: number;
  gain: number;
  filter: { type: BiquadFilterType; freq: number; q?: number; to?: number };
  attack?: number;
  release?: number;
  pan?: number;
}

function curve(param: AudioParam, points: [number, number][], t: number, scale = 1) {
  param.setValueAtTime(Math.max(0.0001, points[0][1] * scale), t + points[0][0]);
  for (let i = 1; i < points.length; i++) param.exponentialRampToValueAtTime(Math.max(0.0001, points[i][1] * scale), t + points[i][0]);
}

function envelope(g: GainNode, t: number, peak: number, attack: number, dur: number, release: number) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.setTargetAtTime(peak * 0.7, t + attack, Math.max(0.01, dur * 0.4));
  g.gain.setTargetAtTime(0, t + Math.max(attack, dur), Math.max(0.005, release / 4));
}

function lfo(ctx: BaseAudioContext, rate: number, depth: number, target: AudioParam, t: number, end: number) {
  const o = ctx.createOscillator();
  o.frequency.value = rate;
  const g = ctx.createGain();
  g.gain.value = depth;
  o.connect(g).connect(target);
  o.start(t);
  o.stop(end);
}

function tone(c: Ctx, s: ToneSpec) {
  const { ctx } = c;
  const t = c.t0 + s.at;
  const rel = s.release ?? 0.08;
  const end = t + s.dur + rel * 1.6 + 0.05;
  const osc = ctx.createOscillator();
  osc.type = s.type ?? 'sine';
  curve(osc.frequency, s.freq, t);
  osc.detune.value = (s.detune ?? 0) + (c.unsure > 0 ? (Math.random() * 2 - 1) * 30 * c.unsure : 0);
  if (s.fm && s.fm.index > 0.01) {
    const mod = ctx.createOscillator();
    curve(mod.frequency, s.freq, t, s.fm.ratio);
    const depth = ctx.createGain();
    curve(depth.gain, s.freq, t, s.fm.index);
    mod.connect(depth).connect(osc.frequency);
    mod.start(t);
    mod.stop(end);
  }
  if (s.vibrato) lfo(ctx, s.vibrato.rate, s.vibrato.depth, osc.detune, t, end);
  if (c.unsure > 0.2) lfo(ctx, 2.3, 18 * c.unsure, osc.detune, t, end); // a slow, uncertain waver
  let node: AudioNode = osc;
  if (s.filter) {
    const f = ctx.createBiquadFilter();
    f.type = s.filter.type;
    f.Q.value = s.filter.q ?? 0.7;
    f.frequency.setValueAtTime(s.filter.freq, t);
    if (s.filter.to) f.frequency.exponentialRampToValueAtTime(s.filter.to, t + s.dur);
    node.connect(f);
    node = f;
  }
  if (s.tremolo) {
    const trem = ctx.createGain();
    trem.gain.value = 1 - s.tremolo.depth / 2;
    lfo(ctx, s.tremolo.rate, s.tremolo.depth / 2, trem.gain, t, end);
    node.connect(trem);
    node = trem;
  }
  const g = ctx.createGain();
  envelope(g, t, s.gain, s.attack ?? 0.01, s.dur, rel);
  node.connect(g);
  let tail: AudioNode = g;
  if (s.pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(s.pan, -1, 1);
    g.connect(p);
    tail = p;
  }
  tail.connect(c.out);
  osc.start(t);
  osc.stop(end);
}

function noise(c: Ctx, s: NoiseSpec) {
  const { ctx } = c;
  const t = c.t0 + s.at;
  const rel = s.release ?? 0.08;
  const src = ctx.createBufferSource();
  src.buffer = c.noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = s.filter.type;
  f.Q.value = s.filter.q ?? 0.7;
  f.frequency.setValueAtTime(s.filter.freq, t);
  if (s.filter.to) f.frequency.exponentialRampToValueAtTime(s.filter.to, t + s.dur);
  const g = ctx.createGain();
  envelope(g, t, s.gain, s.attack ?? 0.01, s.dur, rel);
  src.connect(f).connect(g);
  let tail: AudioNode = g;
  if (s.pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(s.pan, -1, 1);
    g.connect(p);
    tail = p;
  }
  tail.connect(c.out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + s.dur + rel * 1.6 + 0.05);
}

// ---- recipes ----

type Recipe = (c: Ctx, v: V, o: SoundOptions) => number;

const RECIPES: Record<SoundKind, Recipe> = {
  /** A bright, bouncy little arpeggio with a sparkle on top. */
  joy(c, v, o) {
    const notes = (o.intensity ?? 0.5) > 0.6 ? [1, 1.25, 1.5, 2] : [1, 1.25, 1.5];
    const step = 0.075 * v.K;
    notes.forEach((r, i) => {
      const last = i === notes.length - 1;
      tone(c, {
        at: i * step,
        dur: (last ? 0.2 : 0.09) * v.K,
        freq: [
          [0, v.P * r],
          [0.03, v.P * r * 1.02],
        ],
        type: v.wave,
        gain: 0.2 * v.g * (0.85 + i * 0.08),
        attack: 0.006,
        release: 0.12,
        fm: { ratio: v.fm.ratio, index: v.fm.index * 0.6 },
        filter: { type: 'lowpass', freq: 2600 * v.B },
        vibrato: last ? v.vib : undefined,
        pan: (i - 1) * 0.15,
      });
    });
    for (let i = 0; i < 3; i++) {
      tone(c, { at: (0.05 + i * 0.07) * v.K, dur: 0.05, freq: [[0, v.P * 4 * (1 + i * 0.12)]], gain: 0.035 * v.g, attack: 0.003, release: 0.15, pan: (i - 1) * 0.45 });
    }
    return notes.length * step + 0.45;
  },

  /** A sigh, then a slow falling "aww" with a trembling vibrato. */
  sadness(c, v) {
    noise(c, { at: 0, dur: 0.55 * v.K, gain: 0.05 * v.g * (0.5 + v.breath), filter: { type: 'bandpass', freq: 1300, q: 0.8, to: 500 }, attack: 0.12, release: 0.3 });
    tone(c, {
      at: 0.1,
      dur: 1.05 * v.K,
      freq: [
        [0, v.P * 0.95],
        [1.0 * v.K, v.P * 0.71],
      ],
      gain: 0.24 * v.g,
      attack: 0.12,
      release: 0.4,
      vibrato: { rate: 5, depth: 16 + v.vib.depth * 0.5 },
      filter: { type: 'lowpass', freq: 1000 * v.B, to: 600 * v.B },
    });
    tone(c, {
      at: 1.05 * v.K,
      dur: 0.45 * v.K,
      freq: [
        [0, v.P * 0.67],
        [0.4 * v.K, v.P * 0.6],
      ],
      gain: 0.1 * v.g,
      attack: 0.08,
      release: 0.4,
      filter: { type: 'lowpass', freq: 700 * v.B },
    });
    return 2.1 * v.K;
  },

  /** A huff and a low, rough growl. Grumpy, not harsh. */
  anger(c, v) {
    noise(c, { at: 0, dur: 0.16, gain: 0.07 * v.g, filter: { type: 'bandpass', freq: 1400, q: 1.2 }, attack: 0.01, release: 0.1 });
    for (const det of [-14, 14]) {
      tone(c, {
        at: 0.04,
        dur: 0.48 * v.K,
        freq: [
          [0, v.P * 0.5],
          [0.12, v.P * 0.56],
          [0.45 * v.K, v.P * 0.44],
        ],
        type: 'sawtooth',
        gain: 0.1 * v.g,
        attack: 0.02,
        release: 0.15,
        detune: det,
        tremolo: { rate: 23, depth: 0.55 },
        filter: { type: 'lowpass', freq: 520 * v.B, q: 4, to: 1400 * v.B },
      });
    }
    tone(c, { at: 0.04, dur: 0.5 * v.K, freq: [[0, v.P * 0.25]], gain: 0.12 * v.g, attack: 0.03, release: 0.2 });
    return 0.85 * v.K;
  },

  /** A quick gasp and a high, trembling whimper. */
  fear(c, v) {
    noise(c, { at: 0, dur: 0.15, gain: 0.05 * v.g, filter: { type: 'bandpass', freq: 2400, q: 1.5, to: 4200 }, attack: 0.02, release: 0.06 });
    tone(c, {
      at: 0.12,
      dur: 0.32 * v.K,
      freq: [
        [0, v.P * 1.9],
        [0.25 * v.K, v.P * 2.2],
      ],
      gain: 0.15 * v.g,
      attack: 0.02,
      release: 0.1,
      tremolo: { rate: 14, depth: 0.7 },
      filter: { type: 'lowpass', freq: 3200 * v.B },
    });
    tone(c, {
      at: 0.5 * v.K,
      dur: 0.2 * v.K,
      freq: [
        [0, v.P * 2.0],
        [0.18 * v.K, v.P * 1.75],
      ],
      gain: 0.08 * v.g,
      attack: 0.02,
      release: 0.1,
      tremolo: { rate: 16, depth: 0.6 },
    });
    return 0.95 * v.K;
  },

  /** A soft, slow hum on an open fifth, with an exhale. */
  calm(c, v) {
    const root = v.P * 0.75;
    for (const [mul, gain, det] of [
      [1, 0.13, -5],
      [1, 0.13, 5],
      [1.5, 0.06, 3],
    ]) {
      tone(c, { at: 0, dur: 1.5 * v.K, freq: [[0, root * mul]], gain: gain * v.g, attack: 0.4, release: 0.9, detune: det, vibrato: { rate: 3, depth: 4 }, filter: { type: 'lowpass', freq: 1200 * v.B } });
    }
    noise(c, { at: 0.2, dur: 1.2 * v.K, gain: 0.018 * v.g * (0.5 + v.breath), filter: { type: 'lowpass', freq: 700 }, attack: 0.5, release: 0.6 });
    return 2.7 * v.K;
  },

  /** A questioning "hm?" that rises at the end, and a little blip of interest. */
  curiosity(c, v) {
    tone(c, {
      at: 0,
      dur: 0.42 * v.K,
      freq: [
        [0, v.P],
        [0.2 * v.K, v.P * 1.02],
        [0.4 * v.K, v.P * 1.42],
      ],
      type: v.wave,
      gain: 0.2 * v.g,
      attack: 0.02,
      release: 0.12,
      fm: { ratio: v.fm.ratio, index: v.fm.index * 0.8 },
      filter: { type: 'lowpass', freq: 2200 * v.B },
      vibrato: v.vib,
    });
    tone(c, { at: 0.5 * v.K, dur: 0.07, freq: [[0, v.P * 1.9]], gain: 0.07 * v.g, attack: 0.004, release: 0.12, pan: 0.25 });
    return 0.85 * v.K;
  },

  /** A nasal, falling "bleh" and a soft "pff". */
  disgust(c, v) {
    // The narrow "nasal" band-pass removes most of the sawtooth's energy, so these gains are higher.
    for (const [ff, q, gg] of [
      [1100, 5, 0.75],
      [2500, 6, 0.28],
    ]) {
      tone(c, {
        at: 0,
        dur: 0.36 * v.K,
        freq: [
          [0, v.P * 0.85],
          [0.34 * v.K, v.P * 0.6],
        ],
        type: 'sawtooth',
        gain: gg * v.g,
        attack: 0.02,
        release: 0.1,
        filter: { type: 'bandpass', freq: ff * Math.min(1.2, v.B), q },
      });
    }
    noise(c, { at: 0.3 * v.K, dur: 0.1, gain: 0.06 * v.g, filter: { type: 'bandpass', freq: 3000, q: 0.9 }, attack: 0.005, release: 0.08 });
    return 0.65 * v.K;
  },

  /** Surprise: a bubbly double "bloop". */
  pulse(c, v) {
    tone(c, {
      at: 0,
      dur: 0.13,
      freq: [
        [0, v.P * 3.6],
        [0.12, v.P * 1.3],
      ],
      gain: 0.2 * v.g,
      attack: 0.004,
      release: 0.08,
    });
    tone(c, {
      at: 0.09,
      dur: 0.12,
      freq: [
        [0, v.P * 2.6],
        [0.11, v.P * 1.1],
      ],
      gain: 0.1 * v.g,
      attack: 0.004,
      release: 0.08,
    });
    return 0.45;
  },

  /** An entry arrives: a small gulp. */
  absorb(c, v) {
    tone(c, {
      at: 0,
      dur: 0.2,
      freq: [
        [0, v.P * 1.3],
        [0.18, v.P * 0.78],
      ],
      gain: 0.17 * v.g,
      attack: 0.01,
      release: 0.08,
      filter: { type: 'lowpass', freq: 1500 * v.B },
    });
    tone(c, { at: 0.13, dur: 0.05, freq: [[0, v.P * 2.4]], gain: 0.05 * v.g, attack: 0.003, release: 0.06 });
    noise(c, { at: 0, dur: 0.12, gain: 0.02 * v.g, filter: { type: 'lowpass', freq: 900 }, attack: 0.01, release: 0.05 });
    return 0.4;
  },

  /** Poked: a squishy "boing". */
  poke(c, v, o) {
    const f = v.P * 1.6 * (o.variant ?? 1);
    tone(c, {
      at: 0,
      dur: 0.42,
      freq: [
        [0, f],
        [0.12, f * 0.66],
        [0.4, f * 0.7],
      ],
      type: v.wave,
      gain: 0.18 * v.g,
      attack: 0.004,
      release: 0.15,
      vibrato: { rate: 11, depth: 45 },
      fm: { ratio: v.fm.ratio, index: v.fm.index * 0.5 },
      filter: { type: 'lowpass', freq: 2400 * v.B },
      pan: o.pan,
    });
    noise(c, { at: 0, dur: 0.06, gain: 0.08 * v.g, filter: { type: 'lowpass', freq: 380 }, attack: 0.002, release: 0.05, pan: o.pan });
    return 0.65;
  },

  /** Birth: a rising, shimmering pentatonic sparkle as the mist gathers. */
  birth(c, v) {
    const scale = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4, 5 / 2, 3];
    let at = 0;
    for (let i = 0; i < 12; i++) {
      const r = scale[Math.min(scale.length - 1, Math.floor(i * 0.75))];
      tone(c, { at, dur: 0.12, freq: [[0, v.P * r]], gain: (0.05 + (0.04 * i) / 12) * v.g, attack: 0.01, release: 0.7, pan: Math.sin(i * 1.7) * 0.6 });
      at += 0.32 - i * 0.018;
    }
    noise(c, { at: 0, dur: 3.0, gain: 0.012 * v.g, filter: { type: 'highpass', freq: 5000 }, attack: 1.5, release: 0.8 });
    return at + 1.2;
  },

  /** The moment it takes shape: a pop and a first little chirp. */
  pop(c, v) {
    tone(c, {
      at: 0,
      dur: 0.12,
      freq: [
        [0, v.P * 0.6],
        [0.1, v.P * 2.0],
      ],
      gain: 0.18 * v.g,
      attack: 0.004,
      release: 0.1,
    });
    noise(c, { at: 0, dur: 0.07, gain: 0.07 * v.g, filter: { type: 'lowpass', freq: 2200 }, attack: 0.002, release: 0.05 });
    tone(c, {
      at: 0.14,
      dur: 0.12,
      freq: [
        [0, v.P * 1.5],
        [0.1, v.P * 2.0],
      ],
      type: v.wave,
      gain: 0.12 * v.g,
      attack: 0.006,
      release: 0.15,
      vibrato: v.vib,
    });
    return 0.55;
  },

  /** Waking up: a breathy yawn that rises and falls, then a sleepy "mm". */
  wake(c, v) {
    noise(c, { at: 0, dur: 1.2, gain: 0.035 * v.g * (0.5 + v.breath), filter: { type: 'bandpass', freq: 700, q: 0.7, to: 400 }, attack: 0.3, release: 0.4 });
    tone(c, {
      at: 0.1,
      dur: 1.4 * v.K,
      freq: [
        [0, v.P * 0.7],
        [0.55 * v.K, v.P * 1.05],
        [1.35 * v.K, v.P * 0.6],
      ],
      gain: 0.17 * v.g,
      attack: 0.25,
      release: 0.4,
      vibrato: { rate: 4, depth: 10 },
      filter: { type: 'lowpass', freq: 900 * v.B },
    });
    tone(c, {
      at: 1.6 * v.K,
      dur: 0.25,
      freq: [
        [0, v.P * 0.9],
        [0.2, v.P * 0.95],
      ],
      type: v.wave,
      gain: 0.07 * v.g,
      attack: 0.03,
      release: 0.15,
    });
    return 2.3 * v.K;
  },

  /** Distress safeguard: a slow, warm, quiet chord. Gentle, never alarming. */
  soothe(c, v) {
    const root = v.P * 0.5;
    [1, 5 / 4, 3 / 2, 2].forEach((m, i) => {
      tone(c, { at: i * 0.12, dur: 2.6, freq: [[0, root * m]], gain: 0.06 * v.g, attack: 0.9, release: 1.6, detune: i % 2 ? 4 : -4, vibrato: { rate: 3.5, depth: 4 }, filter: { type: 'lowpass', freq: 1100 } });
    });
    return 4.6;
  },

  /** Couldn't read it: "hm? hm?". */
  puzzled(c, v) {
    tone(c, {
      at: 0,
      dur: 0.3 * v.K,
      freq: [
        [0, v.P * 1.1],
        [0.28 * v.K, v.P * 0.95],
      ],
      type: v.wave,
      gain: 0.12 * v.g,
      attack: 0.02,
      release: 0.1,
      filter: { type: 'lowpass', freq: 1800 * v.B },
    });
    tone(c, {
      at: 0.38 * v.K,
      dur: 0.3 * v.K,
      freq: [
        [0, v.P * 0.95],
        [0.28 * v.K, v.P * 1.25],
      ],
      type: v.wave,
      gain: 0.12 * v.g,
      attack: 0.02,
      release: 0.1,
      filter: { type: 'lowpass', freq: 1800 * v.B },
    });
    return 0.95 * v.K;
  },

  /** Thoughts surfacing: a soft, glassy shimmer. */
  thought(c: Ctx, v: V) {
    [1, 1.25, 1.5].forEach((r, i) => {
      tone(c, { at: i * 0.09, dur: 0.05, freq: [[0, v.P * 3 * r]], gain: 0.03 * v.g, attack: 0.004, release: 0.3, pan: (i - 1) * 0.4 });
    });
    return 0.7;
  },

  /** A decision clicking into place: two soft notes, a fourth apart. */
  decide(c: Ctx, v: V) {
    tone(c, { at: 0, dur: 0.06, freq: [[0, v.P * 1.5]], type: 'triangle', gain: 0.09 * v.g, attack: 0.004, release: 0.12 });
    tone(c, { at: 0.09, dur: 0.12, freq: [[0, v.P * 2]], type: 'triangle', gain: 0.11 * v.g, attack: 0.004, release: 0.35, fm: { ratio: v.fm.ratio, index: v.fm.index * 0.3 } });
    noise(c, { at: 0, dur: 0.02, gain: 0.03 * v.g, filter: { type: 'highpass', freq: 3000 }, attack: 0.001, release: 0.02 });
    return 0.7;
  },

  /** Humming to itself: a short pentatonic tune in its own voice (varies each time). */
  hum(c: Ctx, v: V, o: SoundOptions) {
    const scale = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2];
    let seed = Math.floor((o.variant ?? Math.random()) * 1e6) || 1;
    const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let at = 0;
    let idx = 2;
    for (let i = 0; i < 6; i++) {
      idx = Math.max(0, Math.min(scale.length - 1, idx + Math.round((next() - 0.5) * 3)));
      const len = (i === 5 ? 0.42 : 0.2 + next() * 0.12) * v.K;
      tone(c, { at, dur: len, freq: [[0, v.P * 0.75 * scale[idx]]], type: v.wave, gain: 0.07 * v.g, attack: 0.04, release: 0.18, vibrato: { rate: v.vib.rate, depth: v.vib.depth * 0.5 }, filter: { type: 'lowpass', freq: 1600 * v.B } });
      at += len * 0.92;
    }
    return at + 0.5;
  },

  /** Dozing: one slow breath in and out, with a low hum. */
  snore(c: Ctx, v: V) {
    noise(c, { at: 0, dur: 1.1, gain: 0.03 * v.g, filter: { type: 'lowpass', freq: 500, to: 750 }, attack: 0.5, release: 0.3 });
    noise(c, { at: 1.2, dur: 1.3, gain: 0.025 * v.g, filter: { type: 'lowpass', freq: 450, to: 300 }, attack: 0.2, release: 0.5 });
    tone(c, { at: 1.25, dur: 1.1, freq: [[0, v.P * 0.3]], gain: 0.04 * v.g, attack: 0.3, release: 0.5 });
    return 3;
  },

  /** Sulking: a little "hmph". */
  hmph(c: Ctx, v: V) {
    noise(c, { at: 0, dur: 0.12, gain: 0.05 * v.g, filter: { type: 'bandpass', freq: 900, q: 1 }, attack: 0.005, release: 0.06 });
    tone(c, {
      at: 0.03,
      dur: 0.2,
      freq: [
        [0, v.P * 0.9],
        [0.18, v.P * 0.7],
      ],
      type: 'sawtooth',
      gain: 0.08 * v.g,
      attack: 0.01,
      release: 0.08,
      filter: { type: 'lowpass', freq: 900 * v.B },
    });
    return 0.5;
  },
};



const EMOTION_KINDS = new Set<SoundKind>(['joy', 'sadness', 'anger', 'fear', 'calm', 'curiosity', 'disgust']);

/**
 * Plays one sound at `when` (seconds, on the context's clock) and returns its length in seconds.
 * A mixed reaction voices both emotions; an unclear one sounds muffled, wavery and farther away.
 */
export function playSound(ctx: BaseAudioContext, chain: Chain, kind: SoundKind, voice: Voice, mood: MoodTone, o: SoundOptions = {}, when = ctx.currentTime): number {
  const clarity = clamp(o.clarity ?? mood.clarity);
  const intensity = clamp(o.intensity ?? 0.6);
  const out = ctx.createGain();
  out.connect(chain.dry);
  const send = ctx.createGain();
  send.gain.value = 0.2 + 0.45 * (1 - clarity);
  out.connect(send);
  send.connect(chain.wet);
  const v: V = {
    P: voice.base * moodPitch(mood),
    B: voice.brightness * (0.5 + 0.5 * clarity),
    K: moodTempo(voice, mood),
    g: (EMOTION_KINDS.has(kind) ? 0.6 + 0.5 * intensity : 0.85) * (0.85 + 0.25 * clamp(mood.trust)),
    wave: voice.wave,
    fm: { ratio: voice.fmRatio, index: voice.fmIndex },
    vib: { rate: voice.vibratoRate, depth: voice.vibratoDepth },
    breath: voice.breath,
  };
  const c: Ctx = { ctx, out, t0: when, noise: noiseBuffer(ctx), unsure: clamp((0.4 - clarity) / 0.4) };
  const mixedSecond = o.second && o.second !== kind && EMOTION_KINDS.has(kind) && (o.mixed ?? 0) > 0.35;
  if (!mixedSecond) return RECIPES[kind](c, v, o);
  const first = RECIPES[kind](c, { ...v, g: v.g * 0.8 }, o);
  const delay = 0.18 * v.K;
  const second = RECIPES[o.second!]({ ...c, t0: when + delay }, { ...v, g: v.g * 0.55 }, o);
  return Math.max(first, delay + second);
}

/** Renders a sequence of sounds offline into an AudioBuffer (previews, tests). */
export async function renderSounds(
  sequence: { kind: SoundKind; at: number; opts?: SoundOptions; mood?: MoodTone }[],
  voice: Voice,
  mood: MoodTone,
  seconds: number,
  sampleRate = 44100,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const chain = createChain(ctx, ctx.destination, 0.8);
  for (const s of sequence) playSound(ctx, chain, s.kind, voice, s.mood ?? mood, s.opts, s.at);
  return ctx.startRendering();
}

/** 16-bit PCM WAV bytes for an AudioBuffer. */
export function toWav(buf: AudioBuffer): Uint8Array {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const bytes = new Uint8Array(44 + len * ch * 2);
  const dv = new DataView(bytes.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  dv.setUint32(4, 36 + len * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, buf.sampleRate, true);
  dv.setUint32(28, buf.sampleRate * ch * 2, true);
  dv.setUint16(32, ch * 2, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, len * ch * 2, true);
  const data = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return bytes;
}
