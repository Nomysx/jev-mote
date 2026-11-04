// What Mote's inner life does to it. A thought on its own nudges the mood a little (the expected
// effect over the model's probabilities); a dream can ease a hard day or leave it jumpy for a while.
// Deterministic and small on purpose: the writer's entries stay what moves Mote most, and inner life
// tends to heal (thoughts and dreams can soften grudges, never deepen them).

import { clamp, mixDist, normalize } from '../../shared/math';
import { EMOTIONS, type Dream, type Emotion, type EmotionDist, type IdleThought, type MoodState, type Temperament } from '../../shared/types';
import { decay, grudgeTotal } from '../mood/engine';
import { TUNING } from '../mood/tuning';

const G = TUNING.grudges;

const oneHot = (e: Emotion): EmotionDist => Object.fromEntries(EMOTIONS.map((k) => [k, k === e ? 1 : 0])) as EmotionDist;

function forgive(m: MoodState, t: Temperament, amount: number) {
  if (amount <= 0) return;
  const f = 1 - clamp(amount) * (1 - 0.5 * t.grudgeMemory);
  for (const g of m.grudges) g.weight *= f;
  m.grudges = m.grudges.filter((g) => g.weight >= G.forgetBelow);
}

export function applyThought(mood: MoodState, t: Temperament, thought: Record<IdleThought, number>, now: number): MoodState {
  const m = decay(mood, t, now);
  const T = TUNING.thoughts;
  let dv = 0;
  let da = 0;
  let forgiveBy = 0;
  const tint = {} as EmotionDist;
  for (const k of EMOTIONS) tint[k] = 0;
  let tintMass = 0;
  for (const [k, p] of Object.entries(thought) as [IdleThought, number][]) {
    const e = T.effects[k];
    if (!e || !(p > 0)) continue;
    dv += p * (e.valence ?? 0);
    da += p * (e.arousal ?? 0);
    forgiveBy += p * (e.forgive ?? 0);
    if (e.emotion) {
      tint[e.emotion] += p;
      tintMass += p;
    }
  }
  m.valence = clamp(m.valence + clamp(dv, -0.06, 0.06), -1, 1);
  m.arousal = clamp(m.arousal + clamp(da, -0.05, 0.05));
  if (tintMass > 0) m.emotions = mixDist(m.emotions, normalize(tint), T.tint * tintMass);
  forgive(m, t, forgiveBy);
  m.updatedAt = now;
  return m;
}

export interface DreamOutcome {
  mood: MoodState;
  effect: Dream['effect'];
}

/**
 * `hardSeed`: the dream came from something hard (a painful entry, or one that left a grudge).
 * A calm ending after a hard dream "sleeps on it": grudges ease and it wakes a little lighter.
 */
export function applyDream(mood: MoodState, t: Temperament, d: Pick<Dream, 'feeling' | 'ending'>, hardSeed: boolean, now: number): DreamOutcome {
  const m = decay(mood, t, now);
  const D = TUNING.dreams;
  const calmEnd = clamp(d.ending.peaceful + d.ending.found + 0.5 * d.ending.transformed);
  const dark = clamp(d.feeling.fear + d.feeling.anger + d.feeling.sadness + d.feeling.disgust);
  const topEnding = (Object.entries(d.ending) as [keyof Dream['ending'], number][]).sort((a, b) => b[1] - a[1])[0][0];
  const nightmare = topEnding === 'woke_suddenly' && dark >= 0.5;
  const hard = hardSeed || grudgeTotal(m.grudges) > 0.15;
  let effect: Dream['effect'] = 'none';
  if (nightmare) {
    effect = 'nightmare';
    m.arousal = clamp(m.arousal + D.nightmareArousal * dark);
    m.valence = clamp(m.valence + D.nightmareValence * dark, -1, 1);
    m.emotions = mixDist(m.emotions, oneHot('fear'), D.tint * dark);
  } else if (hard && calmEnd >= 0.5) {
    effect = 'processed';
    forgive(m, t, D.processGrudge * calmEnd);
    m.valence = clamp(m.valence + D.processValence * calmEnd, -1, 1);
    m.emotions = mixDist(m.emotions, oneHot('calm'), D.tint * calmEnd);
  } else if (!hard && d.feeling.joy + d.feeling.calm >= 0.5 && calmEnd >= 0.5) {
    effect = 'sweet';
    m.valence = clamp(m.valence + D.sweetValence * calmEnd, -1, 1);
    m.emotions = mixDist(m.emotions, oneHot(d.feeling.joy >= d.feeling.calm ? 'joy' : 'calm'), D.tint * calmEnd);
  }
  m.updatedAt = now;
  return { mood: m, effect };
}
