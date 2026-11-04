// Validation of `/v1/systemone` responses and translation of answers into domain signals.
// Providers call validateResponse(); the pipeline calls toSignals().

import { clamp, concentration, normalize } from '../../shared/math';
import { EMOTIONS, LIFE_AREAS, TONES, TRUST_CHANGES, type Emotion, type EmotionDist, type LifeArea, type Signals } from '../../shared/types';
import { DEFAULT_QUESTION_CONFIG, YES_KEY, type QuestionConfig, type YesNoQuestionName } from './questions';
import { DecisionError, type Answer, type Answers, type Question, type Questions, type SystemOneResponse } from './types';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);

function probabilitiesFor(keys: string[], raw: unknown): Record<string, number> | undefined {
  if (!isObj(raw)) return undefined;
  const out: Record<string, number> = {};
  let sum = 0;
  for (const k of keys) {
    const v = num(raw[k]);
    out[k] = v !== undefined && v > 0 ? v : 0;
    sum += out[k];
  }
  return sum > 0 ? normalize(out) : undefined;
}

const argmax = (p: Record<string, number>) => Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];

/** Normalize one answer against its question. Returns undefined if it is missing or unusable. */
export function normalizeAnswer(q: Question, raw: unknown): Answer | undefined {
  if (!isObj(raw)) return undefined;
  if (typeof raw.type === 'string' && raw.type !== q.type) return undefined;

  if (q.type === 'noul') {
    const v = typeof raw.noul === 'boolean' ? (raw.noul ? 1 : 0) : num(raw.noul);
    return v === undefined ? undefined : { type: 'noul', noul: clamp(v) };
  }

  if (q.type === 'choice') {
    const keys = Object.keys(q.criteria);
    let probs = probabilitiesFor(keys, raw.probabilities);
    const choice = typeof raw.choice === 'string' && keys.includes(raw.choice) ? raw.choice : undefined;
    if (!probs && choice) probs = Object.fromEntries(keys.map((k) => [k, k === choice ? 1 : 0]));
    if (!probs) return undefined;
    const conf = num(raw.confidence);
    return {
      type: 'choice',
      choice: choice ?? argmax(probs),
      probabilities: probs,
      confidence: conf !== undefined ? clamp(conf) : concentration(probs),
    };
  }

  // score
  const n = q.criteria.length;
  const keys = q.criteria.map((_, i) => String(i));
  let probs = probabilitiesFor(keys, raw.probabilities);
  let score = num(raw.score);
  if (!probs && score !== undefined) {
    // Only the expected level is known: spread it over the two nearest levels.
    const s = clamp(score, 0, n - 1);
    const lo = Math.floor(s);
    const hi = Math.min(n - 1, lo + 1);
    probs = Object.fromEntries(keys.map((k) => [k, 0]));
    probs[String(lo)] += hi === lo ? 1 : 1 - (s - lo);
    if (hi !== lo) probs[String(hi)] += s - lo;
  }
  if (!probs) return undefined;
  if (score === undefined) score = keys.reduce((sum, k, i) => sum + i * probs![k], 0);
  const legend: Record<string, string> = {};
  q.criteria.forEach((c, i) => (legend[String(i)] = isObj(raw.legend) && typeof raw.legend[String(i)] === 'string' ? (raw.legend[String(i)] as string) : c));
  const conf = num(raw.confidence);
  return {
    type: 'score',
    score: clamp(score, 0, n - 1),
    legend,
    probabilities: probs,
    confidence: conf !== undefined ? clamp(conf) : concentration(probs),
  };
}

export interface ValidatedResponse extends SystemOneResponse {
  /** Question names whose answers were missing or malformed. */
  invalid: string[];
}

