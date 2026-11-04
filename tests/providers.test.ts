import { describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config';
import { Catalog, isCloudName } from '../server/decision/catalog';
import { normalizeAnswer, validateResponse } from '../server/decision/parse';
import { mockAnswers, readCues } from '../server/decision/providers/mock';
import { buildQuestions } from '../server/decision/questions';
import { createProvider, loadProviderFactories } from '../server/decision/registry';
import { guessLanguage } from '../server/language';

const ctx = { config: loadConfig({ DECISION_PROVIDER: 'mock' }), catalog: new Catalog(), log: () => undefined };

describe('provider registry', () => {
  it('discovers every provider file in providers/', async () => {
    const all = await loadProviderFactories();
    expect([...all.keys()].sort()).toEqual(['mock', 'ollama']);
  });

  it('explains unknown providers', async () => {
    await expect(createProvider('nope', ctx, 'x')).rejects.toThrow(/Available providers: mock, ollama/);
  });
});

describe('mock provider', () => {
  it('answers in the exact wire format for every question', async () => {
    const qs = buildQuestions();
    const raw = mockAnswers({ new_message: 'I am so happy today!' }, qs);
    for (const [name, q] of Object.entries(qs)) {
      const a = raw[name] as unknown as Record<string, unknown>;
      expect(a.type).toBe(q.type);
      expect(normalizeAnswer(q, a)).toBeDefined();
      if (q.type === 'choice') {
        expect(Object.keys(a.probabilities as object).sort()).toEqual(Object.keys(q.criteria).sort());
        const sum = Object.values(a.probabilities as Record<string, number>).reduce((s, v) => s + v, 0);
        expect(sum).toBeCloseTo(1, 6);
        expect(a.confidence).toBeGreaterThanOrEqual(0);
        expect(a.confidence).toBeLessThanOrEqual(1);
      }
      if (q.type === 'score') expect(Object.keys(a.legend as object)).toEqual(['0', '1', '2', '3', '4']);
      if (q.type === 'noul') expect(typeof a.noul).toBe('number');
    }
    expect(validateResponse(qs, { model: 'mock', answers: raw }, 'mock').invalid).toEqual([]);
  });

  it('is plausible: cues bias the answers', () => {
    const qs = buildQuestions();
    const pick = (text: string, q: string) => {
      const counts: Record<string, number> = {};
      for (let i = 0; i < 40; i++) {
        const a = mockAnswers({ new_message: text }, qs)[q] as { choice: string };
        counts[a.choice] = (counts[a.choice] ?? 0) + 1;
      }
      return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    };
    expect(pick('I am so happy and excited, what a wonderful day!', 'user_emotion')).toBe('joy');
    expect(pick('You are a stupid useless blob.', 'tone_toward_blob')).toBe('hostile');
    expect(pick('Thank you, Mote, you are sweet.', 'trust_change')).toBe('increase');
    expect(pick('I finally finished it, I did it!', 'situation')).toBe('win');
    expect(pick('You are a stupid useless blob.', 'situation')).toBe('insult');
    expect(pick('I finally finished it, I did it!', 'blob_intent')).toBe('celebrate');
    expect(pick('You are a stupid useless blob.', 'blob_intent')).toMatch(/give_space|hide/);
    expect(readCues('I want to kill myself').crisis).toBe(true);
  });

  it('works through the provider interface', async () => {
    const p = await createProvider('mock', ctx, 'ignored');
    expect((await p.status()).state).toBe('ready');
    const r = await p.ask({ new_message: 'hello' }, buildQuestions());
    expect(r.model).toBe('mock');
    expect(Object.keys(r.answers).length).toBe(11);
  });
});

describe('catalog', () => {
  const catalog = new Catalog();

  it('has a complete profile for every model', () => {
    for (const m of catalog.models) {
      for (const k of ['name', 'publisher', 'parameters', 'downloadSize', 'minOllama', 'license', 'tier', 'contextNote'] as const) expect(m[k], `${m.name}.${k}`).toBeTruthy();
      expect(m.inputTypes.length).toBeGreaterThan(0);
      expect(m.languages.length).toBeGreaterThan(0);
      expect(m.maxStateTokens).toBeGreaterThan(100);
      expect(m.minOllama).toMatch(/^0\.\d+\.\d+$/);
    }
    for (const required of ['laya', 'laya:322m-multilingual-bf16', 'tev1:0.8b', 'tev1', 'nimble', 'nimble-v3', 'd3:2b', 'd3', 'd3:9b', 'd3:27b', 'd1', 'd1-omni', 'pplx-decider-flash', 'kev', 'clef-flash', 'clef']) {
      expect(catalog.find(required), required).toBeDefined();
    }
  });

  it('matches aliases and tag variants, and recognises cloud tags', () => {
    expect(catalog.find('laya:latest')?.name).toBe('laya');
    expect(catalog.find('laya:322m-multilingual-mlx-fp16')?.name).toBe('laya:322m-multilingual-bf16');
    expect(catalog.find('tev1:4b')?.name).toBe('tev1');
    expect(catalog.find('nimble-v3:9b-q4_K_M')?.name).toBe('nimble-v3');
    expect(catalog.find('kev:0.8b-q8_0')?.name).toBe('kev');
    expect(catalog.find('unknown-model')).toBeUndefined();
    expect(isCloudName('clef:cloud')).toBe(true);
    expect(isCloudName('clef:27b-cloud')).toBe(true);
    expect(isCloudName('clef')).toBe(false);
    expect(catalog.profileFor('mystery', { contextTokens: 2048 }).maxStateTokens).toBeLessThan(1000);
  });

  it('has the Lite / Balanced / Best presets', () => {
    expect(catalog.presets.map((p) => p.id)).toEqual(['lite', 'balanced', 'best']);
    expect(catalog.presets[1].models[0].model).toBe('tev1');
    expect(catalog.presets[2].models[0].model).toBe('nimble');
  });
});

describe('language guess', () => {
  it('keeps English (and short or mixed text) as English', () => {
    expect(guessLanguage('I had a pretty rough day at work but the evening was nice.').nonEnglish).toBe(false);
    expect(guessLanguage('ok').nonEnglish).toBe(false);
    expect(guessLanguage('Café with Ana, then a long walk. Felt good.').nonEnglish).toBe(false);
  });

  it('flags clearly non-English text', () => {
    expect(guessLanguage('Hoy estoy muy cansada porque el trabajo fue muy difícil y no dormí bien.').nonEnglish).toBe(true);
    expect(guessLanguage("Aujourd'hui je suis très fatigué et je ne veux pas travailler.").nonEnglish).toBe(true);
    expect(guessLanguage('今日はとても疲れました。仕事が大変でした。').nonEnglish).toBe(true);
    expect(guessLanguage('Сегодня был очень тяжёлый день на работе.').nonEnglish).toBe(true);
  });
});
