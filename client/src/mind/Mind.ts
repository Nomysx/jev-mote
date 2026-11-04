// Background thinking scheduler. While you're away from the keyboard, Mote asks the decision model
// what is on its mind every few minutes. It adapts to the model's speed (slow models think less
// often), waits until you've been idle for a while, pauses when the window is hidden, and cancels a
// thought in progress the moment you start typing.

import type { ThinkResponse } from '../api';

const PREFS_KEY = 'mote.mind';
const IDLE_BEFORE_THINKING_MS = 45_000;

export interface MindPrefs {
  /** Show Mote's thoughts as floating words (off = the original, fully wordless Mote). */
  thoughts: boolean;
  /** Let Mote think on its own while you're idle (uses your model every few minutes). */
  background: boolean;
}

export function loadMindPrefs(): MindPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<MindPrefs>;
    return { thoughts: p.thoughts !== false, background: p.background !== false };
  } catch {
    return { thoughts: true, background: true };
  }
}

export function saveMindPrefs(p: MindPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* not persisted; fine */
  }
}

/** How long to wait before the next background thought, given how long the last one took. */
export function nextThinkDelay(lastLatencyMs: number, rnd: () => number = Math.random): number {
  return Math.min(15 * 60_000, Math.max(90_000, 12 * lastLatencyMs)) + rnd() * 30_000;
}

export interface MindDeps {
  think: (signal: AbortSignal) => Promise<ThinkResponse>;
  /** False while an entry is being read, a thought is showing, Mote is busy, or the model is down. */
  canThink: () => boolean;
  enabled: () => boolean;
  onThought: (r: ThinkResponse) => Promise<void> | void;
}

export class Mind {
  private timer: number | undefined;
  private ctrl: AbortController | null = null;
  private lastActivity = performance.now();
  private lastLatency = 8000;

  constructor(private deps: MindDeps) {}

  start(firstDelayMs = IDLE_BEFORE_THINKING_MS + 15_000) {
    this.schedule(firstDelayMs);
  }

  /** The user did something (typing, sending): cancel any thought in progress and wait again. */
  notifyActivity() {
    this.lastActivity = performance.now();
    this.ctrl?.abort();
  }

  /** Think right away (debug). */
  thinkNow() {
    window.clearTimeout(this.timer);
    void this.tick(true);
  }

  private schedule(ms: number) {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.tick(false), ms);
  }

  private async tick(force: boolean) {
    if (!force) {
      if (!this.deps.enabled()) return this.schedule(60_000);
      const idleFor = performance.now() - this.lastActivity;
      if (document.visibilityState !== 'visible' || idleFor < IDLE_BEFORE_THINKING_MS || !this.deps.canThink()) {
        return this.schedule(20_000);
      }
    }
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    const t0 = performance.now();
    try {
      const r = await this.deps.think(ctrl.signal);
      this.lastLatency = r.ms || performance.now() - t0;
      if (!r.skipped && !ctrl.signal.aborted) await this.deps.onThought(r);
    } catch {
      /* cancelled or unreachable: just try again later */
    } finally {
      if (this.ctrl === ctrl) this.ctrl = null;
    }
    this.schedule(nextThinkDelay(this.lastLatency));
  }
}
