import { describe, expect, it } from 'vitest';
import { BEHAVIOR_DURATION, behaviorFrame, type BehaviorKind } from '../client/src/blob/gestures';
import { nextThinkDelay } from '../client/src/mind/Mind';
import { IDLE_ACTION_LABELS, IDLE_LINES, INTENT_LABELS, lineFor, SITUATION_LINES } from '../client/src/mind/lines';
import { Clock } from '../server/clock';
import { loadConfig } from '../server/config';
import { MoteDb } from '../server/db';
import { Catalog } from '../server/decision/catalog';
import { createProvider } from '../server/decision/registry';
import { buildIdleQuestions, buildQuestions } from '../server/decision/questions';
import { buildIdleState, pickMemory, timeOfDay } from '../server/mind';
import { initialMood, applyMessage } from '../server/mood/engine';
import { MoteService } from '../server/service';
import { decideIdleAction, decideIntent } from '../shared/decide';
import { ARCHETYPES, IDLE_ACTIONS, IDLE_THOUGHTS, INTENTS, SITUATIONS, type JournalEntry } from '../shared/types';
import { DEFAULT_VISUAL } from '../shared/visuals';
import { DAY, HOUR, hostileSignals, signals, temperament } from './helpers';

const NOW = new Date(2026, 10, 4, 15, 0, 0).getTime(); // local 3 pm

function entry(id: number, text: string, ageMs: number, intensity: number, distress = false): JournalEntry {
  return {
    id,
    createdAt: NOW - ageMs,
    text,
    provider: 'mock',
    model: 'mock',
    answers: null,
    signals: signals({ userIntensity: intensity }),
    visual: DEFAULT_VISUAL,
    lifeArea: 'other',
    userEmotion: 'calm',
    distress,
    skipped: null,
  };
}

