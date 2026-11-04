// Maps the blob's mood (plus temperament) to the visual parameters that drive the shader.
// Used by the server (to snapshot each journal entry) and by the client (week strip, debug).

import { clamp, concentration, lerp, mixHueRgb, normalize, smoothstep, topTwo } from './math';
import { EMOTIONS, type Emotion, type EmotionDist, type MoodState, type Temperament } from './types';

export interface VisualParams {
  /** Main color zone hue, 0..1. */
  hueA: number;
  /** Second color zone hue, 0..1 (shown when emotions are mixed). */
  hueB: number;
  saturation: number;
  brightness: number;
  /** Valence as color temperature: -1 (cold) .. +1 (warm), mixed over the base color in RGB. */
  warmth: number;
  /** 0..1 strength of the two-zone color split (mixed emotions). */
  split: number;
  /** Movement speed multiplier. */
  speed: number;
  /** Movement amplitude. */
  amplitude: number;
  lumpiness: number;
  /** Anger: sharp spikes. */
  spikes: number;
  /** Sadness: droops and slows. */
  droop: number;
  /** Sadness: sinks lower. */
  sink: number;
  /** Fear: shrinks. */
  shrink: number;
  /** Fear: pulls away from the cursor. */
  avoid: number;
  /** Curiosity: leans toward the cursor. */
  lean: number;
  /** Joy: bouncy. */
  bounce: number;
  /** Joy: rounder surface. */
  roundness: number;
  /** Calm: slow, smooth breathing. */
  breathe: number;
  /** Disgust: pulls inward. */
  inward: number;
  /** Disgust / dim: desaturation. */
  grey: number;
  /** Mixed emotions: wobble. */
  wobble: number;
  /** Low confidence: hazy, semi-transparent. */
  haze: number;
  /** Trust: overall size. */
  scale: number;
  /** Trust: how close it floats to the camera, 0..1. */
  closeness: number;
  /** Ollama not available: dim and still. */
  dim: number;
  /** Distress overlay: soft and calm. */
  soothe: number;
}

export type VisualKey = keyof VisualParams;

/** Slider ranges for the debug panel. */
export const VISUAL_RANGES: Record<VisualKey, [number, number]> = {
  hueA: [0, 1],
  hueB: [0, 1],
  saturation: [0, 1],
  brightness: [0, 1.5],
  warmth: [-1, 1],
  split: [0, 1],
  speed: [0, 2.5],
  amplitude: [0, 1],
  lumpiness: [0, 1],
  spikes: [0, 1],
  droop: [0, 1],
  sink: [0, 1],
  shrink: [0, 1],
  avoid: [0, 1],
  lean: [0, 1],
  bounce: [0, 1],
  roundness: [0, 1],
  breathe: [0, 1],
  inward: [0, 1],
  grey: [0, 1],
  wobble: [0, 1],
  haze: [0, 1],
  scale: [0.4, 1.5],
  closeness: [0, 1],
  dim: [0, 1],
  soothe: [0, 1],
};

export const VISUAL_KEYS = Object.keys(VISUAL_RANGES) as VisualKey[];

/** Hue keys wrap around the color wheel and must be eased along the shortest arc. */
export const HUE_KEYS: VisualKey[] = ['hueA', 'hueB'];

export const VISUAL_TUNING = {
  /** Color temperature: at |warmth| = 1 the base color is mixed this far toward warm / cold. */
  warmRgb: [1.0, 0.58, 0.3] as [number, number, number],
  coldRgb: [0.3, 0.5, 0.95] as [number, number, number],
  temperatureMix: 0.5,
  emotionHue: {
    joy: 0.13,
    sadness: 0.61,
    anger: 0.0,
    fear: 0.76,
    calm: 0.47,
    curiosity: 0.3,
    disgust: 0.19,
  } as Record<Emotion, number>,
  /** How much the dominant emotion tints zone A / B. */
  zoneATint: 0.4,
  zoneBTint: 0.6,
  /** Emotion probability where a feature starts / is at full strength. */
  featureStart: 0.08,
  featureFull: 0.6,
  /** Clarity below which the blob gets hazy (full haze at hazeFull). */
  hazeStart: 0.55,
  hazeFull: 0.15,
};

export const DEFAULT_VISUAL: VisualParams = {
  hueA: 0.5,
  hueB: 0.5,
  saturation: 0.55,
  brightness: 0.9,
  warmth: 0,
  split: 0,
  speed: 0.5,
  amplitude: 0.3,
  lumpiness: 0.3,
  spikes: 0,
  droop: 0,
  sink: 0,
  shrink: 0,
  avoid: 0,
  lean: 0,
  bounce: 0,
  roundness: 0,
  breathe: 0.5,
  inward: 0,
  grey: 0,
  wobble: 0,
  haze: 0,
  scale: 1,
  closeness: 0.3,
  dim: 0,
  soothe: 0,
};

