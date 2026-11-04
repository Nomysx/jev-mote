import { describe, expect, it } from 'vitest';
import { toSignals, validateResponse, yesProbability } from '../server/decision/parse';
import { buildQuestions } from '../server/decision/questions';
import { DecisionError } from '../server/decision/types';

const questions = buildQuestions({ surprising: { askAs: 'noul' }, distress_flag: { askAs: 'choice' } });

/** A response in the exact shape Ollama returned for laya during development. */
const realLaya = {
  model: 'laya',
  answers: {
    user_emotion: {
      type: 'choice',
      choice: 'joy',
      probabilities: { joy: 0.9902, sadness: 0.0009, anger: 0.0005, fear: 0.0004, calm: 0.0049, curiosity: 0.0, disgust: 0.0, none: 0.0031 },
      confidence: 0.9883,
    },
    user_valence: {
      type: 'score',
      score: 2.8162,
      legend: { '0': 'Very negative', '1': 'Negative', '2': 'Neutral or mixed', '3': 'Positive', '4': 'Very positive' },
      probabilities: { '0': 0.0405, '1': 0.0412, '2': 0.0819, '3': 0.7341, '4': 0.1022 },
      confidence: 0.6765,
    },
    distress_flag: { type: 'choice', choice: 'b', probabilities: { a: 0.02, b: 0.98 }, confidence: 0.86 },
    surprising: { type: 'noul', noul: 1.85e-5 },
  },
  usage: { input_tokens: 199, output_tokens: 0 },
};

describe('validateResponse', () => {
  it('accepts a real Ollama response', () => {
    const r = validateResponse(questions, realLaya, 'laya');
    expect(r.model).toBe('laya');
    expect(r.usage).toEqual({ input_tokens: 199, output_tokens: 0 });
    expect(r.answers.user_emotion).toMatchObject({ type: 'choice', choice: 'joy' });
    expect(r.invalid.sort()).toEqual(['blob_reaction', 'life_area', 'tone_toward_blob', 'trust_change', 'user_intensity']);
  });

  it('normalizes probabilities and fills missing options with 0', () => {
    const r = validateResponse(questions, { answers: { life_area: { type: 'choice', choice: 'work', probabilities: { work: 3, self: 1 } } } }, 'm');
    const a = r.answers.life_area;
    expect(a.type).toBe('choice');
    if (a.type !== 'choice') return;
    expect(a.probabilities).toEqual({ work: 0.75, relationships: 0, health: 0, self: 0.25, other: 0 });
    // confidence computed as 1 - H/ln(N) when missing
    expect(a.confidence).toBeGreaterThan(0.6);
    expect(a.confidence).toBeLessThan(0.7);
  });

  it('picks the most likely option when `choice` is missing or not an option', () => {
    const r = validateResponse(questions, { answers: { trust_change: { choice: 'banana', probabilities: { decrease: 0.1, stay: 0.2, increase: 0.7 } } } }, 'm');
    expect(r.answers.trust_change).toMatchObject({ choice: 'increase' });
  });

  it('rebuilds a score distribution from only `score`, and a score from only probabilities', () => {
    const r = validateResponse(
      questions,
      { answers: { user_valence: { type: 'score', score: 2.5 }, user_intensity: { type: 'score', probabilities: { '0': 0, '1': 0, '2': 0, '3': 1, '4': 0 } } } },
      'm',
    );
    const v = r.answers.user_valence;
    const i = r.answers.user_intensity;
    if (v.type !== 'score' || i.type !== 'score') throw new Error('wrong type');
    expect(v.probabilities).toMatchObject({ '2': 0.5, '3': 0.5 });
    expect(v.legend['0']).toBe('Very negative');
    expect(i.score).toBe(3);
  });

  it('rejects answers of the wrong type and clamps noul', () => {
    const r = validateResponse(questions, { answers: { surprising: { type: 'noul', noul: 1.7 }, user_emotion: { type: 'noul', noul: 0.5 } } }, 'm');
    expect(r.answers.surprising).toEqual({ type: 'noul', noul: 1 });
    expect(r.invalid).toContain('user_emotion');
  });

  it('throws on a response without answers', () => {
    expect(() => validateResponse(questions, { error: 'x' }, 'm')).toThrow(DecisionError);
    expect(() => validateResponse(questions, { answers: { nope: {} } }, 'm')).toThrow(/no usable answers/);
  });
});

describe('toSignals', () => {
  it('maps scores and probabilities to domain values', () => {
    const s = toSignals(validateResponse(questions, realLaya, 'laya').answers);
    expect(s.userEmotionTop).toBe('joy');
    expect(s.userValence).toBeCloseTo(0.8162, 3); // score 2.8162 on 0..4 -> -2..+2
    expect(s.distress).toBeCloseTo(0.02);
    expect(s.surprising).toBeCloseTo(1.85e-5);
    // Missing answers fall back to neutral defaults, with warnings.
    expect(s.tone.neutral).toBe(1);
    expect(s.trustChange.stay).toBe(1);
    expect(s.blobReaction.calm).toBe(1);
    expect(s.warnings).toEqual(expect.arrayContaining(['tone_toward_blob', 'trust_change', 'blob_reaction', 'user_intensity']));
  });

  it('reads yes/no questions asked either as noul or as a two-option choice', () => {
    const asNoul = validateResponse(questions, { answers: { surprising: { type: 'noul', noul: 0.7 } } }, 'm').answers;
    expect(yesProbability(asNoul, 'surprising')).toBe(0.7);
    const choiceQs = buildQuestions({ surprising: { askAs: 'choice' }, distress_flag: { askAs: 'noul' } });
    expect(choiceQs.surprising).toMatchObject({ type: 'choice', criteria: { a: expect.any(String), b: expect.any(String) } });
    expect(choiceQs.distress_flag.type).toBe('noul');
    const asChoice = validateResponse(choiceQs, { answers: { surprising: { type: 'choice', choice: 'a', probabilities: { a: 0.64, b: 0.36 } } } }, 'm').answers;
    expect(yesProbability(asChoice, 'surprising')).toBe(0.64);
  });
});

describe('questions', () => {
  it('stay within the wire-format limits', () => {
    const names = Object.keys(questions);
    expect(names.length).toBeGreaterThanOrEqual(1);
    expect(names.length).toBeLessThanOrEqual(64);
    for (const q of Object.values(questions)) {
      const n = q.type === 'choice' ? Object.keys(q.criteria).length : q.type === 'score' ? q.criteria.length : 2;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(26);
    }
    expect(Object.keys((questions.user_emotion as { criteria: object }).criteria)).toContain('none');
    expect(Object.keys((questions.life_area as { criteria: object }).criteria)).toContain('other');
  });
});
