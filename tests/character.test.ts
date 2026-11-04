import { describe, expect, it } from 'vitest';
import { applyDreamToCharacter, applyEntryToCharacter, buildCharacter, describeCharacter, natureOf, type CharacterEntry } from '../server/life/character';
import { decideIntent } from '../shared/decide';
import { DREAM_ENDINGS, DREAM_EVENTS, DREAM_PLACES, EMOTIONS, INTENTS, SITUATIONS, TRAITS, type Dream, type LifeEvent, type Signals, type Traits } from '../shared/types';
import { DAY, HOUR, hostileSignals, kindSignals, signals, temperament } from './helpers';

const BORN = new Date(2026, 9, 1, 12).getTime();
const one = <K extends string>(keys: readonly K[], k: K) => Object.fromEntries(keys.map((x) => [x, x === k ? 1 : 0])) as Record<K, number>;

function entry(id: number, at: number, s: Signals | null, over: Partial<CharacterEntry> = {}): CharacterEntry {
  return { id, createdAt: at, text: `entry ${id}`, signals: s, distress: false, trustAfter: null, recalls: 0, userEmotion: 'calm', ...over };
}

function dream(effect: Dream['effect'], over: Partial<Dream> = {}): Dream {
  return {
    place: one(DREAM_PLACES, 'sky'),
    event: one(DREAM_EVENTS, 'flying'),
    feeling: one(EMOTIONS, 'joy'),
    ending: one(DREAM_ENDINGS, 'peaceful'),
    vividness: 0.7,
    memories: [],
    fragments: [],
    effect,
    remembered: false,
    model: 'mock',
    seen: false,
    ...over,
  };
}

