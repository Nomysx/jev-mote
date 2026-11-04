// Each Mote's voice, derived from its permanent temperament (and seed), so no two sound alike.
// Pure: no Web Audio here, so it can be unit-tested.

import { clamp, mulberry32 } from '../../../shared/math';
import type { Archetype, Temperament } from '../../../shared/types';

export interface Voice {
  /** Base pitch in Hz. */
  base: number;
  wave: 'sine' | 'triangle';
  /** FM modulator ratio and depth: the voice's timbre. */
  fmRatio: number;
  fmIndex: number;
  /** Filter brightness multiplier. */
  brightness: number;
  vibratoRate: number;
  /** Vibrato depth in cents. */
  vibratoDepth: number;
  /** 0..1, how breathy it is. */
  breath: number;
  /** > 1 speaks faster. */
  tempo: number;
}

/** The parts of the mood that color the voice. */
export interface MoodTone {
  valence: number;
  arousal: number;
  trust: number;
  clarity: number;
}

export const NEUTRAL_TONE: MoodTone = { valence: 0, arousal: 0.3, trust: 0.3, clarity: 0.8 };

const ARCHETYPE_PITCH: Record<Archetype, number> = { anxious: 330, cheerful: 292, moody: 205, stoic: 165, curious: 250 };
const ARCHETYPE_BRIGHTNESS: Record<Archetype, number> = { anxious: 1.05, cheerful: 1.2, moody: 0.8, stoic: 0.85, curious: 1.05 };
const FM_RATIOS = [1, 1.5, 2, 3, 0.5];

export function voiceFromTemperament(t: Temperament): Voice {
  const rnd = mulberry32((t.seed ^ 0x51f15e) >>> 0);
  return {
    // About +/- 2.4 semitones around the archetype's register.
    base: ARCHETYPE_PITCH[t.archetype] * Math.pow(2, (rnd() - 0.5) * 0.4),
    wave: t.archetype === 'stoic' || t.archetype === 'moody' ? 'sine' : 'triangle',
    fmRatio: FM_RATIOS[Math.floor(rnd() * FM_RATIOS.length)],
    fmIndex: 0.1 + t.lumpiness * 0.8 * (0.5 + rnd() * 0.5),
    brightness: ARCHETYPE_BRIGHTNESS[t.archetype] * (0.85 + rnd() * 0.3),
    vibratoRate: 4 + rnd() * 3,
    vibratoDepth: 6 + t.volatility * 26,
    breath: 0.1 + t.lumpiness * 0.5,
    tempo: 0.85 + t.volatility * 0.4,
  };
}

/** Pitch multiplier for the mood: up to 1.5 semitones higher when happy, lower when low. */
export function moodPitch(m: MoodTone): number {
  return Math.pow(2, (clamp(m.valence, -1, 1) * 1.5) / 12);
}

/** Duration multiplier: livelier moods and voices speak faster. */
export function moodTempo(v: Voice, m: MoodTone): number {
  return 1 / (v.tempo * (0.85 + 0.3 * clamp(m.arousal)));
}
