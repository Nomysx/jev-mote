import { describe, expect, it } from 'vitest';
import type { Clock } from '../server/clock';
import { loadConfig } from '../server/config';
import { MoteDb } from '../server/db';
import { Catalog } from '../server/decision/catalog';
import { validateResponse } from '../server/decision/parse';
import { mockAnswers } from '../server/decision/providers/mock';
import { buildDreamQuestions } from '../server/decision/questions';
import type { DecisionProvider } from '../server/decision/types';
import { buildDreamState, dreamFromAnswers, isHard, pickDreamSeeds } from '../server/life/dreams';
import { applyDream, applyThought } from '../server/life/effects';
import { advanceLife, describeBody, dreamDue, fallAsleep, initialLife, isDreaming, longing, noteEntry, sleepPressure, wakeUp } from '../server/life/engine';
import { applyMessage, decay, grudgeTotal, initialMood } from '../server/mood/engine';
import { MoteService } from '../server/service';
import { decideIdleAction } from '../shared/decide';
import { dreamFragments } from '../shared/dream';
import { DREAM_ENDINGS, DREAM_EVENTS, EMOTIONS, IDLE_ACTIONS, IDLE_THOUGHTS, type Dream, type IdleThought, type JournalEntry } from '../shared/types';
import { applyBody, DEFAULT_VISUAL } from '../shared/visuals';
import { DAY, HOUR, hostileSignals, kindSignals, signals, temperament } from './helpers';

const MIN = 60_000;
/** Local time on a day in November 2026. */
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
const hourOf = (ms: number) => new Date(ms).getHours() + new Date(ms).getMinutes() / 60;

function lifeAt(t: number, over: Partial<ReturnType<typeof initialLife>> = {}) {
  return { ...initialLife(t), ...over };
}

