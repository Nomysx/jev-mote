// The app clock. Real time plus a debug offset (the "fast-forward time" control), persisted so
// simulated days survive restarts.

import type { MoteDb } from './db';

const KEY = 'clock_offset_ms';

export class Clock {
  private offset: number;

  constructor(private db: MoteDb) {
    this.offset = Number(db.getSetting(KEY) ?? 0) || 0;
  }

  now(): number {
    return Date.now() + this.offset;
  }

  get offsetMs(): number {
    return this.offset;
  }

  advance(ms: number) {
    this.offset += Math.max(0, ms);
    this.db.setSetting(KEY, String(this.offset));
  }

  reset() {
    this.offset = 0;
    this.db.setSetting(KEY, '0');
  }
}
