import { describe, expect, it } from 'vitest';
import type { Clock } from '../server/clock';
import { loadConfig } from '../server/config';
import { MoteDb } from '../server/db';
import { Catalog } from '../server/decision/catalog';
import { validateResponse } from '../server/decision/parse';
import { mockAnswers } from '../server/decision/providers/mock';
import type { DecisionProvider } from '../server/decision/types';
import { initialLife, longing } from '../server/life/engine';
import { buildIdleState } from '../server/mind';
import { initialMood } from '../server/mood/engine';
import { Senses, type PresenceSensor } from '../server/senses/presence';
import { dayKey, learnRhythm, moteSleep, slotOf, SLOTS, type ActivityDay } from '../server/senses/rhythm';
import { MoteService } from '../server/service';
import { HOUR, temperament } from './helpers';

const MIN = 60_000;
/** Local time on a day in November 2026. */
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();

/** A day at the computer from `from` to `to` (local hours, may wrap past midnight), every minute. */
function dayActive(day: string, from: number, to: number, minutes = 15): ActivityDay {
  const slots = new Array<number>(SLOTS).fill(0);
  for (let s = 0; s < SLOTS; s++) {
    const h = s / 4;
    const on = from < to ? h >= from && h < to : h >= from || h < to;
    if (on) slots[s] = minutes;
  }
  return { day, slots };
}

const days = (n: number, from: number, to: number) => Array.from({ length: n }, (_, i) => dayActive(`2026-11-${String(i + 1).padStart(2, '0')}`, from, to));

describe('learning your daily rhythm', () => {
  it('needs a few days before it adapts', () => {
    const r = learnRhythm(days(2, 11, 3));
    expect(r.days).toBe(2);
    expect(r.confidence).toBe(0);
    expect(r.night).toBeNull();
    expect(r.shiftHours).toBe(0);
    expect(r.hours).toHaveLength(24);
    expect(r.hours[14]).toBeCloseTo(1);
    expect(r.hours[6]).toBe(0);
  });

  it('a usual 23:00 to 7:00 sleeper leaves Mote on its own nights', () => {
    const r = learnRhythm(days(12, 7, 23));
    expect(r.confidence).toBe(1);
    expect(r.night).not.toBeNull();
    expect(Math.abs(r.shiftHours)).toBeLessThanOrEqual(0.5);
  });

  it('a night owl moves Mote later, an early bird earlier', () => {
    const owl = learnRhythm(days(12, 11, 3)); // quiet 3:00 to 11:00, middle 7:00
    expect(owl.shiftHours).toBeCloseTo(4, 0);
    expect(owl.night!.from).toBeGreaterThanOrEqual(3);
    expect(owl.night!.to).toBeLessThanOrEqual(11);
    expect(moteSleep(owl).from).toBeCloseTo(3, 0);
    expect(moteSleep(owl).to).toBeCloseTo(11, 0);
    const lark = learnRhythm(days(12, 5, 21)); // quiet 21:00 to 5:00, middle 1:00
    expect(lark.shiftHours).toBeCloseTo(-2, 0);
    expect(moteSleep(lark).from).toBeCloseTo(21, 0);
  });

  it('adapts a little more with each day it knows you', () => {
    const steps = [3, 6, 9, 12, 14].map((n) => learnRhythm(days(n, 11, 3)).shiftHours);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
    expect(steps[0]).toBeGreaterThan(0);
    expect(steps[0]).toBeLessThan(1);
    expect(steps[3]).toBeCloseTo(4, 0);
  });

  it('finds no night when your days look the same around the clock', () => {
    const r = learnRhythm(days(10, 0, 24).map((d) => ({ ...d, slots: d.slots.map(() => 5) })));
    expect(r.night).toBeNull();
    expect(r.shiftHours).toBe(0);
  });

  it('days you barely used the computer do not count', () => {
    const r = learnRhythm([...days(2, 11, 3), { day: '2026-11-09', slots: new Array<number>(SLOTS).fill(0).map((_, s) => (s === 40 ? 10 : 0)) }]);
    expect(r.days).toBe(2);
  });

  it('keys minutes by local day and quarter hour', () => {
    expect(dayKey(at(5, 0, 10))).toBe('2026-11-05');
    expect(slotOf(at(5, 0, 10))).toBe(0);
    expect(slotOf(at(5, 13, 47))).toBe(13 * 4 + 3);
    expect(slotOf(at(5, 23, 59))).toBe(95);
  });
});

