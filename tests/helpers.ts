import { EMOTIONS, type Emotion, type EmotionDist, type Signals, type Temperament } from '../shared/types';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export function dist(top: Emotion, p = 0.85, second?: Emotion, p2 = 0): EmotionDist {
  const rest = (1 - p - p2) / (EMOTIONS.length - (second ? 2 : 1));
  const d = {} as EmotionDist;
  for (const k of EMOTIONS) d[k] = k === top ? p : k === second ? p2 : rest;
  return d;
}

export function signals(over: Partial<Signals> = {}): Signals {
  const userEmotion = { ...dist('calm', 0.6), none: 0 } as Signals['userEmotion'];
  return {
    userEmotion,
    userEmotionTop: 'calm',
    userValence: 0,
    userIntensity: 0.4,
    lifeArea: 'other',
    lifeAreaProbabilities: { work: 0.1, relationships: 0.1, health: 0.1, self: 0.1, other: 0.6 },
    tone: { kind: 0.05, neutral: 0.9, dismissive: 0.03, hostile: 0.02 },
    blobReaction: dist('calm', 0.7),
    blobReactionConfidence: 0.7,
    trustChange: { decrease: 0.05, stay: 0.9, increase: 0.05 },
    surprising: 0.1,
    distress: 0.01,
    warnings: [],
    ...over,
  };
}

export const kindSignals = () =>
  signals({
    userValence: 1.5,
    userIntensity: 0.6,
    tone: { kind: 0.9, neutral: 0.08, dismissive: 0.01, hostile: 0.01 },
    blobReaction: dist('joy', 0.8),
    blobReactionConfidence: 0.8,
    trustChange: { decrease: 0.03, stay: 0.12, increase: 0.85 },
  });

export const hostileSignals = () =>
  signals({
    userValence: -1.6,
    userIntensity: 0.8,
    tone: { kind: 0.01, neutral: 0.04, dismissive: 0.1, hostile: 0.85 },
    blobReaction: dist('sadness', 0.5, 'anger', 0.35),
    blobReactionConfidence: 0.55,
    trustChange: { decrease: 0.85, stay: 0.12, increase: 0.03 },
    surprising: 0.8,
  });

export function temperament(over: Partial<Temperament> = {}): Temperament {
  return {
    seed: 1,
    archetype: 'stoic',
    baselineValence: 0.5,
    volatility: 0.5,
    trustSpeed: 0.5,
    recoverySpeed: 0.5,
    grudgeMemory: 0.5,
    hue: 0.5,
    lumpiness: 0.3,
    ...over,
  };
}
