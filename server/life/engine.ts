// Mote's body clock: deterministic rules for energy, restlessness, missing the writer, falling
// asleep, waking up and dreaming (REM). Like the mood engine, this is code, not the model: the
// model is asked what Mote thinks and dreams, and these rules decide when it sleeps.

import { clamp } from '../../shared/math';
import type { LifeState, SleepCause, WakeCause } from '../../shared/types';
import { TUNING } from '../mood/tuning';

const L = TUNING.life;

/** Local hour of the day, fractional (14.5 = 2:30 pm), in this computer's time zone. */
export const localHour = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() + d.getMinutes() / 60;
};

export function initialLife(now: number): LifeState {
  return {
    energy: 0.85,
    boredom: 0.05,
    asleep: false,
    sleepCause: null,
    sleptAt: null,
    wokeAt: now,
    dreamsThisSleep: 0,
    lastDreamAt: null,
    dreamPending: false,
    lastThought: null,
    lastEntryAt: null,
    lastSeenAt: now,
    lastActiveAt: now,
    nextAwayThinkAt: now + L.awayThinkMinMs,
    updatedAt: now,
  };
}

/** Extra sleepiness from the time of day: high late at night, a dip after lunch, negative in the day. */
export function circadian(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 23 || h < 5) return 0.45;
  if (h < 7) return 0.25;
  if (h < 9) return 0;
  if (h >= 21) return 0.2;
  if (h >= 13 && h < 15) return -0.07;
  return -0.15;
}

export function sleepPressure(energy: number, hour: number): number {
  return 1 - clamp(energy) + circadian(hour);
}

/**
 * How much it misses the writer: grows with time since they last wrote or had the page open, faster
 * the more it trusts them. Zero before the first entry (nobody to miss yet). Never makes it worse
 * off: it only shapes what it thinks about and how glad it is when they come back.
 */
export function longing(life: LifeState, trust: number, now: number): number {
  if (life.lastEntryAt === null) return 0;
  const contact = Math.max(life.lastEntryAt, life.lastSeenAt);
  const away = Math.max(0, now - contact);
  const attach = L.attachBase + L.attachTrust * clamp(trust);
  return clamp(attach * (1 - Math.pow(0.5, away / L.longingHalfMs)));
}

export interface Transition {
  at: number;
  kind: 'sleep' | 'wake';
  cause: SleepCause | WakeCause;
  sleptMs?: number;
}

export function fallAsleep(life: LifeState, at: number, cause: SleepCause): Transition {
  life.asleep = true;
  life.sleepCause = cause;
  life.sleptAt = at;
  life.dreamsThisSleep = 0;
  return { at, kind: 'sleep', cause };
}

export function wakeUp(life: LifeState, at: number, cause: WakeCause): Transition {
  const sleptMs = life.sleptAt !== null ? Math.max(0, at - life.sleptAt) : 0;
  // A long sleep with no dream yet leaves one it may still remember (when the model is around).
  if (life.dreamsThisSleep === 0 && sleptMs >= L.dreamMinSleepMs && cause !== 'nightmare') life.dreamPending = true;
  life.asleep = false;
  life.sleepCause = null;
  life.wokeAt = at;
  return { at, kind: 'wake', cause, sleptMs };
}

export interface AdvanceContext {
  /** The mood's arousal (0..1): a stirred-up Mote tires faster. */
  arousal: number;
  /** Local hour at a time (tests pass a fixed time zone). */
  hourAt?: (ms: number) => number;
}

