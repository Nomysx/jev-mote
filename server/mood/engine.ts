// The mood engine: deterministic rules that turn detected signals into mood changes.
// This is the blob's real long-term memory, so even small-context models work.

import { clamp, lerp, mixDist, normalize, topTwo } from '../../shared/math';
import { EMOTIONS, type Emotion, type EmotionDist, type Grudge, type MoodState, type Signals, type Temperament } from '../../shared/types';
import { mixednessOf } from '../../shared/visuals';
import { TUNING } from './tuning';

const M = TUNING.mood;
const TR = TUNING.trust;
const G = TUNING.grudges;

const half = (dtMs: number, halfLifeMs: number) => 1 - Math.pow(0.5, dtMs / halfLifeMs);

export function initialTrust(t: Temperament): number {
  return clamp(TR.initialBase + t.trustSpeed * TR.initialGain);
}

export function moodHalfLifeMs(t: Temperament): number {
  return lerp(M.halfLifeSlowMs, M.halfLifeFastMs, t.recoverySpeed);
}

export function grudgeHalfLifeMs(t: Temperament): number {
  return lerp(G.halfLifeShortMs, G.halfLifeLongMs, t.grudgeMemory);
}

export function grudgeTotal(grudges: Grudge[]): number {
  return clamp(grudges.reduce((s, g) => s + g.weight, 0));
}

const trustSpeedFactor = (t: Temperament) => TR.speedFloor + t.trustSpeed * TR.speedGain;

export interface RestingState {
  valence: number;
  arousal: number;
  emotions: EmotionDist;
}

/** Where the mood drifts when nothing happens. Depends on temperament, trust and active grudges. */
export function restingState(t: Temperament, trust: number, grudges: Grudge[]): RestingState {
  const g = grudgeTotal(grudges);
  const spec = TUNING.temperament.archetypes[t.archetype];
  const others = 1 - M.restingCalmShare - M.restingEmotionShare;
  const e = {} as EmotionDist;
  for (const k of EMOTIONS) e[k] = others / EMOTIONS.length;
  e.calm += M.restingCalmShare;
  e[spec.restingEmotion] += M.restingEmotionShare;
  e.joy += 0.12 * trust;
  e.anger += 0.15 * g;
  e.sadness += 0.1 * g;
  const valence = clamp(2 * t.baselineValence - 1 + M.trustValenceLift * (2 * trust - 1) - G.valencePull * g, -1, 1);
  return {
    valence,
    arousal: clamp(M.restingArousalBase + t.volatility * M.restingArousalGain),
    emotions: normalize(e),
  };
}

export function initialMood(t: Temperament, now: number): MoodState {
  const trust = initialTrust(t);
  const rest = restingState(t, trust, []);
  const [[a], [b]] = topTwo(rest.emotions);
  return {
    valence: rest.valence,
    arousal: rest.arousal,
    emotions: rest.emotions,
    clarity: M.restingClarity,
    mixedness: 0,
    mixPair: [a, b],
    trust,
    grudges: [],
    trustGains: [],
    soothe: 0,
    updatedAt: now,
  };
}

/** Let time pass: mood drifts to baseline, grudges fade, trust drifts very slowly. Works for any gap (e.g. app closed). */
export function decay(mood: MoodState, t: Temperament, now: number): MoodState {
  const dt = now - mood.updatedAt;
  const m: MoodState = structuredClone(mood);
  if (!(dt > 0)) return m;
  const span = Math.min(dt, M.decayMaxSpanMs);
  const steps = Math.max(1, Math.ceil(span / M.decayStepMs));
  const h = span / steps;
  const moodK = half(h, moodHalfLifeMs(t));
  const grudgeF = Math.pow(0.5, h / grudgeHalfLifeMs(t));
  const trustK = half(h, TR.halfLifeMs);
  const sootheF = Math.pow(0.5, h / TUNING.distress.halfLifeMs);
  const trust0 = initialTrust(t);

  for (let i = 0; i < steps; i++) {
    for (const g of m.grudges) g.weight *= grudgeF;
    m.grudges = m.grudges.filter((g) => g.weight >= G.forgetBelow);
    m.trust += (trust0 - m.trust) * trustK;
    const rest = restingState(t, m.trust, m.grudges);
    m.valence += (rest.valence - m.valence) * moodK;
    m.arousal += (rest.arousal - m.arousal) * moodK;
    m.emotions = mixDist(m.emotions, rest.emotions, moodK);
    m.clarity += (M.restingClarity - m.clarity) * moodK;
    m.mixedness *= 1 - moodK;
    m.soothe *= sootheF;
  }
  m.trustGains = m.trustGains.filter((g) => g.at > now - TR.dailyCapWindowMs);
  m.updatedAt = now;
  return m;
}