describe('body clock', () => {
  it('sleeps at night and wakes in the morning, even with the page closed', () => {
    const start = lifeAt(at(4, 8), { energy: 1, lastActiveAt: at(4, 9), lastEntryAt: at(4, 9), lastSeenAt: at(4, 9) });
    const { life, transitions } = advanceLife(start, at(5, 10), { arousal: 0.3 });
    expect(transitions.map((t) => t.kind)).toEqual(['sleep', 'wake']);
    const [sleep, wake] = transitions;
    expect(hourOf(sleep.at) >= 21 || hourOf(sleep.at) < 1, `fell asleep at ${hourOf(sleep.at)}`).toBe(true);
    expect(sleep.cause).toBe('night');
    expect(hourOf(wake.at)).toBeGreaterThanOrEqual(6);
    expect(hourOf(wake.at)).toBeLessThan(9);
    expect(wake.cause).toBe('morning');
    expect(wake.sleptMs!).toBeGreaterThan(6 * HOUR);
    expect(life.asleep).toBe(false);
    expect(life.energy).toBeGreaterThan(0.8);
  });

  it('never falls asleep while the writer is active, but soon after they stop', () => {
    let life = lifeAt(at(4, 23, 30), { energy: 0.2 });
    for (let t = at(4, 23, 31); t <= at(5, 0, 30); t += MIN) {
      life.lastActiveAt = t; // typing
      life = advanceLife(life, t, { arousal: 0.3 }).life;
      expect(life.asleep).toBe(false);
    }
    const quiet = advanceLife(life, at(5, 1, 5), { arousal: 0.3 });
    expect(quiet.life.asleep).toBe(true);
    expect(quiet.transitions[0].at - at(5, 0, 30)).toBeGreaterThanOrEqual(20 * MIN);
  });

  it('stays awake in the day, and naps end within an hour and a half', () => {
    const day = advanceLife(lifeAt(at(4, 10), { energy: 0.3, lastActiveAt: at(4, 9) }), at(4, 17), { arousal: 0.3 });
    expect(day.transitions).toEqual([]);
    const napping = lifeAt(at(4, 14), { energy: 0.2 });
    fallAsleep(napping, at(4, 14), 'nap');
    const woke = advanceLife(napping, at(4, 17), { arousal: 0.3 }).transitions.find((t) => t.kind === 'wake')!;
    expect(woke.at - at(4, 14)).toBeLessThanOrEqual(90 * MIN);
    expect(woke.cause).toBe('rested');
  });

  it('dreams in REM phases, not in the first hour, and at most twice a night', () => {
    const life = lifeAt(at(4, 23));
    fallAsleep(life, at(4, 23), 'night');
    expect(isDreaming(life, at(4, 23, 30))).toBe(false);
    expect(isDreaming(life, at(5, 0, 10))).toBe(true); // 70 min: the end of the first cycle
    expect(dreamDue(life, at(5, 0, 10))).toBe(true);
    life.lastDreamAt = at(5, 0, 10);
    life.dreamsThisSleep = 1;
    expect(dreamDue(life, at(5, 0, 20))).toBe(false); // same REM phase
    expect(dreamDue(life, at(5, 1, 40))).toBe(true); // the next one
    life.dreamsThisSleep = 2;
    expect(dreamDue(life, at(5, 3, 10))).toBe(false);
  });

  it('misses the writer more the longer they are gone and the more it trusts them; writing resets it', () => {
    const life = lifeAt(at(4, 9), { lastEntryAt: at(4, 9), lastSeenAt: at(4, 9) });
    expect(longing(lifeAt(at(4, 9)), 0.9, at(6, 9))).toBe(0); // nobody to miss before the first entry
    expect(longing(life, 0.2, at(4, 10))).toBeLessThan(longing(life, 0.2, at(4, 17)));
    expect(longing(life, 0.9, at(4, 17))).toBeGreaterThan(longing(life, 0.2, at(4, 17)));
    expect(longing(life, 0.9, at(7, 9))).toBeLessThanOrEqual(1);
    noteEntry(life, at(4, 17), 0.5);
    expect(longing(life, 0.9, at(4, 17))).toBe(0);
  });

  it('remembers a dream it never got to dream, and forgets it after half a day', () => {
    const life = lifeAt(at(4, 23));
    fallAsleep(life, at(4, 23), 'night');
    wakeUp(life, at(5, 7), 'morning');
    expect(life.dreamPending).toBe(true);
    expect(advanceLife(life, at(5, 12), { arousal: 0.3 }).life.dreamPending).toBe(true);
    expect(advanceLife(life, at(5, 20), { arousal: 0.3 }).life.dreamPending).toBe(false);
  });

  it('simulates long gaps quickly', () => {
    const t0 = performance.now();
    const { life } = advanceLife(lifeAt(at(1, 9)), at(1, 9) + 60 * DAY, { arousal: 0.4 });
    expect(performance.now() - t0).toBeLessThan(500);
    expect(life.energy).toBeGreaterThanOrEqual(0);
    expect(life.energy).toBeLessThanOrEqual(1);
    expect(sleepPressure(1, 3)).toBeGreaterThan(sleepPressure(1, 15));
  });

  it('describes the body in words, or numbers for models that copy words', () => {
    const n = { energy: 0.3, boredom: 0.7, longing: 0.6 };
    expect(describeBody(n)).toBe('tired, misses the writer a lot, restless');
    expect(describeBody({ energy: 0.05, boredom: 0, longing: 0 })).toBe('exhausted');
    expect(describeBody(n, 'numbers')).toBe('energy 0.30, missing writer 0.60, restless 0.70');
  });
});

describe('what inner life does to it', () => {
  const t = temperament({ grudgeMemory: 0.5 });
  const now = at(4, 15);
  const thought = (k: IdleThought) => Object.fromEntries(IDLE_THOUGHTS.map((x) => [x, x === k ? 1 : 0])) as Record<IdleThought, number>;

  it('thoughts nudge the mood a little, toward what they are about', () => {
    const m = initialMood(t, now);
    const good = applyThought(m, t, thought('remember_good'), now);
    const worried = applyThought(m, t, thought('worried'), now);
    expect(good.valence).toBeGreaterThan(m.valence);
    expect(worried.valence).toBeLessThan(m.valence);
    expect(Math.abs(good.valence - m.valence)).toBeLessThanOrEqual(0.06);
    expect(good.emotions.joy).toBeGreaterThan(m.emotions.joy);
  });

  it('letting go eases grudges; dwelling on a hurt never deepens one', () => {
    const hurt = applyMessage(initialMood(t, now - HOUR), t, hostileSignals(), now - HOUR).mood;
    const base = grudgeTotal(decay(hurt, t, now).grudges);
    expect(grudgeTotal(applyThought(hurt, t, thought('forgiving'), now).grudges)).toBeLessThan(base);
    expect(grudgeTotal(applyThought(hurt, t, thought('still_hurt'), now).grudges)).toBeLessThanOrEqual(base);
  });

  const dreamOf = (feeling: (typeof EMOTIONS)[number], ending: (typeof DREAM_ENDINGS)[number]) => ({
    feeling: Object.fromEntries(EMOTIONS.map((e) => [e, e === feeling ? 1 : 0])) as Dream['feeling'],
    ending: Object.fromEntries(DREAM_ENDINGS.map((e) => [e, e === ending ? 1 : 0])) as Dream['ending'],
  });

  it('sleeping on a hard day helps: a calm dream eases grudges', () => {
    const hurt = applyMessage(initialMood(t, now - HOUR), t, hostileSignals(), now - HOUR).mood;
    const plain = decay(hurt, t, now);
    const out = applyDream(hurt, t, dreamOf('calm', 'peaceful'), true, now);
    expect(out.effect).toBe('processed');
    expect(grudgeTotal(out.mood.grudges)).toBeLessThan(grudgeTotal(plain.grudges));
    expect(out.mood.valence).toBeGreaterThan(plain.valence);
  });

  it('a nightmare leaves it jumpy; a sweet dream leaves it lighter', () => {
    const m = initialMood(t, now);
    const bad = applyDream(m, t, dreamOf('fear', 'woke_suddenly'), false, now);
    expect(bad.effect).toBe('nightmare');
    expect(bad.mood.arousal).toBeGreaterThan(m.arousal);
    const sweet = applyDream(m, t, dreamOf('joy', 'found'), false, now);
    expect(sweet.effect).toBe('sweet');
    expect(sweet.mood.valence).toBeGreaterThan(m.valence);
  });
});

