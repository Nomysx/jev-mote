// Groups journal entries into the last 7 local calendar days for the weekly mood strip.
// Dates and averages are computed in code, never by the model.

import { EMOTIONS, type Emotion, type JournalEntry } from './types';

export interface DaySummary {
  start: number;
  end: number;
  label: string;
  count: number;
  /** Average of the user's emotion distributions that day (entries the model read). */
  emotion: Record<Emotion | 'none', number>;
  valence: number;
  intensity: number;
  read: number;
}

export function buildWeek(entries: JournalEntry[], nowMs: number, locale?: string): DaySummary[] {
  const days: DaySummary[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(nowMs);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const start = d.getTime();
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const emotion = Object.fromEntries([...EMOTIONS, 'none'].map((k) => [k, 0])) as Record<Emotion | 'none', number>;
    days.push({
      start,
      end: next.getTime(),
      label: d.toLocaleDateString(locale, { weekday: 'short' }),
      count: 0,
      emotion,
      valence: 0,
      intensity: 0,
      read: 0,
    });
  }
  for (const e of entries) {
    const day = days.find((d) => e.createdAt >= d.start && e.createdAt < d.end);
    if (!day) continue;
    day.count++;
    if (!e.signals) continue;
    day.read++;
    for (const k of Object.keys(day.emotion) as (Emotion | 'none')[]) day.emotion[k] += e.signals.userEmotion[k] ?? 0;
    day.valence += e.signals.userValence;
    day.intensity += e.signals.userIntensity;
  }
  for (const d of days) {
    if (d.read === 0) continue;
    for (const k of Object.keys(d.emotion) as (Emotion | 'none')[]) d.emotion[k] /= d.read;
    d.valence /= d.read;
    d.intensity /= d.read;
  }
  return days;
}
