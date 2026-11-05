// Your daily rhythm, learned from when you're at the computer (only if you let Mote notice).
// Deterministic, like the body clock: code finds your usual night (the quietest stretch of the day
// over the last two weeks) and Mote's body clock moves toward it, a little more with each day it
// knows you. With no new days (noticing turned off) what it learned fades as the days age out.

import { clamp } from '../../shared/math';
import type { Rhythm } from '../../shared/types';
import { TUNING } from '../mood/tuning';

const R = TUNING.rhythm;
export const SLOT_MINUTES = 15;
export const SLOTS = (24 * 60) / SLOT_MINUTES;

/** Minutes at the computer in each quarter hour of one local day. */
export interface ActivityDay {
  /** Local date, YYYY-MM-DD. */
  day: string;
  slots: number[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local date of a moment, YYYY-MM-DD (in this computer's time zone). */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Which quarter hour of its local day a moment falls in (0..95). */
export function slotOf(ms: number): number {
  const d = new Date(ms);
  return Math.floor((d.getHours() * 60 + d.getMinutes()) / SLOT_MINUTES);
}

const wrapHours = (h: number) => ((h % 24) + 24) % 24;
/** A difference in hours, wrapped into -12..12. */
const wrapShift = (h: number) => {
  const w = wrapHours(h);
  return w > 12 ? w - 24 : w;
};

const total = (d: ActivityDay) => d.slots.reduce((a, b) => a + b, 0);

/**
 * What Mote has learned from these days (pass the finished days of the last two weeks). Your night
 * is the quietest `nightHours` of the day; the shift moves Mote's own night (by nature centered on
 * 3:00) onto yours, scaled by how many days it has learned from.
 */
export function learnRhythm(days: ActivityDay[]): Rhythm {
  const counted = days.filter((d) => total(d) >= R.minDayMinutes);
  const n = counted.length;
  const avg = new Array<number>(SLOTS).fill(0);
  for (const d of counted) for (let s = 0; s < SLOTS; s++) avg[s] += clamp((d.slots[s] ?? 0) / SLOT_MINUTES) / n;
  const hours = Array.from({ length: 24 }, (_, h) => (avg[h * 4] + avg[h * 4 + 1] + avg[h * 4 + 2] + avg[h * 4 + 3]) / 4);
  const none: Rhythm = { days: n, confidence: 0, night: null, shiftHours: 0, hours };
  if (n < R.minDays) return none;

  const k = R.smoothSlots;
  const smooth = avg.map((_, s) => {
    let sum = 0;
    for (let j = -k; j <= k; j++) sum += avg[(s + j + SLOTS) % SLOTS];
    return sum / (2 * k + 1);
  });
  const w = R.nightHours * (60 / SLOT_MINUTES);
  const windowSum = (start: number) => {
    let sum = 0;
    for (let j = 0; j < w; j++) sum += smooth[(start + j) % SLOTS];
    return sum;
  };
  const sums = smooth.map((_, s) => windowSum(s));
  const best = Math.min(...sums);
  // Several equally quiet windows (a night longer than nightHours): take the middle one.
  const eps = 1e-9;
  let first = sums.indexOf(best);
  let back = 0;
  while (back < SLOTS && sums[(first - back - 1 + SLOTS) % SLOTS] <= best + eps) back++;
  let fwd = 0;
  while (fwd < SLOTS && sums[(first + fwd + 1) % SLOTS] <= best + eps) fwd++;
  if (back + fwd >= SLOTS - 1) return none; // the same all day: no night to find
  first = (first - back + SLOTS) % SLOTS;
  const start = (first + Math.round((back + fwd) / 2)) % SLOTS;

  const allSum = smooth.reduce((a, b) => a + b, 0);
  const nightMean = sums[start] / w;
  const dayMean = (allSum - sums[start]) / (SLOTS - w);
  if (dayMean <= 0.01 || nightMean > R.contrast * dayMean) return none;

  const from = wrapHours((start * SLOT_MINUTES) / 60);
  const to = wrapHours(from + R.nightHours);
  const mid = wrapHours(from + R.nightHours / 2);
  const confidence = clamp((n - R.minDays + 1) / (R.fullDays - R.minDays + 1));
  return { days: n, confidence, night: { from, to }, shiftHours: wrapShift(mid - R.natureMidHour) * confidence, hours };
}

/** Mote's sleep window now: its nature's night, moved by what it learned. */
export function moteSleep(r: Rhythm): { from: number; to: number } {
  return { from: wrapHours(R.natureSleep.from + r.shiftHours), to: wrapHours(R.natureSleep.to + r.shiftHours) };
}