function entry(id: number, text: string, createdAt: number, over: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id,
    createdAt,
    text,
    provider: 'mock',
    model: 'mock',
    answers: null,
    signals: signals({ userIntensity: 0.5 }),
    visual: DEFAULT_VISUAL,
    lifeArea: 'other',
    userEmotion: 'calm',
    distress: false,
    skipped: null,
    recalls: 0,
    ...over,
  };
}

describe('dreams', () => {
  const now = at(5, 3);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

  it('come from the last days, hard and strong ones more often, never from a distress entry', () => {
    const hard = entry(1, 'you are useless', now - 5 * HOUR, { signals: hostileSignals() });
    const mild = entry(2, 'had a sandwich', now - 30 * HOUR, { signals: signals({ userIntensity: 0.1 }) });
    const crisis = entry(3, 'crisis', now - HOUR, { distress: true });
    const old = entry(4, 'long ago', now - 20 * DAY);
    const core = entry(5, 'the day we moved', now - 40 * DAY, { recalls: 4 });
    expect(isHard(hard)).toBe(true);
    const counts: Record<number, number> = {};
    for (let i = 0; i < 500; i++) for (const e of pickDreamSeeds([hard, mild, crisis, old, core], now, rnd)) counts[e.id] = (counts[e.id] ?? 0) + 1;
    expect(counts[3]).toBeUndefined();
    expect(counts[4]).toBeUndefined();
    expect(counts[1]).toBeGreaterThan(counts[2]);
    expect(counts[5]).toBeGreaterThan(0); // a core memory can come back
    for (let i = 0; i < 50; i++) {
      const seeds = pickDreamSeeds([hard, mild, core], now, rnd);
      expect(seeds.length).toBeLessThanOrEqual(2);
      expect(new Set(seeds.map((e) => e.id)).size).toBe(seeds.length);
    }
    expect(pickDreamSeeds([], now)).toEqual([]);
  });

  it('put the memory first in the state, and keep small models minimal', () => {
    const t = temperament();
    const mood = initialMood(t, now);
    const e = entry(1, 'I failed my exam today and my sister laughed at me. '.repeat(10), now - 6 * HOUR);
    const full = buildDreamState({ seeds: [e], mood, temperament: t, now }, { compactState: false, moodStyle: 'words' });
    expect(Object.keys(full)[0]).toBe('memory');
    expect(full.temperament).toBeTruthy();
    const small = buildDreamState({ seeds: [e], mood, temperament: t, now }, { compactState: true, moodStyle: 'numbers' });
    expect(Object.keys(small)).toEqual(['memory', 'mood_before_sleep']);
    expect((small.memory as { text: string }).text.length).toBeLessThanOrEqual(160);
    expect(small.mood_before_sleep).toMatch(/^valence/);
  });

  it('ask questions within the wire limits, and survive missing answers', () => {
    for (const q of Object.values(buildDreamQuestions())) {
      const n = q.type === 'choice' ? Object.keys(q.criteria).length : 0;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(26);
    }
    const d = dreamFromAnswers({}, [], 'mock', false);
    expect(d.event.floating).toBe(1);
    expect(Object.keys(d.event).sort()).toEqual([...DREAM_EVENTS].sort());
    expect(d.memories).toEqual([]);
  });

  it('carry words from the entries, never filler', () => {
    const f = dreamFragments(['I failed my exam today and my sister laughed. It was really awful.']);
    expect(f).toEqual(expect.arrayContaining(['failed', 'sister', 'laughed', 'awful']));
    expect(f).not.toContain('today');
    expect(f).not.toContain('really');
    expect(dreamFragments(['Я очень скучаю по бабушке'])).toEqual(expect.arrayContaining(['скучаю', 'бабушке']));
    expect(dreamFragments(['a b c'])).toEqual([]);
    expect(dreamFragments(['one two three four five six seven eight nine ten eleven twelve'], 6)).toHaveLength(6);
  });
});

