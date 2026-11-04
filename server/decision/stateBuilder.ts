// Builds the `state` object sent with every question, fitted to the model's token budget.
//
// Trimming order: drop the oldest recent messages first, then shorten long old messages, then drop
// the rest of the history, then extra grudge details. `new_message` is never cut.
//
// `new_message` is also the FIRST key: some small models (e.g. Laya) truncate long states from the
// end, so anything that gets cut is history, never the message being judged.

import type { ModelProfile, MoodState, Temperament } from '../../shared/types';
import { describeGrudges, describeMood, relativeTime } from '../mood/engine';
import { describeTemperament } from '../mood/temperament';
import { estimateJsonTokens } from './tokens';

export interface HistoryItem {
  text: string;
  at: number;
}

export type MoteState = {
  new_message: string;
  current_mood?: string;
  temperament?: string;
  grudges?: string[];
  recent_messages?: { when: string; text: string }[];
};

export interface BuiltState {
  state: MoteState;
  estimatedTokens: number;
  budget: number;
  /** History messages that did not fit (or exceeded the profile's message count). */
  droppedMessages: number;
  shortenedMessages: number;
  /** True only if the new message alone exceeds the budget (it is still sent complete). */
  overBudget: boolean;
}

export interface StateInput {
  newMessage: string;
  /** Oldest first. */
  history: HistoryItem[];
  mood: MoodState;
  temperament: Temperament;
  now: number;
}

type BudgetProfile = Pick<ModelProfile, 'maxStateTokens' | 'maxRecentMessages' | 'recentMessageMaxChars' | 'compactState' | 'stateFields' | 'moodStyle'>;

const ALL_FIELDS = ['current_mood', 'temperament', 'grudges', 'recent_messages'] as const;

const MIN_SHORTENED_CHARS = 60;
const MIN_KEEP_BEFORE_SHORTENING = 2;

export function shorten(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export function buildState(input: StateInput, profile: BudgetProfile): BuiltState {
  const budget = profile.maxStateTokens;
  const all = input.history.filter((h) => h.text.trim().length > 0);
  const kept = all.slice(-Math.max(0, profile.maxRecentMessages));
  let dropped = all.length - kept.length;
  const shortenedSet = new Set<object>();

  const recent = kept.map((h) => {
    const item = { when: relativeTime(input.now - h.at), text: shorten(h.text, profile.recentMessageMaxChars) };
    if (item.text !== h.text.trim()) shortenedSet.add(item);
    return item;
  });
  let grudges = describeGrudges(input.mood.grudges, input.now);
  const fields = new Set(profile.stateFields ?? ALL_FIELDS);
  // Compact states (tiny budgets) leave grudges out: current_mood already says "still hurt", and the
  // mood engine carries the long-term memory in code.
  if (profile.compactState) fields.delete('grudges');
  const moodText = describeMood(input.mood, profile.moodStyle ?? 'words');

  const make = (): MoteState => {
    const s: MoteState = { new_message: input.newMessage };
    if (fields.has('current_mood')) s.current_mood = moodText;
    if (fields.has('temperament')) s.temperament = describeTemperament(input.temperament);
    if (fields.has('grudges')) s.grudges = grudges;
    if (fields.has('recent_messages')) s.recent_messages = recent;
    return s;
  };
  let tokens = estimateJsonTokens(make());

  // 1. Drop the oldest messages first.
  while (tokens > budget && recent.length > MIN_KEEP_BEFORE_SHORTENING) {
    recent.shift();
    dropped++;
    tokens = estimateJsonTokens(make());
  }

  // 2. Shorten long old messages, oldest first, progressively.
  let limit = recent.reduce((m, r) => Math.max(m, r.text.length), 0);
  while (tokens > budget && recent.some((r) => r.text.length > MIN_SHORTENED_CHARS)) {
    limit = Math.max(MIN_SHORTENED_CHARS, Math.floor(limit * 0.7));
    for (const r of recent) {
      if (tokens <= budget) break;
      if (r.text.length > limit) {
        const before = r.text;
        r.text = shorten(r.text, limit);
        if (r.text !== before) shortenedSet.add(r);
        tokens = estimateJsonTokens(make());
      }
    }
  }

  // 3. Drop whatever history is left.
  while (tokens > budget && recent.length > 0) {
    recent.shift();
    dropped++;
    tokens = estimateJsonTokens(make());
  }

  // 4. Keep only the strongest grudge.
  while (tokens > budget && grudges.length > 1) {
    grudges = grudges.slice(0, grudges.length - 1);
    tokens = estimateJsonTokens(make());
  }

  return {
    state: make(),
    estimatedTokens: tokens,
    budget,
    droppedMessages: dropped,
    shortenedMessages: recent.filter((r) => shortenedSet.has(r)).length,
    overBudget: tokens > budget,
  };
}