describe('background mind: state and memory', () => {
  it('tells the time of day in code', () => {
    const at = (h: number) => new Date(2026, 10, 4, h, 30).getTime();
    expect(timeOfDay(at(2))).toBe('late night');
    expect(timeOfDay(at(9))).toBe('morning');
    expect(timeOfDay(at(15))).toBe('afternoon');
    expect(timeOfDay(at(19))).toBe('evening');
    expect(timeOfDay(at(23))).toBe('night');
  });

  it('remembers recent, strong entries, never ones that raised a distress flag', () => {
    const entries = [entry(1, 'quiet day', 10 * DAY, 0.1), entry(2, 'got the job!!', 2 * HOUR, 0.95), entry(3, 'crisis entry', HOUR, 1, true)];
    const counts: Record<number, number> = {};
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 400; i++) {
      const m = pickMemory(entries, NOW, [], rnd)!;
      counts[m.id] = (counts[m.id] ?? 0) + 1;
    }
    expect(counts[3]).toBeUndefined();
    expect(counts[2]).toBeGreaterThan(counts[1] ?? 0);
    expect(pickMemory([entry(4, 'too old', 20 * DAY, 1)], NOW, [])).toBeNull();
  });

  it('rarely brings back what it just remembered', () => {
    const entries = [entry(1, 'a', HOUR, 0.8), entry(2, 'b', HOUR, 0.8)];
    let hits = 0;
    for (let i = 0; i < 300; i++) if (pickMemory(entries, NOW, [1])!.id === 1) hits++;
    expect(hits).toBeLessThan(90);
  });

  it('builds a full idle state, or a minimal one for small models', () => {
    const t = temperament({ archetype: 'moody' });
    const mood = applyMessage(initialMood(t, NOW - DAY), t, hostileSignals(), NOW - DAY).mood;
    const memory = entry(7, 'I miss my grandmother so much. The house feels empty without her.', 3 * HOUR, 0.7);
    const full = buildIdleState({ mood, temperament: t, now: NOW, lastEntryAt: NOW - 3 * HOUR, memory }, { compactState: false, moodStyle: 'words' });
    expect(full).toMatchObject({ time_of_day: 'afternoon', last_message_from_writer: '3 hours ago', memory: { when: '3 hours ago' } });
    expect(full.temperament).toContain('moody');
    expect((full.grudges as string[])[0]).toMatch(/insulted/);
    const small = buildIdleState({ mood, temperament: t, now: NOW, lastEntryAt: null, memory: null }, { compactState: true, moodStyle: 'numbers' });
    expect(Object.keys(small).sort()).toEqual(['current_mood', 'last_message_from_writer', 'time_of_day']);
    expect(small.current_mood).toMatch(/^valence/);
    expect(small.last_message_from_writer).toBe('never');
  });

  it('only offers memory thoughts when there is a memory, within the option limits', () => {
    const withMemory = buildIdleQuestions(true).idle_thought;
    const without = buildIdleQuestions(false).idle_thought;
    if (withMemory.type !== 'choice' || without.type !== 'choice') throw new Error('expected choice');
    expect(Object.keys(withMemory.criteria)).toContain('remember_good');
    expect(Object.keys(without.criteria)).not.toContain('remember_good');
    for (const q of [...Object.values(buildIdleQuestions(true)), ...Object.values(buildQuestions())]) {
      const n = q.type === 'choice' ? Object.keys(q.criteria).length : q.type === 'score' ? q.criteria.length : 2;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(26);
    }
  });

  it('thinks end to end with the mock provider, without changing the mood', async () => {
    const config = { ...loadConfig({ DECISION_PROVIDER: 'mock' }), dbPath: ':memory:' };
    const db = new MoteDb(':memory:');
    const catalog = new Catalog();
    const provider = await createProvider('mock', { config, catalog, log: () => {} }, 'mock');
    const service = new MoteService(db, provider, catalog, config, new Clock(db), () => {});
    await service.state();
    await service.message('I finally finished the project and I feel amazing!');
    const before = db.activeBlob()!.mood;
    const r = await service.think();
    expect(r.skipped).toBeNull();
    expect(Object.keys(r.thought!.probabilities).sort()).toEqual([...IDLE_THOUGHTS].sort());
    expect(Object.keys(r.action!.probabilities).sort()).toEqual([...IDLE_ACTIONS].sort());
    expect(r.memory?.text).toContain('finished the project');
    expect(db.activeBlob()!.mood).toEqual(before);
    db.close();
  });
});

describe('decisions', () => {
  const sit = (k: (typeof SITUATIONS)[number]) => Object.fromEntries(SITUATIONS.map((s) => [s, s === k ? 1 : 0])) as Record<(typeof SITUATIONS)[number], number>;
  const intent = (top: (typeof INTENTS)[number], p: number) =>
    Object.fromEntries(INTENTS.map((i) => [i, i === top ? p : (1 - p) / (INTENTS.length - 1)])) as Record<(typeof INTENTS)[number], number>;
  const best = (d: Record<string, number>) => Object.entries(d).sort((a, b) => b[1] - a[1])[0][0];

  it('keep odd model suggestions in check (Laya suggested "play" after an insult)', () => {
    expect(best(decideIntent(intent('play', 0.81), sit('insult'), 'curious'))).toMatch(/give_space|hide/);
    expect(best(decideIntent(intent('play', 0.41), sit('self_criticism'), 'cheerful'))).toMatch(/comfort|come_closer/);
  });

  it('still follow the model when its suggestion fits', () => {
    expect(best(decideIntent(intent('celebrate', 0.84), sit('win'), 'stoic'))).toBe('celebrate');
    expect(best(decideIntent(intent('rest', 0.98), sit('goodnight'), 'curious'))).toBe('rest');
    expect(best(decideIntent(intent('hide', 0.5), sit('insult'), 'stoic'))).toBe('hide');
  });

  it('let temperament show: an anxious Mote hides from an insult, a stoic one stays to listen', () => {
    const neutral = intent('listen', 0.2);
    expect(best(decideIntent(neutral, sit('insult'), 'anxious'))).toBe('hide');
    expect(best(decideIntent(neutral, sit('insult'), 'stoic'))).not.toBe('hide');
  });

  it('pick fitting idle actions: naps when sleepy at night, sulks when hurt', () => {
    const flat = Object.fromEntries(IDLE_ACTIONS.map((a) => [a, 1 / IDLE_ACTIONS.length])) as Record<(typeof IDLE_ACTIONS)[number], number>;
    const thought = (k: (typeof IDLE_THOUGHTS)[number]) => Object.fromEntries(IDLE_THOUGHTS.map((t) => [t, t === k ? 1 : 0])) as Record<(typeof IDLE_THOUGHTS)[number], number>;
    expect(best(decideIdleAction(flat, thought('sleepy'), 2))).toBe('nap');
    expect(best(decideIdleAction(flat, thought('still_hurt'), 15))).toBe('sulk');
    expect(best(decideIdleAction(flat, thought('miss_writer'), 15))).toBe('wait_by_text');
  });
});