describe('the body decides too', () => {
  const flat = Object.fromEntries(IDLE_ACTIONS.map((a) => [a, 1 / IDLE_ACTIONS.length])) as Record<(typeof IDLE_ACTIONS)[number], number>;
  const content = Object.fromEntries(IDLE_THOUGHTS.map((k) => [k, k === 'content' ? 1 : 0])) as Record<IdleThought, number>;
  const best = (d: Record<string, number>) => Object.entries(d).sort((a, b) => b[1] - a[1])[0][0];

  it('a tired Mote naps, a restless one wanders, one that misses you waits by the text', () => {
    expect(best(decideIdleAction(flat, content, 15, { energy: 0.1, boredom: 0, longing: 0 }))).toBe('nap');
    expect(best(decideIdleAction(flat, content, 15, { energy: 0.9, boredom: 0.9, longing: 0 }))).toBe('wander');
    expect(best(decideIdleAction(flat, content, 15, { energy: 0.9, boredom: 0, longing: 0.9 }))).toBe('wait_by_text');
  });

  it('looks asleep while asleep and a little droopy when tired, keeping its colors', () => {
    const v = { ...DEFAULT_VISUAL, speed: 1, hueA: 0.3, bounce: 0.6 };
    const asleep = applyBody(v, { asleep: true, tired: 0 });
    expect(asleep.speed).toBeLessThan(0.3);
    expect(asleep.bounce).toBeLessThan(0.15);
    expect(asleep.hueA).toBe(0.3);
    const tired = applyBody(v, { asleep: false, tired: 1 });
    expect(tired.speed).toBeLessThan(v.speed);
    expect(tired.droop).toBeGreaterThan(v.droop);
    expect(applyBody(v, { asleep: false, tired: 0 })).toEqual(v);
  });
});

// ---- End to end, with an instant mock provider and a controllable clock ----

function instantMock(): DecisionProvider {
  const catalog = new Catalog();
  return {
    providerId: 'mock',
    model: 'mock',
    profile: () => catalog.profileFor('mock'),
    status: async () => ({ state: 'ready', provider: 'mock', model: 'mock', message: 'mock', checkedAt: Date.now() }),
    ask: async (state, questions) => validateResponse(questions, { model: 'mock', answers: mockAnswers(state, questions) }, 'mock'),
    setModel: async () => ({ state: 'ready', provider: 'mock', model: 'mock', message: 'mock', checkedAt: Date.now() }),
    listModels: async () => [],
  };
}

function setup(start: number) {
  const db = new MoteDb(':memory:');
  const clock = { t: start, offsetMs: 0, now() { return this.t; }, advance(ms: number) { this.t += ms; }, reset() {} };
  const config = { ...loadConfig({ DECISION_PROVIDER: 'mock' }), dbPath: ':memory:' };
  const service = new MoteService(db, instantMock(), new Catalog(), config, clock as unknown as Clock, () => {});
  return { db, clock, service };
}

