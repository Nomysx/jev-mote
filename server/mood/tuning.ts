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

  /** Returning after at least this long plays the "waking up" transition (and shows what it did). */
  wakeAfterMs: 20 * 60_000,

  /** Mote's body: energy, sleep, missing the writer, restlessness. */
  life: {
    /** Awake, a full battery lasts about this long (faster when stirred up: x0.8 calm .. x1.2 aroused). */
    awakeDrainMs: 22 * HOUR,
    /** Asleep, an empty battery refills in about this long. */
    sleepFillMs: 7 * HOUR,
    /** Each entry costs a little energy: base + intensity * gain. */
    entryCostBase: 0.01,
    entryCostGain: 0.02,
    /** Sleep pressure = (1 - energy) + time of day. It falls asleep at sleepAt and wakes below wakeBelow. */
    sleepAt: 1,
    wakeBelow: 0.15,
    /** Never falls asleep within this long of the writer doing something. */
    sleepAfterQuietMs: 20 * 60_000,
    /** A decided-on nap turns into real sleep when the pressure is at least this. Naps last up to napMaxMs. */
    napSleepAt: 0.7,
    napMaxMs: 90 * 60_000,
    maxSleepMs: 14 * HOUR,
    /** Missing the writer: attachment (base + trust * gain) times 1 - 0.5^(away / half). */
    attachBase: 0.35,
    attachTrust: 0.65,
    longingHalfMs: 8 * HOUR,
    /** Restlessness builds to half in this long while awake (half as fast with company). */
    boredomHalfMs: 3 * HOUR,
    boredomSleepHalfMs: HOUR,
    /** Writing resets most of it; wandering or looking around works some of it off. */
    boredomAfterEntry: 0.3,
    boredomAfterAction: 0.7,
    /** Sleep cycles: the last part of each cycle is REM (dreaming). No dreams in the first hour. */
    cycleMs: 90 * 60_000,
    remFrom: 0.72,
    firstDreamAfterMs: HOUR,
    maxDreamsPerSleep: 2,
    /** A sleep at least this long without a dream leaves a dream it may remember later (within forgetDreamMs). */
    dreamMinSleepMs: 2 * HOUR,
    forgetDreamMs: 12 * HOUR,
    /** The page counts as watching for this long after its last visible tick. */
    watchedMs: 3 * 60_000,
    /** Thinking on its own while nobody watches: every min..max (slower than when watched). */
    awayThinkMinMs: 25 * 60_000,
    awayThinkMaxMs: 40 * 60_000,
    /** Retry sooner when the model just wasn't loaded. */
    awayRetryMs: 10 * 60_000,
    /** Integration step for long gaps, and the longest gap simulated in full. */
    stepMs: 10 * 60_000,
    maxSimMs: 4 * DAY,
    /**
     * Noticing you at the computer (off unless you turn it on, server/senses). With no keyboard or
     * mouse for this long, or the screen locked, you're away: an open Mote window no longer counts
     * as you watching it.
     */
    awayAfterIdleMs: 10 * 60_000,
    /** You at the computer, busy with other things, counts like having seen it this long ago: it misses you a little, never a lot. */
    nearContactLagMs: 2 * HOUR,
  },

  /**
   * Your daily rhythm (server/senses/rhythm.ts), learned from when you're at the computer. Mote's
   * body clock (sleep, waking up, the time of day it feels) moves toward it as it learns.
   */
  rhythm: {
    /** It learns from the last two weeks of finished days. */
    windowDays: 14,
    /** A day counts if you were at the computer at least this many minutes. */
    minDayMinutes: 30,
    /** It starts adapting after minDays counted days and has fully adapted after fullDays. */
    minDays: 3,
    fullDays: 12,
    /** Your night: the quietest stretch of this many hours (15-minute slots, smoothed over ±1 h). */
    nightHours: 7,
    smoothSlots: 4,
    /** A night only counts as clear if it is this much quieter than the rest of the day. */
    contrast: 0.35,
    /** The middle of Mote's night by nature (its nights are about 23:00 to 7:00). */
    natureMidHour: 3,
    natureSleep: { from: 23, to: 7 },
    /** Minutes at the computer per quarter hour are kept this many days, then deleted. */
    keepDays: 90,
  },

  /**
   * What a thought on its own does to the mood: the expected effect over the model's probabilities.
   * Small on purpose, and inner life tends to heal: thoughts can ease grudges, never deepen them.
   */
  thoughts: {
    effects: {
      remember_good: { valence: 0.05, emotion: 'joy' },
      remember_hard: { valence: -0.035, emotion: 'sadness' },
      miss_writer: { valence: -0.01, emotion: 'sadness' },
      wonder_day: { emotion: 'curiosity' },
      worried: { valence: -0.025, arousal: 0.03, emotion: 'fear' },
      grateful: { valence: 0.04, emotion: 'joy' },
      still_hurt: { valence: -0.03, emotion: 'sadness' },
      forgiving: { valence: 0.025, emotion: 'calm', forgive: 0.25 },
      sleepy: { arousal: -0.04, emotion: 'calm' },
      bored: { valence: -0.005 },
      content: { valence: 0.02, emotion: 'calm' },
      curious: { arousal: 0.02, emotion: 'curiosity' },
      daydream: { emotion: 'calm' },
    } as Record<string, { valence?: number; arousal?: number; emotion?: Emotion; forgive?: number }>,
    /** How far one thought tints the emotions toward its feeling (times its probability). */
    tint: 0.06,
  },

  /** What a dream does: sleeping on a hard thing helps; a nightmare leaves it jumpy for a while. */
  dreams: {
    processGrudge: 0.35,
    processValence: 0.06,
    nightmareArousal: 0.15,
    nightmareValence: -0.05,
    sweetValence: 0.05,
    tint: 0.1,
  },

  /** Thought or dreamed about this many times: a core memory, which can come back long after. */
  coreMemoryRecalls: 3,

  /**
   * Character growth (server/life/character.ts). Each step moves a trait a fraction of the way to
   * 1 (grow) or 0 (shrink), so change is fast at first and slows near the ends. Traits drift back
   * toward Mote's nature over weeks, so recent life matters most, but nothing is ever wiped.
   */
  character: {
    driftHalfLifeMs: 45 * DAY,
    entry: {
      warmthKind: 0.06,
      warmthShared: 0.02,
      warmthHurt: 0.05,
      warinessHurt: 0.1,
      warinessKind: 0.03,
      curiosity: 0.035,
      play: 0.03,
      playHurt: 0.04,
      courageShared: 0.012,
      courageFear: 0.015,
    },
    thought: { warmth: 0.012, curiosity: 0.012, dreaminess: 0.015, letGo: 0.03, letGoCourage: 0.012, dwell: 0.008, worry: 0.008, play: 0.005 },
    dream: { dreaminess: 0.03, vivid: 0.03, processedCourage: 0.05, processedWariness: 0.03, nightmareCourage: 0.04, nightmareWariness: 0.02, sweetWarmth: 0.02, sweetPlay: 0.01, reunionWarmth: 0.015, flyingCourage: 0.01 },
    /** A trait counts as part of who Mote is above this (milestones: "Grew warm"). */
    strong: 0.65,
    trustSteps: [0.4, 0.6, 0.8],
    maxMemoryNodes: 160,
  },
} as const;

export const MS = { HOUR, DAY };