describe('behaviors', () => {
  const KINDS = Object.keys(BEHAVIOR_DURATION) as BehaviorKind[];
  it('ease in and out, with no jumps', () => {
    for (const k of KINDS) {
      const dur = BEHAVIOR_DURATION[k];
      const mag = (t: number) => {
        const f = behaviorFrame(k, t);
        return Math.max(...Object.values(f.pose).map(Math.abs), Math.abs(f.brightness), Math.abs(f.speed), f.sleepy, f.halo, f.grey);
      };
      expect(mag(0), k).toBe(0);
      expect(mag(dur - 0.001), k).toBeLessThan(0.002);
      expect(mag(dur + 1), k).toBe(0);
      let prev = behaviorFrame(k, 0);
      for (let t = 1 / 60; t < dur; t += 1 / 60) {
        const f = behaviorFrame(k, t);
        for (const key of Object.keys(f.pose) as (keyof typeof f.pose)[]) expect(Math.abs(f.pose[key] - prev.pose[key]), `${k}.${key}`).toBeLessThan(0.05);
        prev = f;
      }
    }
  });

  it('cover every decision and idle action', () => {
    for (const k of [...INTENTS, ...IDLE_ACTIONS]) expect(BEHAVIOR_DURATION[k as BehaviorKind], k).toBeGreaterThan(0);
  });
});

describe('thought lines', () => {
  it('exist for every kind of moment, idle thought, decision and action', () => {
    for (const k of SITUATIONS) expect(SITUATION_LINES[k].all.length, k).toBeGreaterThan(0);
    for (const k of IDLE_THOUGHTS) expect(IDLE_LINES[k].all.length, k).toBeGreaterThan(0);
    for (const k of INTENTS) expect(INTENT_LABELS[k]).toBeTruthy();
    for (const k of IDLE_ACTIONS) expect(IDLE_ACTION_LABELS[k]).toBeTruthy();
  });

  it('are stable for a seed (the journal shows the same thought) and vary across entries and temperaments', () => {
    expect(lineFor(SITUATION_LINES.win, 'stoic', 42)).toBe(lineFor(SITUATION_LINES.win, 'stoic', 42));
    const seen = new Set<string>();
    for (const a of ARCHETYPES) for (let seed = 0; seed < 40; seed++) seen.add(lineFor(SITUATION_LINES.win, a, seed));
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it('stay short enough to float', () => {
    const all = [...Object.values(SITUATION_LINES), ...Object.values(IDLE_LINES)].flatMap((l) => Object.values(l).flat());
    for (const line of all) expect(line.length, line).toBeLessThanOrEqual(32);
  });
});

describe('thinking schedule', () => {
  it('thinks less often with slow models, within 1.5 to 15.5 minutes', () => {
    expect(nextThinkDelay(2000, () => 0)).toBe(90_000);
    expect(nextThinkDelay(22_000, () => 0)).toBe(264_000);
    expect(nextThinkDelay(600_000, () => 1)).toBe(15 * 60_000 + 30_000);
  });
});