function fakeSensor(idleMs = 0, locked = false) {
  const s = { idleMs, locked, sample: () => ({ idleMs: s.idleMs, locked: s.locked }) };
  return s satisfies PresenceSensor;
}

describe('noticing you at the computer', () => {
  it('is off until you turn it on, and only counts minutes you used the computer', () => {
    const db = new MoteDb(':memory:');
    const clock = { t: at(5, 10), now() { return this.t; } };
    const sensor = fakeSensor(5_000);
    const senses = new Senses(db, clock, sensor, () => {});
    expect(senses.available).toBe(true);
    expect(senses.presenceOn()).toBe(false);
    expect(senses.nearby(clock.t)).toBeNull();
    senses.record();
    expect(db.activityMinutes('2026-11-05')).toBe(0);

    senses.setPresence(true);
    senses.record();
    sensor.idleMs = 5 * MIN; // not since the last look
    senses.record();
    sensor.idleMs = 0;
    sensor.locked = true;
    senses.record();
    expect(db.activityMinutes('2026-11-05')).toBe(1);
    expect(senses.nearby(clock.t)).toEqual({ near: false, at: null });
    sensor.locked = false;
    sensor.idleMs = 2 * MIN;
    expect(senses.nearby(clock.t)).toEqual({ near: true, at: clock.t - 2 * MIN });
    sensor.idleMs = 15 * MIN;
    expect(senses.nearby(clock.t)!.near).toBe(false);

    expect(senses.view(clock.t).todayMinutes).toBe(1);
    senses.forget();
    expect(db.activityMinutes('2026-11-05')).toBe(0);
    db.close();
  });

  it('never notices without the desktop app, whatever the setting says', () => {
    const db = new MoteDb(':memory:');
    db.setSetting('senses_presence', '1');
    const senses = new Senses(db, { now: () => at(5, 10) }, null, () => {});
    expect(senses.available).toBe(false);
    expect(senses.presenceOn()).toBe(false);
    expect(senses.nearby(at(5, 10))).toBeNull();
    db.close();
  });

  it('a quarter hour holds at most 15 minutes', () => {
    const db = new MoteDb(':memory:');
    for (let i = 0; i < 20; i++) db.addActivity('2026-11-05', 40, 1);
    expect(db.activityMinutes('2026-11-05')).toBe(15);
    db.close();
  });

  it('being busy at the computer counts as contact, a little less than watching Mote', () => {
    const t0 = at(5, 9);
    const life = { ...initialLife(t0), lastEntryAt: t0, lastSeenAt: t0 };
    const later = t0 + 10 * HOUR;
    const alone = longing(life, 0.8, later);
    const nearby = longing({ ...life, lastNearAt: later - MIN }, 0.8, later);
    expect(alone).toBeGreaterThan(0.4);
    expect(nearby).toBeLessThan(0.2);
    expect(nearby).toBeGreaterThan(0);
  });

  it('tells bigger models whether you are at the computer, and feels the time on its own clock', () => {
    const t = temperament();
    const base = { mood: initialMood(t, at(5, 1)), temperament: t, now: at(5, 1), lastEntryAt: null, memory: null };
    const full = { compactState: false, moodStyle: 'words' as const };
    expect(buildIdleState({ ...base, writerNearby: true }, full).writer).toMatch(/at the computer/);
    expect(buildIdleState({ ...base, writerNearby: false }, full).writer).toMatch(/away/);
    expect(buildIdleState({ ...base, writerNearby: true }, { compactState: true, moodStyle: 'numbers' }).writer).toBeUndefined();
    expect(buildIdleState(base, full).writer).toBeUndefined();
    expect(buildIdleState(base, full).time_of_day).toBe('late night');
    expect(buildIdleState({ ...base, bodyShiftMs: 4 * HOUR }, full).time_of_day).toBe('night'); // 1:00 feels like 21:00
  });
});

// ---- The service, with an instant mock provider, a controllable clock and a fake sensor ----

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

function setup(start: number, sensor: PresenceSensor | null = fakeSensor()) {
  const db = new MoteDb(':memory:');
  const clock = { t: start, offsetMs: 0, now() { return this.t; }, advance(ms: number) { this.t += ms; }, reset() {} };
  const config = { ...loadConfig({ DECISION_PROVIDER: 'mock' }), dbPath: ':memory:' };
  const senses = new Senses(db, clock, sensor, () => {});
  const service = new MoteService(db, instantMock(), new Catalog(), config, clock as unknown as Clock, () => {}, senses);
  return { db, clock, senses, service };
}

