// Noticing you at the computer. Off unless you turn it on (Settings → What Mote notices). Mote
// only ever reads how long ago the keyboard or mouse was last used, anywhere on this computer, and
// whether the screen is locked: never what you type, which apps you use or what's on screen. From
// that it knows when you're nearby, and once a minute it counts a minute at the computer, per
// quarter hour of the day, to learn your daily rhythm (rhythm.ts). Nothing leaves this computer.

import type { Rhythm, SensesView } from '../../shared/types';
import type { Clock } from '../clock';
import type { MoteDb } from '../db';
import { TUNING } from '../mood/tuning';
import { dayKey, learnRhythm, moteSleep, slotOf } from './rhythm';

/** Supplied by the desktop app (Electron's powerMonitor); absent in a browser. */
export interface PresenceSensor {
  sample(): { idleMs: number; locked: boolean };
}

export interface Nearby {
  /** At the computer now: used it recently and the screen isn't locked. */
  near: boolean;
  /** When they last used it (null while the screen is locked). */
  at: number | null;
}

const SETTING = 'senses_presence';
const DAY = 24 * 3_600_000;

export class Senses {
  private timer: NodeJS.Timeout | null = null;
  private rhythmCache: { key: string; rhythm: Rhythm } | null = null;
  private prunedOn = '';

  constructor(
    private db: MoteDb,
    private clock: Pick<Clock, 'now'>,
    private sensor: PresenceSensor | null,
    private log: (msg: string) => void = console.log,
    private intervalMs = 60_000,
  ) {}

  get available() {
    return this.sensor !== null;
  }

  /** You let Mote notice you at the computer (a setting; off by default). */
  presenceOn(): boolean {
    return this.available && this.db.getSetting(SETTING) === '1';
  }

  setPresence(on: boolean) {
    this.db.setSetting(SETTING, on ? '1' : '0');
    this.log(`[mote] Noticing you at the computer is ${on ? 'on' : 'off'}.`);
  }

  private sample(): { idleMs: number; locked: boolean } | null {
    if (!this.presenceOn()) return null;
    try {
      const s = this.sensor!.sample();
      return Number.isFinite(s.idleMs) ? { idleMs: Math.max(0, s.idleMs), locked: !!s.locked } : null;
    } catch {
      return null;
    }
  }

  /** Whether you're at the computer now; null while Mote doesn't notice. */
  nearby(now: number): Nearby | null {
    const s = this.sample();
    if (!s) return null;
    if (s.locked) return { near: false, at: null };
    return { near: s.idleMs < TUNING.life.awayAfterIdleMs, at: now - s.idleMs };
  }

  /** Once a minute: a minute at the computer if you used it since the last look. */
  record(now = this.clock.now()) {
    const s = this.sample();
    if (!s || s.locked || s.idleMs >= this.intervalMs + 5_000) return;
    this.db.addActivity(dayKey(now), slotOf(now), 1);
    const today = dayKey(now);
    if (this.prunedOn !== today) {
      this.prunedOn = today;
      this.db.pruneActivity(dayKey(now - TUNING.rhythm.keepDays * DAY));
    }
  }

  start() {
    this.stop();
    this.timer = setInterval(() => {
      try {
        this.record();
      } catch (err) {
        this.log(`[mote] noticing: ${(err as Error).message}`);
      }
    }, this.intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Your rhythm, from the finished days of the last two weeks (cached per day). */
  rhythm(now: number): Rhythm {
    const today = dayKey(now);
    if (this.rhythmCache?.key === today) return this.rhythmCache.rhythm;
    const days = this.db.activityDays(dayKey(now - TUNING.rhythm.windowDays * DAY), today);
    const rhythm = learnRhythm(days);
    this.rhythmCache = { key: today, rhythm };
    return rhythm;
  }

  /** How far Mote's body clock runs behind (+, a night owl) or ahead (-) of the wall clock. */
  bodyShiftMs(now: number): number {
    return this.rhythm(now).shiftHours * 3_600_000;
  }

  /** Forget your rhythm: every minute counted so far. */
  forget() {
    this.db.forgetActivity();
    this.rhythmCache = null;
    this.log('[mote] Forgot your daily rhythm.');
  }

  view(now: number): SensesView {
    const rhythm = this.rhythm(now);
    const near = this.nearby(now);
    return {
      available: this.available,
      presence: this.presenceOn(),
      nearby: near ? near.near : null,
      todayMinutes: this.db.activityMinutes(dayKey(now)),
      rhythm,
      sleep: moteSleep(rhythm),
    };
  }
}
