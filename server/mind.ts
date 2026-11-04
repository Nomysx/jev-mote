// Mote's background mind: what it thinks about and does while nobody is writing.
// Code decides what it can remember and when; the decision model chooses the thought and action.

import type { JournalEntry, LifeState, ModelProfile, MoodState, Temperament } from '../shared/types';
import { IDLE_THOUGHT_WORDS } from './decision/questions';
import { shorten } from './decision/stateBuilder';
import { describeBody, type BodyNeeds } from './life/engine';
import { describeGrudges, describeMood, relativeTime } from './mood/engine';
import { describeTemperament } from './mood/temperament';
import { TUNING } from './mood/tuning';

const DAY = 24 * 3_600_000;

/** Local time of day in words (computed in code, never by the model). */
export function timeOfDay(ms: number): string {
  const h = new Date(ms).getHours();
  if (h < 5) return 'late night';
  if (h < 8) return 'early morning';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

/**
 * Picks one past entry to "remember": recent, emotionally strong ones are likelier; entries that
 * raised a distress flag are never resurfaced; recently remembered ones are mostly skipped. Core
 * memories (thought or dreamed about many times) can come back long after the last two weeks.
 */
export function pickMemory(entries: JournalEntry[], now: number, recentlyRemembered: number[], rnd: () => number = Math.random): JournalEntry | null {
  const core = (e: JournalEntry) => (e.recalls ?? 0) >= TUNING.coreMemoryRecalls;
  const pool = entries.filter((e) => e.signals && !e.distress && e.text.trim().length > 0 && (now - e.createdAt < 14 * DAY || core(e)));
  if (pool.length === 0) return null;
  const weights = pool.map((e) => {
    const intensity = e.signals!.userIntensity;
    const ageDays = (now - e.createdAt) / DAY;
    const recency = now - e.createdAt < 14 * DAY ? Math.exp(-ageDays / 5) : 0;
    const coreWeight = core(e) ? 0.12 + 0.03 * Math.min(5, e.recalls ?? 0) : 0;
    const repeat = recentlyRemembered.includes(e.id) ? 0.15 : 1;
    return (0.3 + intensity) * Math.max(recency, coreWeight) * repeat;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export interface IdleInput {
  mood: MoodState;
  temperament: Temperament;
  now: number;
  lastEntryAt: number | null;
  memory: JournalEntry | null;
  /** Energy, missing the writer, restlessness. */
  body?: BodyNeeds;
  /** What it thought about last time, so thoughts can follow on from each other. */
  lastThought?: LifeState['lastThought'];
  /** Who it has become, e.g. "a warm, playful dreamer who trusts you". */
  character?: string;
}

/** The state for a background thought. Small-context models get a minimal version. */
export function buildIdleState(i: IdleInput, profile: Pick<ModelProfile, 'compactState' | 'moodStyle'>): Record<string, unknown> {
  const memory = i.memory ? { when: relativeTime(i.now - i.memory.createdAt), text: shorten(i.memory.text, profile.compactState ? 120 : 220) } : undefined;
  const lastEntry = i.lastEntryAt === null ? 'never' : relativeTime(i.now - i.lastEntryAt);
  const style = profile.moodStyle ?? 'words';
  const state: Record<string, unknown> = {
    current_mood: describeMood(i.mood, style),
    time_of_day: timeOfDay(i.now),
    last_message_from_writer: lastEntry,
  };
  if (i.body) state.body = describeBody(i.body, style);
  if (!profile.compactState) {
    state.temperament = describeTemperament(i.temperament);
    if (i.character) state.character = i.character;
    state.grudges = describeGrudges(i.mood.grudges, i.now);
    // Trains of thought: the last thought, if it was recent. Left out for small models, which tend to
    // copy words from the state into every answer.
    if (i.lastThought && i.now - i.lastThought.at < 3 * 3_600_000) {
      state.previous_thought = `${IDLE_THOUGHT_WORDS[i.lastThought.kind] ?? i.lastThought.kind}, ${relativeTime(i.now - i.lastThought.at)}`;
    }
  }
  if (memory) state.memory = memory;
  return state;
}
