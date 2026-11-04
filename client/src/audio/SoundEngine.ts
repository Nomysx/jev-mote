// Owns the AudioContext. Browsers only allow sound after the user interacts with the page, so the
// context starts on the first click or key press. On/off and volume are remembered in this browser.

import { createChain, playSound, type Chain, type SoundKind, type SoundOptions } from './synth';
import { NEUTRAL_TONE, type MoodTone, type Voice } from './voice';

const PREFS_KEY = 'mote.sound';

interface Prefs {
  enabled: boolean;
  volume: number;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Prefs>;
      return { enabled: p.enabled !== false, volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : 0.7 };
    }
  } catch {
    /* storage unavailable: use defaults */
  }
  return { enabled: true, volume: 0.7 };
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private chain: Chain | null = null;
  private prefs = loadPrefs();
  private mood: MoodTone = { ...NEUTRAL_TONE };
  private listeners = new Set<() => void>();

  constructor(private voice: Voice) {
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  get enabled() {
    return this.prefs.enabled;
  }

  get volume() {
    return this.prefs.volume;
  }

  /** True once the browser lets us play sound. */
  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  private save() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      /* not persisted; fine */
    }
    for (const fn of this.listeners) fn();
  }

  setEnabled(on: boolean) {
    this.prefs.enabled = on;
    if (on) this.unlock();
    this.save();
  }

  setVolume(v: number) {
    this.prefs.volume = Math.min(1, Math.max(0, v));
    if (this.chain && this.ctx) this.chain.master.gain.setTargetAtTime(this.prefs.volume, this.ctx.currentTime, 0.05);
    this.save();
  }

  setVoice(v: Voice) {
    this.voice = v;
  }

  setMood(m: MoodTone) {
    this.mood = { ...m };
  }

  unlock() {
    if (!this.prefs.enabled) return;
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
        this.chain = createChain(this.ctx, this.ctx.destination, this.prefs.volume);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      /* no Web Audio: stay silent */
    }
  }

  /** Plays a sound now (or after `delay` seconds). Silent when muted or before the first interaction. */
  play(kind: SoundKind, opts: SoundOptions & { delay?: number } = {}) {
    if (!this.prefs.enabled || !this.ctx || !this.chain || this.ctx.state !== 'running') return;
    playSound(this.ctx, this.chain, kind, this.voice, this.mood, opts, this.ctx.currentTime + 0.02 + (opts.delay ?? 0));
  }
}
