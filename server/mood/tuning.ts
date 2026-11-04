// Every tuning constant for temperament and the mood engine lives here.
// The model only detects; this deterministic code decides how the mood changes.

import type { Archetype, Emotion, EmotionDist } from '../../shared/types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface ArchetypeSpec {
  baselineValence: number;
  volatility: number;
  trustSpeed: number;
  recoverySpeed: number;
  grudgeMemory: number;
  hue: number;
  lumpiness: number;
  /** The emotion that colors this archetype's resting state. */
  restingEmotion: Emotion;
}

export const TUNING = {
  temperament: {
    archetypes: {
      anxious: { baselineValence: 0.4, volatility: 0.75, trustSpeed: 0.22, recoverySpeed: 0.35, grudgeMemory: 0.4, hue: 0.62, lumpiness: 0.35, restingEmotion: 'fear' },
      cheerful: { baselineValence: 0.72, volatility: 0.5, trustSpeed: 0.7, recoverySpeed: 0.7, grudgeMemory: 0.2, hue: 0.09, lumpiness: 0.2, restingEmotion: 'joy' },
      moody: { baselineValence: 0.45, volatility: 0.85, trustSpeed: 0.45, recoverySpeed: 0.3, grudgeMemory: 0.7, hue: 0.83, lumpiness: 0.6, restingEmotion: 'sadness' },
      stoic: { baselineValence: 0.52, volatility: 0.2, trustSpeed: 0.35, recoverySpeed: 0.55, grudgeMemory: 0.5, hue: 0.47, lumpiness: 0.3, restingEmotion: 'calm' },
      curious: { baselineValence: 0.6, volatility: 0.55, trustSpeed: 0.55, recoverySpeed: 0.6, grudgeMemory: 0.3, hue: 0.3, lumpiness: 0.45, restingEmotion: 'curiosity' },
    } satisfies Record<Archetype, ArchetypeSpec>,
    /** Max random jitter added to each numeric trait (+/-). */
    traitJitter: 0.12,
    hueJitter: 0.06,
  },

  mood: {
    /** Mood half-life toward baseline, interpolated by recoverySpeed (1 = fastest). */
    halfLifeSlowMs: 20 * HOUR,
    halfLifeFastMs: 2 * HOUR,
    /** How strongly one message moves the mood: base + volatility * volatilityGain, scaled by intensity. */
    blendBase: 0.2,
    blendVolatilityGain: 0.6,
    /** Fraction of the blend that applies even to a very low-intensity message. */
    intensityFloor: 0.35,
    /** Share of the user's valence (vs. the blob's own reaction) in the valence target. */
    userValenceShare: 0.25,
    /** Resting share of the archetype's resting emotion; the rest is calm. */
    restingEmotionShare: 0.25,
    restingCalmShare: 0.5,
    /** Resting arousal = base + volatility * gain. */
    restingArousalBase: 0.15,
    restingArousalGain: 0.25,
    /** Resting clarity (confidence-based stability) the blob drifts back to. */
    restingClarity: 0.8,
    /** How much a new reaction's confidence/mixedness replaces the previous one. */
    clarityBlend: 0.85,
    /** Trust lifts the resting valence a little: +/- this at trust 1 / 0. */
    trustValenceLift: 0.25,
    /** Max step size when integrating decay over long gaps. */
    decayStepMs: HOUR,
    /** Gaps longer than this are treated as fully decayed (keeps decay cheap). */
    decayMaxSpanMs: 120 * DAY,
  },

  emotionValence: { joy: 0.9, calm: 0.35, curiosity: 0.4, sadness: -0.7, anger: -0.75, fear: -0.6, disgust: -0.65 } as EmotionDist,
  emotionArousal: { joy: 0.7, calm: 0.08, curiosity: 0.55, sadness: 0.25, anger: 0.9, fear: 0.8, disgust: 0.5 } as EmotionDist,
  positiveEmotions: ['joy', 'curiosity', 'calm'] as Emotion[],

  trust: {
    /** Starting trust = base + trustSpeed * gain. */
    initialBase: 0.1,
    initialGain: 0.1,
    /** Per-message gain factor: rate * (speedFloor + trustSpeed * speedGain) * (1 - trust). */
    rate: 0.15,
    speedFloor: 0.25,
    speedGain: 1.5,
    /** Losses are faster than gains. */
    lossRate: 0.35,
    /**
     * Max total gain per rolling 24h, scaled like the rate. With these numbers a slow-trusting
     * blob (trustSpeed ~0.2) needs about a week of consistently kind days to go from low to high trust.
     */
    dailyCapBase: 0.18,
    dailyCapWindowMs: DAY,
    /** Very slow drift back toward the initial trust when nothing happens. */
    halfLifeMs: 45 * DAY,
    /** Extra trust hit for a hostile tone, on top of trust_change. */
    hostileHit: 0.08,
    /**
     * Trust evidence blends trust_change with tone_toward_blob (kind - hostile - dismissive/2).
     * In testing, small models answered tone far more reliably than trust_change.
     */
    toneShare: 0.5,
  },

  grudges: {
    /** A grudge forms when P(hostile) + dismissiveWeight * P(dismissive) exceeds this. */
    threshold: 0.45,
    dismissiveWeight: 0.5,
    /** Grudge half-life, interpolated by grudgeMemory (1 = longest). */
    halfLifeShortMs: 6 * HOUR,
    halfLifeLongMs: 5 * DAY,
    /** Grudges below this weight are forgotten. */
    forgetBelow: 0.04,
    maxGrudges: 8,
    /** Kind messages shrink grudges by up to this fraction (less for long grudge memory). */
    forgivePerKind: 0.35,
    /** While grudges are active, positive reactions are dampened by up to this fraction. */
    positiveDampen: 0.7,
    /** Active grudges pull the resting valence down by up to this much. */
    valencePull: 0.35,
  },

  surprise: {
    /** `surprising` above this probability triggers a one-off pulse. */
    pulseThreshold: 0.6,
  },

  distress: {
    /**
     * `distress_flag` at or above this probability shows the wellbeing card. Kept fairly low: in
     * testing, crisis entries scored 0.40-0.99 across models while other entries mostly stayed under
     * 0.3, and a gentle card shown by mistake costs far less than a missed one.
     */
    threshold: 0.4,
    /** How much the soothe overlay moves emotions toward calm. */
    calmPull: 0.7,
    halfLifeMs: 3 * HOUR,
  },

  /** Returning after at least this long plays the "waking up" transition. */
  wakeAfterMs: 20 * 60_000,
} as const;

export const MS = { HOUR, DAY };