describe('character', () => {
  it('starts from its nature: a cheerful Mote is more playful, an anxious one less brave', () => {
    const cheerful = natureOf(temperament({ archetype: 'cheerful', baselineValence: 0.7 }));
    const anxious = natureOf(temperament({ archetype: 'anxious', volatility: 0.8 }));
    expect(cheerful.playfulness).toBeGreaterThan(anxious.playfulness);
    expect(anxious.courage).toBeLessThan(cheerful.courage);
    for (const k of TRAITS) {
      expect(cheerful[k]).toBeGreaterThan(0);
      expect(cheerful[k]).toBeLessThan(1);
    }
  });

  it('kindness warms it, hurt makes it wary, dreams make it a dreamer, sleeping on hard days makes it brave', () => {
    const base = natureOf(temperament());
    const kind = { ...base };
    applyEntryToCharacter(kind, kindSignals());
    expect(kind.warmth).toBeGreaterThan(base.warmth);
    expect(kind.wariness).toBeLessThan(base.wariness);
    const hurt = { ...base };
    applyEntryToCharacter(hurt, hostileSignals());
    expect(hurt.wariness).toBeGreaterThan(base.wariness);
    expect(hurt.warmth).toBeLessThan(base.warmth);
    const dreamt = { ...base };
    applyDreamToCharacter(dreamt, dream('processed'));
    expect(dreamt.dreaminess).toBeGreaterThan(base.dreaminess);
    expect(dreamt.courage).toBeGreaterThan(base.courage);
    const scared = { ...base };
    applyDreamToCharacter(scared, dream('nightmare'));
    expect(scared.courage).toBeLessThan(base.courage);
  });

  it('describes who it has become', () => {
    const t = (o: Partial<Traits>): Traits => ({ warmth: 0.4, trust: 0.3, courage: 0.4, wariness: 0.3, curiosity: 0.4, playfulness: 0.4, dreaminess: 0.2, ...o });
    expect(describeCharacter(t({}))).toBe('a little one still unsure of you');
    expect(describeCharacter(t({ warmth: 0.8, playfulness: 0.7, dreaminess: 0.6, trust: 0.8 }))).toBe('a warm, playful dreamer who trusts you');
    expect(describeCharacter(t({ curiosity: 0.7, trust: 0.5 }))).toBe('an explorer getting to know you');
    expect(describeCharacter(t({ wariness: 0.9, courage: 0.2 }))).toBe('a wary, timid little one still unsure of you');
  });

  it('replays a life into a timeline, milestones and a mind map of what shaped it', () => {
    const kindS = { ...kindSignals(), situation: one(SITUATIONS, 'kindness') };
    const entries: CharacterEntry[] = [
      entry(1, BORN + HOUR, signals({ userIntensity: 0.3 }), { trustAfter: 0.2 }),
      ...Array.from({ length: 14 }, (_, i) => entry(2 + i, BORN + (i + 1) * DAY, kindS, { trustAfter: Math.min(0.9, 0.3 + i * 0.05) })),
      entry(20, BORN + 16 * DAY, hostileSignals(), { trustAfter: 0.6 }),
      entry(21, BORN + 17 * DAY, signals(), { distress: true, text: 'a crisis entry' }),
    ];
    const events: LifeEvent[] = [
      { id: 1, at: BORN + 3 * DAY, kind: 'sleep', cause: 'night' },
      { id: 2, at: BORN + 3 * DAY + 2 * HOUR, kind: 'dream', dream: dream('sweet', { memories: [{ id: 2, text: 'entry 2', when: BORN + DAY }] }) },
      ...[3, 4, 5].map((id) => ({
        id,
        at: BORN + (4 + id) * DAY,
        kind: 'thought' as const,
        thought: one(['remember_good', 'remember_hard', 'miss_writer', 'wonder_day', 'worried', 'grateful', 'still_hurt', 'forgiving', 'sleepy', 'bored', 'content', 'curious', 'daydream'] as const, 'remember_good'),
        confidence: 0.8,
        action: one(['nap', 'look_around', 'wait_by_text', 'wander', 'stretch', 'hum', 'sulk', 'glow'] as const, 'glow'),
        actionConfidence: 0.6,
        chosen: 'glow' as const,
        memory: { id: 2, text: 'entry 2', when: BORN + DAY },
        seed: 1,
        watched: false,
      })),
    ];
    const r = buildCharacter({ temperament: temperament({ archetype: 'stoic' }), bornAt: BORN, entries, events, now: BORN + 18 * DAY });
    expect(r.traits.warmth).toBeGreaterThan(r.nature.warmth);
    expect(r.traits.dreaminess).toBeGreaterThan(r.nature.dreaminess);
    expect(r.timeline[0].traits).toEqual(r.nature);
    for (let i = 1; i < r.timeline.length; i++) expect(r.timeline[i].at).toBeGreaterThanOrEqual(r.timeline[i - 1].at);
    const labels = r.milestones.map((m) => m.label);
    expect(labels[0]).toMatch(/^Born a stoic/);
    expect(labels).toEqual(expect.arrayContaining(['First words from you', 'First kindness', 'First dream', 'First time it got hurt', 'Began to trust you', 'A core memory formed', 'First night’s sleep']));
    expect(r.memories.find((m) => m.id === 2)!.core).toBe(true); // a dream and three thoughts about it
    expect(r.memories.some((m) => m.text.includes('crisis'))).toBe(false);
    expect(r.memories.find((m) => m.id === 20)!.impact.wariness).toBeGreaterThan(0);
    expect(r.dreams[0].memoryIds).toEqual([2]);
    expect(r.thoughtCounts.remember_good).toBe(3);
    expect(r.description).toMatch(/^an? /);
  });

  it('drifts back toward its nature over time, without forgetting at once', () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry(i + 1, BORN + i * HOUR, hostileSignals()));
    const t = temperament();
    const soon = buildCharacter({ temperament: t, bornAt: BORN, entries, events: [], now: BORN + DAY });
    const later = buildCharacter({ temperament: t, bornAt: BORN, entries, events: [], now: BORN + 120 * DAY });
    expect(soon.traits.wariness).toBeGreaterThan(later.traits.wariness);
    expect(later.traits.wariness).toBeGreaterThan(soon.nature.wariness - 0.001);
  });

  it('leans on its decisions: a warm Mote comes closer, a wary one keeps its distance', () => {
    const flat = Object.fromEntries(INTENTS.map((i) => [i, 1 / INTENTS.length])) as Record<(typeof INTENTS)[number], number>;
    const ordinary = one(SITUATIONS, 'ordinary');
    const warm: Traits = { warmth: 0.9, trust: 0.8, courage: 0.6, wariness: 0.1, curiosity: 0.5, playfulness: 0.5, dreaminess: 0.3 };
    const wary: Traits = { warmth: 0.15, trust: 0.2, courage: 0.2, wariness: 0.9, curiosity: 0.3, playfulness: 0.2, dreaminess: 0.3 };
    const a = decideIntent(flat, ordinary, 'stoic', warm);
    const b = decideIntent(flat, ordinary, 'stoic', wary);
    expect(a.come_closer).toBeGreaterThan(b.come_closer);
    expect(b.give_space).toBeGreaterThan(a.give_space);
    expect(decideIntent(flat, ordinary, 'stoic')).toEqual(decideIntent(flat, ordinary, 'stoic', undefined));
  });
});