export interface MessageOutcome {
  mood: MoodState;
  /** One-off pulse animation (surprising message). */
  pulse: boolean;
  /** Show the wellbeing card. */
  distress: boolean;
  grudgeCreated: Grudge | null;
  trustDelta: number;
}

export function applyMessage(
  mood: MoodState,
  t: Temperament,
  s: Signals,
  now: number,
  opts: { hasHistory: boolean } = { hasHistory: true },
): MessageOutcome {
  const m = decay(mood, t, now);
  const intensity = clamp(s.userIntensity);
  const g = grudgeTotal(m.grudges);
  const dampen = G.positiveDampen * g;

  // 1. The blob's reaction, with positive feelings dampened while grudges are active. The dampened
  //    share is not redistributed to other reactions: that part of the blend keeps the current mood.
  const r = { ...normalize(s.blobReaction) };
  let held = 0;
  for (const k of TUNING.positiveEmotions) {
    held += r[k] * dampen;
    r[k] *= 1 - dampen;
  }
  for (const k of EMOTIONS) r[k] += held * m.emotions[k];

  // 2. Blend it into the mood, scaled by volatility and intensity.
  const alpha = clamp(M.blendBase + t.volatility * M.blendVolatilityGain) * (M.intensityFloor + (1 - M.intensityFloor) * intensity);
  m.emotions = mixDist(m.emotions, r, alpha);

  let reactionValence = 0;
  let reactionArousal = 0;
  for (const k of EMOTIONS) {
    reactionValence += r[k] * TUNING.emotionValence[k];
    reactionArousal += r[k] * TUNING.emotionArousal[k];
  }
  let valenceTarget = (1 - M.userValenceShare) * reactionValence + M.userValenceShare * clamp(s.userValence / 2, -1, 1);
  if (valenceTarget > 0) valenceTarget *= 1 - dampen;
  m.valence = clamp(m.valence + alpha * (valenceTarget - m.valence), -1, 1);
  m.arousal = clamp(m.arousal + alpha * (0.5 * reactionArousal + 0.5 * intensity - m.arousal));

  // 3. Stability: confidence -> clarity; a close top-two -> mixedness.
  const [[r1, p1], [r2, p2]] = topTwo(r);
  m.clarity = lerp(m.clarity, clamp(s.blobReactionConfidence), M.clarityBlend);
  m.mixedness = lerp(m.mixedness, mixednessOf(p1, p2), M.clarityBlend);
  m.mixPair = [r1, r2];

  // 4. Trust, scaled by trustSpeed and capped per day.
  const before = m.trust;
  const toneEvidence = s.tone.kind - s.tone.hostile - 0.5 * s.tone.dismissive;
  const net = (1 - TR.toneShare) * (s.trustChange.increase - s.trustChange.decrease) + TR.toneShare * toneEvidence;
  if (net > 0) {
    const speed = trustSpeedFactor(t);
    const gainedToday = m.trustGains.reduce((sum, x) => sum + x.amount, 0);
    const cap = Math.max(0, TR.dailyCapBase * speed - gainedToday);
    const gain = Math.min(TR.rate * speed * net * (1 - m.trust), cap);
    if (gain > 0) {
      m.trust += gain;
      m.trustGains.push({ at: now, amount: gain });
    }
  } else if (net < 0) {
    m.trust -= TR.lossRate * -net * m.trust;
  }
  m.trust = clamp(m.trust - TR.hostileHit * s.tone.hostile);

  // 5. Grudges: kindness helps forgive; hostility or dismissiveness leaves a grudge.
  if (s.tone.kind > 0.3) {
    const f = 1 - G.forgivePerKind * s.tone.kind * (1 - t.grudgeMemory);
    for (const gr of m.grudges) gr.weight *= f;
    m.grudges = m.grudges.filter((gr) => gr.weight >= G.forgetBelow);
  }
  let grudgeCreated: Grudge | null = null;
  const hurt = s.tone.hostile + G.dismissiveWeight * s.tone.dismissive;
  if (hurt > G.threshold) {
    grudgeCreated = {
      id: `g${now.toString(36)}${m.grudges.length}`,
      weight: clamp(clamp(hurt) * (0.5 + 0.5 * t.grudgeMemory) * (0.6 + 0.4 * intensity)),
      createdAt: now,
      cause: s.tone.hostile >= s.tone.dismissive ? 'hostile' : 'dismissive',
    };
    m.grudges.push(grudgeCreated);
    if (m.grudges.length > G.maxGrudges) {
      m.grudges.sort((a, b) => b.weight - a.weight);
      m.grudges = m.grudges.slice(0, G.maxGrudges);
    }
  }

  // 6. Wellbeing: turn soft and calm, never alarming.
  const distress = s.distress >= TUNING.distress.threshold;
  if (distress) {
    m.soothe = 1;
    const calm = {} as EmotionDist;
    for (const k of EMOTIONS) calm[k] = k === 'calm' ? 1 : 0;
    m.emotions = mixDist(m.emotions, calm, TUNING.distress.calmPull);
    m.arousal = Math.min(m.arousal, 0.15);
    m.valence = lerp(m.valence, 0.1, 0.5);
    m.mixedness *= 0.2;
    m.clarity = Math.max(m.clarity, M.restingClarity);
  }

  m.updatedAt = now;
  return {
    mood: m,
    pulse: opts.hasHistory && s.surprising > TUNING.surprise.pulseThreshold,
    distress,
    grudgeCreated,
    trustDelta: m.trust - before,
  };
}