/** Let time pass for the body. Works for any gap (the page closed, the computer asleep, fast-forward). */
export function advanceLife(start: LifeState, now: number, ctx: AdvanceContext): { life: LifeState; transitions: Transition[] } {
  const life: LifeState = structuredClone(start);
  const transitions: Transition[] = [];
  const hourAt = ctx.hourAt ?? localHour;
  let t = Math.max(life.updatedAt, now - L.maxSimMs);
  if (!(now > t)) {
    life.updatedAt = Math.max(life.updatedAt, now);
    return { life, transitions };
  }
  const drain = (0.8 + 0.4 * clamp(ctx.arousal)) / L.awakeDrainMs;
  while (t < now) {
    const h = Math.min(L.stepMs, now - t);
    t += h;
    const hour = hourAt(t);
    if (life.asleep) {
      life.energy = clamp(life.energy + h / L.sleepFillMs);
      life.boredom *= Math.pow(0.5, h / L.boredomSleepHalfMs);
      const slept = t - (life.sleptAt ?? t);
      const napDone = life.sleepCause === 'nap' && slept >= L.napMaxMs;
      if (sleepPressure(life.energy, hour) < L.wakeBelow || napDone || slept >= L.maxSleepMs) {
        const morning = hour >= 5 && hour < 12 && life.sleepCause !== 'nap';
        transitions.push(wakeUp(life, t, morning ? 'morning' : 'rested'));
      }
    } else {
      life.energy = clamp(life.energy - h * drain);
      const company = t - life.lastSeenAt < L.watchedMs ? 0.5 : 1;
      life.boredom += (1 - life.boredom) * (1 - Math.pow(0.5, (h * company) / L.boredomHalfMs));
      const quiet = t - Math.max(life.lastActiveAt, life.lastEntryAt ?? -Infinity) >= L.sleepAfterQuietMs;
      if (quiet && sleepPressure(life.energy, hour) >= L.sleepAt) {
        transitions.push(fallAsleep(life, t, circadian(hour) > 0.1 ? 'night' : 'tired'));
      }
    }
    // A dream it never got to dream fades after a while awake.
    if (life.dreamPending && !life.asleep && life.wokeAt !== null && t - life.wokeAt > L.forgetDreamMs) life.dreamPending = false;
  }
  life.boredom = clamp(life.boredom);
  life.updatedAt = now;
  return { life, transitions };
}

/** Asleep and in the dreaming (REM) part of a sleep cycle. */
export function isDreaming(life: LifeState, now: number): boolean {
  if (!life.asleep || life.sleptAt === null) return false;
  const slept = now - life.sleptAt;
  if (slept < L.firstDreamAfterMs) return false;
  return (slept % L.cycleMs) / L.cycleMs >= L.remFrom;
}

/** Time for a dream: dreaming now, not too many tonight, and not in the same REM phase as the last one. */
export function dreamDue(life: LifeState, now: number): boolean {
  if (!isDreaming(life, now) || life.dreamsThisSleep >= L.maxDreamsPerSleep) return false;
  return life.lastDreamAt === null || life.lastDreamAt < (life.sleptAt ?? 0) || now - life.lastDreamAt >= L.cycleMs * 0.8;
}

/** The writer wrote: they're here, it's less restless and a little more tired. */
export function noteEntry(life: LifeState, now: number, intensity: number) {
  life.lastEntryAt = now;
  life.lastActiveAt = now;
  life.lastSeenAt = Math.max(life.lastSeenAt, now);
  life.energy = clamp(life.energy - (L.entryCostBase + L.entryCostGain * clamp(intensity)));
  life.boredom *= L.boredomAfterEntry;
}

export interface BodyNeeds {
  energy: number;
  boredom: number;
  longing: number;
}

/** How tired it is, 0..1 (0 above 45% energy, 1 below 10%). */
export const tiredness = (energy: number) => clamp((0.45 - energy) / 0.35);

/** The body in words (or numbers, for models that mix state words into their answers). */
export function describeBody(n: BodyNeeds, style: 'words' | 'numbers' = 'words'): string {
  if (style === 'numbers') return `energy ${n.energy.toFixed(2)}, missing writer ${n.longing.toFixed(2)}, restless ${n.boredom.toFixed(2)}`;
  const parts: string[] = [];
  const tired = tiredness(n.energy);
  parts.push(tired > 0.6 ? 'exhausted' : tired > 0.2 ? 'tired' : n.energy > 0.8 ? 'well rested' : 'awake');
  if (n.longing > 0.55) parts.push('misses the writer a lot');
  else if (n.longing > 0.25) parts.push('misses the writer');
  if (n.boredom > 0.6) parts.push('restless');
  else if (n.boredom > 0.3) parts.push('a little restless');
  return parts.join(', ');
}

/** For the settings screen: "asleep, dreaming" or "awake, a bit tired, misses you". */
export function lifeWords(life: LifeState, n: BodyNeeds, dreaming: boolean): string {
  if (life.asleep) return dreaming ? 'asleep, dreaming' : life.sleepCause === 'nap' ? 'napping' : 'asleep';
  const parts = ['awake'];
  const tired = tiredness(n.energy);
  if (tired > 0.6) parts.push('very tired');
  else if (tired > 0.2) parts.push('a bit tired');
  if (n.longing > 0.55) parts.push('misses you a lot');
  else if (n.longing > 0.25) parts.push('misses you');
  if (n.boredom > 0.6) parts.push('restless');
  return parts.join(', ');
}
