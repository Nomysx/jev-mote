// Dreams. Code picks what Mote dreams about (the day's residue: recent, strong entries, hard ones
// more often, and now and then a core memory from long ago); the decision model decides where the
// dream goes, what happens, how it feels and how it ends. Entries that raised a distress flag never
// appear in dreams.

import { dreamFragments } from '../../shared/dream';
import { DREAM_ENDINGS, DREAM_EVENTS, DREAM_PLACES, EMOTIONS, type Dream, type JournalEntry, type ModelProfile, type MoodState, type Temperament } from '../../shared/types';
import { choiceDist } from '../decision/parse';
import { shorten } from '../decision/stateBuilder';
import type { Answers } from '../decision/types';
import { describeGrudges, describeMood, relativeTime } from '../mood/engine';
import { describeTemperament } from '../mood/temperament';
import { TUNING } from '../mood/tuning';

const DAY = 24 * 3_600_000;

/** A hard entry: it hurt, or it was unkind to Mote. Sleeping on these is what dreams are for. */
export function isHard(e: JournalEntry): boolean {
  const s = e.signals;
  if (!s) return false;
  return s.userValence <= -0.6 || s.tone.hostile + 0.5 * s.tone.dismissive > 0.4;
}

/**
 * One or two entries to dream about. Mostly the last three days, weighted by intensity and recency,
 * hard ones half as likely again; core memories (thought about many times) can come back from any
 * time. Never entries that raised a distress flag.
 */
export function pickDreamSeeds(entries: JournalEntry[], now: number, rnd: () => number = Math.random): JournalEntry[] {
  const core = TUNING.coreMemoryRecalls;
  const pool = entries.filter(
    (e) => e.signals && !e.distress && e.text.trim().length > 0 && (now - e.createdAt < 3 * DAY || (e.recalls ?? 0) >= core),
  );
  if (pool.length === 0) return [];
  const weight = (e: JournalEntry) => {
    const age = Math.max(0, now - e.createdAt) / DAY;
    const recent = now - e.createdAt < 3 * DAY ? Math.pow(0.5, age) : 0;
    const coreW = (e.recalls ?? 0) >= core ? 0.12 : 0;
    return (0.25 + e.signals!.userIntensity) * Math.max(recent, coreW) * (isHard(e) ? 1.5 : 1);
  };
  const pick = (from: JournalEntry[]) => {
    const w = from.map(weight);
    const total = w.reduce((a, b) => a + b, 0);
    let r = rnd() * total;
    for (let i = 0; i < from.length; i++) {
      r -= w[i];
      if (r <= 0) return from[i];
    }
    return from[from.length - 1];
  };
  const first = pick(pool);
  const rest = pool.filter((e) => e.id !== first.id);
  // Dreams mix things: about half the time a second memory wanders in.
  return rest.length && rnd() < 0.5 ? [first, pick(rest)] : [first];
}

/** The state for a dream. The memory comes first (some small models truncate from the end). */
export function buildDreamState(
  i: { seeds: JournalEntry[]; mood: MoodState; temperament: Temperament; now: number; character?: string },
  profile: Pick<ModelProfile, 'compactState' | 'moodStyle'>,
): Record<string, unknown> {
  const max = profile.compactState ? 160 : 280;
  const mem = (e: JournalEntry) => ({ when: relativeTime(i.now - e.createdAt), text: shorten(e.text, max) });
  const state: Record<string, unknown> = {
    memory: i.seeds[0] ? mem(i.seeds[0]) : { text: 'Nothing yet: it has only just met the writer.' },
  };
  if (i.seeds[1]) state.other_memory = mem(i.seeds[1]);
  state.mood_before_sleep = describeMood(i.mood, profile.moodStyle ?? 'words');
  if (!profile.compactState) {
    state.temperament = describeTemperament(i.temperament);
    if (i.character) state.character = i.character;
    state.grudges = describeGrudges(i.mood.grudges, i.now);
  }
  return state;
}

/** Turns the model's answers into a dream (before its effect is known). */
export function dreamFromAnswers(
  answers: Answers,
  seeds: JournalEntry[],
  model: string,
  remembered: boolean,
): Omit<Dream, 'effect' | 'seen'> {
  const place = choiceDist(answers, 'dream_place', DREAM_PLACES, 'sky');
  const event = choiceDist(answers, 'dream_event', DREAM_EVENTS, 'floating');
  const feeling = choiceDist(answers, 'dream_feeling', EMOTIONS, 'calm');
  const ending = choiceDist(answers, 'dream_ending', DREAM_ENDINGS, 'faded');
  return {
    place: place.dist,
    event: event.dist,
    feeling: feeling.dist,
    ending: ending.dist,
    vividness: event.confidence,
    memories: seeds.map((e) => ({ id: e.id, text: e.text, when: e.createdAt })),
    fragments: dreamFragments(seeds.map((e) => e.text)),
    remembered,
    model,
  };
}