/** Validate a raw `/v1/systemone` JSON body against the questions that were asked. */
export function validateResponse(questions: Questions, raw: unknown, requestedModel: string): ValidatedResponse {
  if (!isObj(raw) || !isObj(raw.answers)) {
    throw new DecisionError('bad_response', 'The decision model returned a response without an "answers" object.');
  }
  const answers: Answers = {};
  const invalid: string[] = [];
  for (const [name, q] of Object.entries(questions)) {
    const a = normalizeAnswer(q, raw.answers[name]);
    if (a) answers[name] = a;
    else invalid.push(name);
  }
  if (Object.keys(answers).length === 0) {
    throw new DecisionError('bad_response', 'The decision model returned no usable answers.');
  }
  const usage = isObj(raw.usage)
    ? { input_tokens: num(raw.usage.input_tokens) ?? 0, output_tokens: num(raw.usage.output_tokens) ?? 0 }
    : undefined;
  return { model: typeof raw.model === 'string' ? raw.model : requestedModel, answers, usage, invalid };
}

// ---- Answers -> Signals ----------------------------------------------------------------------

function choiceDist<K extends string>(answers: Answers, name: string, keys: readonly K[], fallback: K): { dist: Record<K, number>; confidence: number; ok: boolean } {
  const a = answers[name];
  const dist = {} as Record<K, number>;
  if (a && a.type === 'choice') {
    for (const k of keys) dist[k] = a.probabilities[k] ?? 0;
    const sum = keys.reduce((s, k) => s + dist[k], 0);
    if (sum > 0) return { dist: normalize(dist), confidence: a.confidence, ok: true };
  }
  for (const k of keys) dist[k] = k === fallback ? 1 : 0;
  return { dist, confidence: 0.5, ok: false };
}

function scoreFraction(answers: Answers, name: string): number | undefined {
  const a = answers[name];
  if (!a || a.type !== 'score') return undefined;
  const levels = Object.keys(a.probabilities).length;
  return levels > 1 ? clamp(a.score / (levels - 1)) : undefined;
}

/** Probability of "yes" for a yes/no question asked either as noul or as a two-option choice. */
export function yesProbability(answers: Answers, name: YesNoQuestionName): number | undefined {
  const a = answers[name];
  if (!a) return undefined;
  if (a.type === 'noul') return a.noul;
  if (a.type === 'choice') return a.probabilities[YES_KEY];
  return undefined;
}

export function toSignals(answers: Answers, _config: QuestionConfig = DEFAULT_QUESTION_CONFIG): Signals {
  const warnings: string[] = [];
  const userEmotion = choiceDist(answers, 'user_emotion', [...EMOTIONS, 'none'] as const, 'none');
  if (!userEmotion.ok) warnings.push('user_emotion');
  const top = Object.entries(userEmotion.dist).sort((a, b) => b[1] - a[1])[0][0] as Emotion | 'none';

  const valence = scoreFraction(answers, 'user_valence');
  if (valence === undefined) warnings.push('user_valence');
  const intensity = scoreFraction(answers, 'user_intensity');
  if (intensity === undefined) warnings.push('user_intensity');

  const life = choiceDist(answers, 'life_area', LIFE_AREAS, 'other');
  if (!life.ok) warnings.push('life_area');
  const tone = choiceDist(answers, 'tone_toward_blob', TONES, 'neutral');
  if (!tone.ok) warnings.push('tone_toward_blob');
  const reaction = choiceDist(answers, 'blob_reaction', EMOTIONS, 'calm');
  if (!reaction.ok) warnings.push('blob_reaction');
  const trust = choiceDist(answers, 'trust_change', TRUST_CHANGES, 'stay');
  if (!trust.ok) warnings.push('trust_change');

  const surprising = yesProbability(answers, 'surprising');
  if (surprising === undefined) warnings.push('surprising');
  const distress = yesProbability(answers, 'distress_flag');
  if (distress === undefined) warnings.push('distress_flag');

  const lifeArea = Object.entries(life.dist).sort((a, b) => b[1] - a[1])[0][0] as LifeArea;
  return {
    userEmotion: userEmotion.dist,
    userEmotionTop: top,
    userValence: valence === undefined ? 0 : valence * 4 - 2,
    userIntensity: intensity ?? 0.3,
    lifeArea,
    lifeAreaProbabilities: life.dist,
    tone: tone.dist,
    blobReaction: reaction.dist as EmotionDist,
    blobReactionConfidence: reaction.ok ? reaction.confidence : 0.5,
    trustChange: trust.dist,
    surprising: surprising ?? 0,
    distress: distress ?? 0,
    warnings,
  };
}