/** The soft, calm look used while soothing (distress safeguard). Never alarming. */
const SOOTHE_TARGET: Partial<VisualParams> = {
  saturation: 0.4,
  brightness: 0.95,
  split: 0,
  speed: 0.25,
  amplitude: 0.15,
  spikes: 0,
  droop: 0,
  sink: 0,
  shrink: 0,
  avoid: 0,
  bounce: 0,
  roundness: 0.8,
  breathe: 1,
  inward: 0,
  grey: 0,
  wobble: 0,
  haze: 0,
};

const feature = (p: number) => smoothstep(VISUAL_TUNING.featureStart, VISUAL_TUNING.featureFull, p);

export function moodToVisual(mood: MoodState, temperament: Temperament): VisualParams {
  const T = VISUAL_TUNING;
  const e = mood.emotions;
  const valence = clamp(mood.valence, -1, 1);
  const arousal = clamp(mood.arousal);

  const baseHue = temperament.hue;
  const [[top1]] = topTwo(e);
  const mixedness = clamp(mood.mixedness);
  const zoneA = mixedness > 0.1 ? mood.mixPair[0] : top1;
  const zoneB = mood.mixPair[1];

  const spikes = feature(e.anger) * (0.5 + 0.5 * arousal);
  const droop = feature(e.sadness);
  const shrink = feature(e.fear);
  const lean = feature(e.curiosity);
  const joy = feature(e.joy);
  const calm = feature(e.calm);
  const inward = feature(e.disgust);
  const haze = smoothstep(T.hazeStart, T.hazeFull, mood.clarity);

  const v: VisualParams = {
    hueA: mixHueRgb(baseHue, T.emotionHue[zoneA], T.zoneATint),
    hueB: mixHueRgb(baseHue, T.emotionHue[zoneB], T.zoneBTint),
    saturation: clamp(0.5 + 0.3 * Math.abs(valence) + 0.1 * joy - 0.35 * inward),
    brightness: clamp(0.82 + 0.25 * joy + 0.1 * valence - 0.18 * droop - 0.1 * inward, 0, 1.5),
    warmth: valence,
    split: mixedness,
    speed: clamp((0.3 + 1.3 * arousal + 0.3 * joy) * (1 - 0.55 * droop) * (1 - 0.4 * calm), 0.08, 2.5),
    amplitude: clamp(0.15 + 0.55 * arousal + 0.15 * joy - 0.1 * calm),
    lumpiness: clamp(temperament.lumpiness * (1 - 0.6 * joy) * (1 - 0.3 * calm)),
    spikes,
    droop,
    sink: droop * 0.8,
    shrink,
    avoid: shrink,
    lean,
    bounce: joy * (0.4 + 0.6 * arousal),
    roundness: joy,
    breathe: clamp(0.35 + 0.65 * calm),
    inward,
    grey: clamp(inward * 0.5),
    wobble: clamp(0.1 * arousal + 0.65 * mixedness + 0.35 * haze),
    haze,
    scale: clamp(0.78 + 0.3 * clamp(mood.trust) - 0.22 * shrink - 0.08 * inward, 0.4, 1.5),
    closeness: clamp(mood.trust),
    dim: 0,
    soothe: clamp(mood.soothe),
  };
  return applySoothe(v);
}

/** Blend toward the soft/calm look by the soothe amount. */
export function applySoothe(v: VisualParams): VisualParams {
  const s = clamp(v.soothe) * 0.85;
  if (s <= 0) return v;
  const out = { ...v };
  for (const [k, target] of Object.entries(SOOTHE_TARGET) as [VisualKey, number][]) {
    out[k] = lerp(v[k], target, s);
  }
  return out;
}

/**
 * A visual for a summary of the *user's* feelings (e.g. one day in the mood strip), drawn with
 * the blob's base hue so the strip matches its personality.
 */
export function feelingToVisual(
  userEmotion: Record<Emotion | 'none', number>,
  userValence: number,
  userIntensity: number,
  temperament: Temperament,
): VisualParams {
  const emotions = {} as EmotionDist;
  for (const k of EMOTIONS) emotions[k] = userEmotion[k] ?? 0;
  const dist = normalize(emotions);
  const [[a, pa], [b, pb]] = topTwo(dist);
  const mood: MoodState = {
    valence: clamp(userValence / 2, -1, 1),
    arousal: clamp(userIntensity),
    emotions: dist,
    clarity: concentration(dist),
    mixedness: mixednessOf(pa, pb),
    mixPair: [a, b],
    trust: 0.5,
    grudges: [],
    trustGains: [],
    soothe: 0,
    updatedAt: 0,
  };
  return moodToVisual(mood, temperament);
}

/** How "mixed" a reaction is, from its two most likely emotions. 1 = a near 50/50 split. */
export function mixednessOf(p1: number, p2: number): number {
  return smoothstep(0.25, 0.04, p1 - p2) * smoothstep(0.15, 0.3, p2);
}