/** The mood a blob shows when a message could not be read (e.g. language not supported): puzzled, a bit hazy. */
export function applyUnreadable(mood: MoodState, t: Temperament, now: number): MoodState {
  const m = decay(mood, t, now);
  const curious = {} as EmotionDist;
  for (const k of EMOTIONS) curious[k] = k === 'curiosity' ? 0.6 : k === 'calm' ? 0.3 : 0.1 / 5;
  m.emotions = mixDist(m.emotions, curious, 0.3);
  m.clarity = Math.min(m.clarity, 0.3);
  return m;
}

const EMOTION_WORD: Record<Emotion, string> = {
  joy: 'happy',
  sadness: 'sad',
  anger: 'irritated',
  fear: 'uneasy',
  calm: 'calm',
  curiosity: 'curious',
  disgust: 'put off',
};

/**
 * Mood in words plus numbers, e.g. "uneasy, valence -0.40, arousal 0.55, trust 0.30".
 * The "numbers" style leaves out emotion words, for models that mix state words into their answers.
 */
export function describeMood(m: MoodState, style: 'words' | 'numbers' = 'words'): string {
  const g = grudgeTotal(m.grudges);
  const nums = `valence ${m.valence.toFixed(2)}, arousal ${m.arousal.toFixed(2)}, trust ${m.trust.toFixed(2)}`;
  if (style === 'numbers') return g > 0.15 ? `${nums}, grudge ${g.toFixed(2)}` : nums;
  const [[top, p1], [second, p2]] = topTwo(m.emotions);
  let word = EMOTION_WORD[top];
  if (m.arousal > 0.65) word = `very ${word}`;
  else if (m.arousal < 0.2 && top !== 'calm') word = `quietly ${word}`;
  if (p2 > 0.2 && p1 - p2 < 0.12) word += ` and ${EMOTION_WORD[second]}`;
  const hurt = g > 0.5 ? ', still hurt' : g > 0.15 ? ', a little hurt' : '';
  return `${word}${hurt}, ${nums}`;
}

export function relativeTime(deltaMs: number): string {
  const min = Math.round(deltaMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 2) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  return `${weeks} weeks ago`;
}

/** Grudges in words, e.g. ["insulted 3 days ago, still hurt"]. */
export function describeGrudges(grudges: Grudge[], now: number): string[] {
  return [...grudges]
    .sort((a, b) => b.weight - a.weight)
    .map((g) => {
      const what = g.cause === 'hostile' ? 'insulted' : 'brushed off';
      const how = g.weight > 0.5 ? 'still hurt' : g.weight > 0.2 ? 'a little hurt' : 'mostly over it';
      return `${what} ${relativeTime(now - g.createdAt)}, ${how}`;
    });
}
