// Local SQLite storage. All journal data stays in this one file.
// Uses the SQLite built into Node (and Electron), so there is no native module to compile: the same
// code runs in development, in tests and inside the desktop app on Windows, macOS and Linux.

import { mkdirSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type { Emotion, JournalEntry, LifeArea, LifeEvent, LifeEventData, LifeState, MoodState, Signals, Temperament } from '../shared/types';
import type { VisualParams } from '../shared/visuals';

export interface BlobRow {
  id: number;
  temperament: Temperament;
  mood: MoodState;
  /** Null for blobs saved before Mote had a body clock. */
  life: LifeState | null;
  bornAt: number;
  lastSeenAt: number;
}

export interface EventFilter {
  kinds?: LifeEvent['kind'][];
  since?: number;
  until?: number;
  before?: number;
  limit?: number;
}

export interface NewEntry {
  blobId: number;
  createdAt: number;
  text: string;
  provider: string | null;
  model: string | null;
  answers: unknown | null;
  signals: Signals | null;
  visual: VisualParams;
  moodAfter: MoodState;
  lifeArea: LifeArea | null;
  userEmotion: Emotion | 'none' | null;
  distress: boolean;
  skipped: string | null;
  meta?: Record<string, unknown>;
}

export interface EntryFilter {
  /** Only this blob's entries (memories belong to the Mote that read them). */
  blobId?: number;
  lifeArea?: string;
  emotion?: string;
  before?: number;
  since?: number;
  limit?: number;
}

interface EntryRecord {
  id: number;
  created_at: number;
  text: string;
  provider: string | null;
  model: string | null;
  answers: string | null;
  signals: string | null;
  visual: string;
  life_area: string | null;
  user_emotion: string | null;
  distress: number;
  skipped: string | null;
  recalls?: number;
  meta?: string | null;
}

const parse = <T>(s: string | null): T | null => (s ? (JSON.parse(s) as T) : null);

function toEntry(r: EntryRecord): JournalEntry {
  return {
    id: r.id,
    createdAt: r.created_at,
    text: r.text,
    provider: r.provider,
    model: r.model,
    answers: parse(r.answers),
    signals: parse<Signals>(r.signals),
    visual: JSON.parse(r.visual) as VisualParams,
    lifeArea: r.life_area as LifeArea | null,
    userEmotion: r.user_emotion as Emotion | 'none' | null,
    distress: r.distress === 1,
    skipped: r.skipped,
    recalls: r.recalls ?? 0,
    decision: parse<{ decision?: JournalEntry['decision'] }>(r.meta ?? null)?.decision,
  };
}

/** node:sqlite, loaded on first use without its one-time "experimental" console warning. */
function sqlite(): typeof import('node:sqlite') {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning?.message;
    if (/SQLite/i.test(text ?? '')) return;
    return (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
  } finally {
    process.emitWarning = emit;
  }
}

export class MoteDb {
  readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new (sqlite().DatabaseSync)(file);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blobs (
        id INTEGER PRIMARY KEY,
        seed INTEGER NOT NULL,
        temperament TEXT NOT NULL,
        born_at INTEGER NOT NULL,
        mood TEXT NOT NULL,
        last_seen_at INTEGER NOT NULL,
        retired_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY,
        blob_id INTEGER NOT NULL REFERENCES blobs(id),
        created_at INTEGER NOT NULL,
        text TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        answers TEXT,
        signals TEXT,
        visual TEXT NOT NULL,
        mood_after TEXT,
        life_area TEXT,
        user_emotion TEXT,
        distress INTEGER NOT NULL DEFAULT 0,
        skipped TEXT,
        meta TEXT
      );
      CREATE INDEX IF NOT EXISTS entries_time ON entries(created_at);
      CREATE INDEX IF NOT EXISTS entries_blob_time ON entries(blob_id, created_at);
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      -- Mote's inner life: thoughts on its own, falling asleep, waking up, dreams.
      CREATE TABLE IF NOT EXISTS life_events (
        id INTEGER PRIMARY KEY,
        blob_id INTEGER NOT NULL REFERENCES blobs(id),
        at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS life_events_blob_time ON life_events(blob_id, at);
      -- Minutes you were at the computer, per quarter hour of each local day (only if you let Mote
      -- notice; server/senses). No apps, no titles, nothing you typed: just the count.
      CREATE TABLE IF NOT EXISTS activity (
        day TEXT NOT NULL,
        slot INTEGER NOT NULL,
        minutes INTEGER NOT NULL,
        PRIMARY KEY (day, slot)
      );
    `);
    // Columns added after the first release.
    const has = (table: string, col: string) => (this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
    if (!has('blobs', 'life')) this.db.exec('ALTER TABLE blobs ADD COLUMN life TEXT');
    if (!has('entries', 'recalls')) this.db.exec('ALTER TABLE entries ADD COLUMN recalls INTEGER NOT NULL DEFAULT 0');
    if (!has('entries', 'last_recalled_at')) this.db.exec('ALTER TABLE entries ADD COLUMN last_recalled_at INTEGER');
  }

  activeBlob(): BlobRow | null {
    const r = this.db
      .prepare('SELECT id, temperament, mood, life, born_at, last_seen_at FROM blobs WHERE retired_at IS NULL ORDER BY id DESC LIMIT 1')
      .get() as { id: number; temperament: string; mood: string; life: string | null; born_at: number; last_seen_at: number } | undefined;
    if (!r) return null;
    return { id: r.id, temperament: JSON.parse(r.temperament), mood: JSON.parse(r.mood), life: parse<LifeState>(r.life), bornAt: r.born_at, lastSeenAt: r.last_seen_at };
  }

  createBlob(t: Temperament, mood: MoodState, now: number, life: LifeState | null = null): BlobRow {
    const info = this.db
      .prepare('INSERT INTO blobs (seed, temperament, born_at, mood, life, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(t.seed, JSON.stringify(t), now, JSON.stringify(mood), life ? JSON.stringify(life) : null, now);
    return { id: Number(info.lastInsertRowid), temperament: t, mood, life, bornAt: now, lastSeenAt: now };
  }

  saveMood(blobId: number, mood: MoodState, lastSeenAt: number) {
    this.db.prepare('UPDATE blobs SET mood = ?, last_seen_at = ? WHERE id = ?').run(JSON.stringify(mood), lastSeenAt, blobId);
  }

  /** Saves mood and body. `lastSeenAt` only when the writer was actually there (the page visible). */
  saveBlobState(blobId: number, mood: MoodState, life: LifeState, lastSeenAt?: number) {
    if (lastSeenAt === undefined) {
      this.db.prepare('UPDATE blobs SET mood = ?, life = ? WHERE id = ?').run(JSON.stringify(mood), JSON.stringify(life), blobId);
    } else {
      this.db.prepare('UPDATE blobs SET mood = ?, life = ?, last_seen_at = ? WHERE id = ?').run(JSON.stringify(mood), JSON.stringify(life), lastSeenAt, blobId);
    }
  }

  // ---- Inner life ----

  insertEvent(blobId: number, at: number, data: LifeEventData): LifeEvent {
    const info = this.db.prepare('INSERT INTO life_events (blob_id, at, kind, data) VALUES (?, ?, ?, ?)').run(blobId, at, data.kind, JSON.stringify(data));
    return { ...data, id: Number(info.lastInsertRowid), at };
  }

  event(id: number): (LifeEvent & { blobId: number }) | null {
    const r = this.db.prepare('SELECT id, blob_id, at, data FROM life_events WHERE id = ?').get(id) as { id: number; blob_id: number; at: number; data: string } | undefined;
    return r ? { ...(JSON.parse(r.data) as LifeEventData), id: r.id, at: r.at, blobId: r.blob_id } : null;
  }

  updateEvent(id: number, data: LifeEventData) {
    this.db.prepare('UPDATE life_events SET data = ? WHERE id = ?').run(JSON.stringify(data), id);
  }

  /** Newest first. */
  listEvents(blobId: number, f: EventFilter = {}): LifeEvent[] {
    const where = ['blob_id = ?'];
    const args: (string | number)[] = [blobId];
    if (f.kinds?.length) {
      where.push(`kind IN (${f.kinds.map(() => '?').join(', ')})`);
      args.push(...f.kinds);
    }
    if (f.since !== undefined) {
      where.push('at >= ?');
      args.push(f.since);
    }
    if (f.until !== undefined) {
      where.push('at <= ?');
      args.push(f.until);
    }
    if (f.before !== undefined) {
      where.push('at < ?');
      args.push(f.before);
    }
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 500);
    const rows = this.db
      .prepare(`SELECT id, at, data FROM life_events WHERE ${where.join(' AND ')} ORDER BY at DESC, id DESC LIMIT ${limit}`)
      .all(...args) as { id: number; at: number; data: string }[];
    return rows.map((r) => ({ ...(JSON.parse(r.data) as LifeEventData), id: r.id, at: r.at }));
  }

  /** Mote thought or dreamed about these entries. */
  markRecalled(ids: number[], now: number) {
    const stmt = this.db.prepare('UPDATE entries SET recalls = recalls + 1, last_recalled_at = ? WHERE id = ?');
    for (const id of new Set(ids)) stmt.run(now, id);
  }

  /** Everything the character replay needs about this blob's entries, oldest first. */
  characterEntries(blobId: number) {
    const rows = this.db
      .prepare('SELECT id, created_at, text, signals, distress, mood_after, recalls, user_emotion FROM entries WHERE blob_id = ? ORDER BY created_at ASC, id ASC')
      .all(blobId) as { id: number; created_at: number; text: string; signals: string | null; distress: number; mood_after: string | null; recalls: number; user_emotion: string | null }[];
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      text: r.text,
      signals: parse<Signals>(r.signals),
      distress: r.distress === 1,
      trustAfter: parse<MoodState>(r.mood_after)?.trust ?? null,
      recalls: r.recalls ?? 0,
      userEmotion: r.user_emotion as Emotion | 'none' | null,
    }));
  }

  /** The whole inner-life log, oldest first. */
  allEvents(blobId: number): LifeEvent[] {
    const rows = this.db.prepare('SELECT id, at, data FROM life_events WHERE blob_id = ? ORDER BY at ASC, id ASC').all(blobId) as { id: number; at: number; data: string }[];
    return rows.map((r) => ({ ...(JSON.parse(r.data) as LifeEventData), id: r.id, at: r.at }));
  }

  /** Changes whenever an entry or a life event is added (cache key). */
  historyVersion(blobId: number): string {
    const e = this.db.prepare('SELECT MAX(id) AS m, COUNT(*) AS n FROM entries WHERE blob_id = ?').get(blobId) as { m: number | null; n: number };
    const l = this.db.prepare('SELECT MAX(id) AS m FROM life_events WHERE blob_id = ?').get(blobId) as { m: number | null };
    const r = this.db.prepare('SELECT COALESCE(SUM(recalls), 0) AS s FROM entries WHERE blob_id = ?').get(blobId) as { s: number };
    return `${e.m ?? 0}:${e.n}:${l.m ?? 0}:${r.s}`;
  }

  /** Entries recalled at least `minRecalls` times (core memories), any age. */
  coreMemories(blobId: number, minRecalls: number, limit = 40): JournalEntry[] {
    return (
      this.db.prepare('SELECT * FROM entries WHERE blob_id = ? AND recalls >= ? ORDER BY recalls DESC, created_at DESC LIMIT ?').all(blobId, minRecalls, limit) as unknown as EntryRecord[]
    ).map(toEntry);
  }

  retireBlob(blobId: number, now: number) {
    this.db.prepare('UPDATE blobs SET retired_at = ? WHERE id = ?').run(now, blobId);
  }

  insertEntry(e: NewEntry): JournalEntry {
    const info = this.db
      .prepare(
        `INSERT INTO entries (blob_id, created_at, text, provider, model, answers, signals, visual, mood_after, life_area, user_emotion, distress, skipped, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.blobId,
        e.createdAt,
        e.text,
        e.provider,
        e.model,
        e.answers === null ? null : JSON.stringify(e.answers),
        e.signals === null ? null : JSON.stringify(e.signals),
        JSON.stringify(e.visual),
        JSON.stringify(e.moodAfter),
        e.lifeArea,
        e.userEmotion,
        e.distress ? 1 : 0,
        e.skipped,
        e.meta ? JSON.stringify(e.meta) : null,
      );
    return this.entry(Number(info.lastInsertRowid))!;
  }

  entry(id: number): JournalEntry | null {
    const r = this.db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as EntryRecord | undefined;
    return r ? toEntry(r) : null;
  }

  listEntries(f: EntryFilter = {}): JournalEntry[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (f.blobId !== undefined) {
      where.push('blob_id = ?');
      args.push(f.blobId);
    }
    if (f.lifeArea) {
      where.push('life_area = ?');
      args.push(f.lifeArea);
    }
    if (f.emotion) {
      where.push('user_emotion = ?');
      args.push(f.emotion);
    }
    if (f.before !== undefined) {
      where.push('created_at < ?');
      args.push(f.before);
    }
    if (f.since !== undefined) {
      where.push('created_at >= ?');
      args.push(f.since);
    }
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 500);
    const sql = `SELECT * FROM entries ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
    return (this.db.prepare(sql).all(...args) as unknown as EntryRecord[]).map(toEntry);
  }

  /** The blob's recent history, oldest first. */
  recentHistory(blobId: number, limit: number): { text: string; at: number }[] {
    const rows = this.db
      .prepare('SELECT text, created_at FROM entries WHERE blob_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(blobId, limit) as { text: string; created_at: number }[];
    return rows.reverse().map((r) => ({ text: r.text, at: r.created_at }));
  }

  getSetting(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return r ? r.value : null;
  }

  setSetting(key: string, value: string) {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  // ---- Minutes at the computer (server/senses) ----

  addActivity(day: string, slot: number, minutes: number) {
    this.db
      .prepare('INSERT INTO activity (day, slot, minutes) VALUES (?, ?, ?) ON CONFLICT(day, slot) DO UPDATE SET minutes = MIN(15, minutes + excluded.minutes)')
      .run(day, slot, Math.min(15, minutes));
  }

  /** The days from `since` (inclusive) to `before` (exclusive), oldest first, each with its 96 quarter hours. */
  activityDays(since: string, before: string): { day: string; slots: number[] }[] {
    const rows = this.db.prepare('SELECT day, slot, minutes FROM activity WHERE day >= ? AND day < ? ORDER BY day, slot').all(since, before) as {
      day: string;
      slot: number;
      minutes: number;
    }[];
    const days = new Map<string, number[]>();
    for (const r of rows) {
      let slots = days.get(r.day);
      if (!slots) days.set(r.day, (slots = new Array<number>(96).fill(0)));
      if (r.slot >= 0 && r.slot < 96) slots[r.slot] = r.minutes;
    }
    return [...days].map(([day, slots]) => ({ day, slots }));
  }

  activityMinutes(day: string): number {
    const r = this.db.prepare('SELECT COALESCE(SUM(minutes), 0) AS m FROM activity WHERE day = ?').get(day) as { m: number };
    return Number(r.m) || 0;
  }

  pruneActivity(before: string) {
    this.db.prepare('DELETE FROM activity WHERE day < ?').run(before);
  }

  forgetActivity() {
    this.db.exec('DELETE FROM activity');
  }

  close() {
    this.db.close();
  }
}