describe('Mote lives on its own (mock provider)', () => {
  it('thinks, falls asleep, dreams about your day, wakes, and tells you what it did', async () => {
    const { db, clock, service } = setup(at(4, 20));
    await service.state();
    clock.t = at(4, 20, 5);
    const r = await service.message('I finally finished the project at work and I feel amazing!');
    expect(r.entry.signals).toBeTruthy();
    // The page is closed: the server's heartbeat runs until morning.
    for (clock.t = at(4, 20, 10); clock.t <= at(5, 9); clock.t += 5 * MIN) await service.live();
    const log = db.listEvents(db.activeBlob()!.id, { limit: 500 }).reverse();
    const kinds = log.map((e) => e.kind);
    expect(kinds).toContain('thought');
    expect(kinds).toContain('sleep');
    expect(kinds).toContain('dream');
    expect(kinds.lastIndexOf('wake')).toBeGreaterThan(kinds.indexOf('sleep'));
    const dreams = log.filter((e) => e.kind === 'dream');
    expect(dreams.length).toBeLessThanOrEqual(2);
    const dream = dreams[dreams.length - 1];
    if (dream?.kind !== 'dream') throw new Error('no dream');
    expect(dream.dream.memories[0].text).toContain('finished the project');
    expect(dream.dream.fragments).toEqual(expect.arrayContaining(['finished', 'project']));
    expect(dream.dream.seen).toBe(false);
    expect(db.entry(r.entry.id)!.recalls).toBeGreaterThan(0);
    // The writer opens the page in the morning.
    clock.t = at(5, 9, 30);
    const s = await service.state();
    expect(s.away).toBeTruthy();
    expect(s.away!.events.map((e) => e.kind)).toEqual(expect.arrayContaining(['sleep', 'dream', 'wake']));
    expect(s.away!.greeting).not.toBe('asleep');
    expect(s.life.asleep).toBe(false);
    expect(s.life.unseenDream?.id).toBe(dream.id); // the newest one
    for (const d of dreams) await service.markDreamSeen(d.id);
    expect((await service.state()).life.unseenDream).toBeNull();
    db.close();
  });

  it('the open page does the thinking: the server waits while someone watches', async () => {
    const { db, clock, service } = setup(at(4, 15));
    await service.state();
    await service.message('hello mote');
    for (let i = 0; i < 6; i++) {
      clock.t += MIN;
      await service.tick(false, { idleMs: 0 });
      await service.live();
    }
    expect(db.listEvents(db.activeBlob()!.id, { kinds: ['thought'] })).toHaveLength(0);
    db.close();
  });

  it('a thought on its own nudges the mood, is logged, and a late-night nap becomes sleep', async () => {
    const { db, clock, service } = setup(at(4, 22));
    await service.state();
    await service.message('a long day. so tired.');
    const blob = db.activeBlob()!;
    // Sleepy enough for a nap to turn into sleep, not quite enough to drop off by itself.
    db.saveBlobState(blob.id, blob.mood, { ...blob.life!, energy: 0.62, lastActiveAt: at(4, 22) });
    clock.t = at(4, 23, 40);
    const before = db.activeBlob()!.mood;
    let r = await service.think();
    for (let i = 0; i < 8 && !r.fellAsleep && r.kind === 'thought'; i++) r = await service.think();
    expect(r.kind === 'thought' || r.kind === 'asleep').toBe(true);
    const after = db.activeBlob()!;
    expect(Math.abs(after.mood.valence - decay(before, blob.temperament, clock.t).valence)).toBeLessThanOrEqual(0.06 * 9);
    expect(db.listEvents(blob.id, { kinds: ['thought'] }).length).toBeGreaterThan(0);
    expect(after.life!.asleep).toBe(true);
    db.close();
  });

  it('an entry wakes it up, and so does poking it', async () => {
    const { db, service } = setup(at(4, 23, 30));
    await service.state();
    await service.sleepNow();
    expect(db.activeBlob()!.life!.asleep).toBe(true);
    const r = await service.message('are you sleeping?');
    expect(r.woke?.cause).toBe('message');
    expect(r.life.asleep).toBe(false);
    await service.sleepNow();
    const w = await service.wake('poke');
    expect(w.woke?.cause).toBe('poke');
    expect((await service.wake('poke')).woke).toBeNull(); // already awake
    db.close();
  });

  it('can be told not to live on its own', async () => {
    const { db, clock, service } = setup(at(4, 15));
    await service.state();
    service.setBackground(false);
    for (let i = 0; i < 12; i++) {
      clock.t += 10 * MIN;
      await service.live();
    }
    expect(db.listEvents(db.activeBlob()!.id, { kinds: ['thought', 'dream'] })).toHaveLength(0);
    expect((await service.state()).life.background).toBe(false);
    db.close();
  });

  it('kind entries are remembered, and often-recalled ones become core memories', async () => {
    const { db, clock, service } = setup(at(4, 10));
    await service.state();
    const r = await service.message('thank you mote, you are the best');
    expect(r.entry.signals?.tone.kind).toBeGreaterThan(0);
    db.markRecalled([r.entry.id, r.entry.id, r.entry.id], clock.t); // counted once per call
    db.markRecalled([r.entry.id], clock.t);
    db.markRecalled([r.entry.id], clock.t);
    expect(db.entry(r.entry.id)!.recalls).toBe(3);
    expect(db.coreMemories(db.activeBlob()!.id, 3).map((e) => e.id)).toEqual([r.entry.id]);
    expect(kindSignals().tone.kind).toBeGreaterThan(0.5);
    db.close();
  });
});