describe('Mote and you at the computer', () => {
  it('an open Mote only counts as watched while you are at the computer, and greets you when you are back', async () => {
    const sensor = fakeSensor();
    const { db, clock, service } = setup(at(5, 9), sensor);
    service.setPresence(true);
    await service.state();
    await service.message('good morning mote');
    // You walk away; the Mote window stays open on the desktop.
    sensor.idleMs = 15 * MIN;
    for (let i = 0; i < 12; i++) {
      clock.t += 5 * MIN;
      sensor.idleMs += 5 * MIN;
      const r = await service.tick(false, { idleMs: 0 });
      expect(r.away).toBeNull();
      expect(r.life.writerAway).toBe(true);
    }
    const blob = db.activeBlob()!;
    expect(blob.life!.lastSeenAt).toBeLessThan(at(5, 9, 20));
    // Back at the computer: Mote tells you what it did meanwhile.
    clock.t += MIN;
    sensor.idleMs = 0;
    const back = await service.tick(false, { idleMs: 0 });
    expect(back.away).not.toBeNull();
    expect(back.life.writerAway).toBe(false);
    db.close();
  });

  it('with noticing off, an open window counts as watched, as before', async () => {
    const sensor = fakeSensor(60 * MIN);
    const { db, clock, service } = setup(at(5, 9), sensor);
    await service.state();
    clock.t += 30 * MIN;
    const r = await service.tick(false, { idleMs: 0 });
    expect(r.life.writerAway).toBe(false);
    expect(db.activeBlob()!.life!.lastSeenAt).toBe(clock.t);
    expect(() => setup(at(5, 9), null).service.setPresence(true)).toThrow(/desktop app/);
    db.close();
  });

  it('misses you less while you are busy nearby', async () => {
    const sensor = fakeSensor();
    const { db, clock, service } = setup(at(5, 9), sensor);
    service.setPresence(true);
    await service.state();
    await service.message('off to work, see you later');
    for (let i = 0; i < 10 * 6; i++) {
      clock.t += 10 * MIN;
      await service.live();
    }
    const nearby = (await service.tick(false, null)).life.longing;

    const other = setup(at(5, 9), fakeSensor());
    await other.service.state();
    await other.service.message('off to work, see you later');
    for (let i = 0; i < 10 * 6; i++) {
      other.clock.t += 10 * MIN;
      await other.service.live();
    }
    const alone = (await other.service.tick(false, null)).life.longing;
    expect(nearby).toBeLessThan(0.25);
    expect(alone).toBeGreaterThan(nearby + 0.15);
    db.close();
    other.db.close();
  });

  it('a night owl’s Mote stays up later, and keeps what it learned for a while after noticing is turned off', async () => {
    const sleepsAt = async (owl: boolean) => {
      const { db, clock, service } = setup(at(20, 21));
      // Two weeks of being at the computer from 11:00 to 3:00.
      for (let d = 6; owl && d < 20; d++) {
        const day = dayActive(`2026-11-${String(d).padStart(2, '0')}`, 11, 3);
        day.slots.forEach((m, s) => m && db.addActivity(day.day, s, m));
      }
      service.setBackground(false); // only the body clock
      await service.state();
      const blob = db.activeBlob()!;
      db.saveBlobState(blob.id, blob.mood, { ...blob.life!, energy: 0.5, lastActiveAt: at(20, 20), lastSeenAt: at(20, 20), updatedAt: at(20, 21) });
      for (clock.t = at(20, 21); clock.t <= at(21, 12); clock.t += 5 * MIN) {
        await service.live();
        if (db.activeBlob()!.life!.asleep) break;
      }
      const view = service.sensesView();
      db.close();
      return { at: clock.t, view };
    };
    const usual = await sleepsAt(false);
    const owl = await sleepsAt(true);
    expect(owl.view.presence).toBe(false); // learned from earlier days, noticing now off
    expect(owl.view.rhythm.shiftHours).toBeGreaterThan(3);
    expect(usual.view.rhythm.shiftHours).toBe(0);
    expect(owl.at - usual.at).toBeGreaterThanOrEqual(2 * HOUR);
  });
});
