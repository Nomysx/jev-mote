// Local SQLite storage. All journal data stays in this one file.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Emotion, JournalEntry, LifeArea, MoodState, Signals, Temperament } from '../shared/types';
import type { VisualParams } from '../shared/visuals';

export interface BlobRow {
  id: number;
  temperament: Temperament;
  mood: MoodState;
  bornAt: number;
  lastSeenAt: number;
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
  };
}

export class MoteDb {
  readonly db: Database.Database;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
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
    `);
  }

  activeBlob(): BlobRow | null {
    const r = this.db
      .prepare('SELECT id, temperament, mood, born_at, last_seen_at FROM blobs WHERE retired_at IS NULL ORDER BY id DESC LIMIT 1')
      .get() as { id: number; temperament: string; mood: string; born_at: number; last_seen_at: number } | undefined;
    if (!r) return null;
    return { id: r.id, temperament: JSON.parse(r.temperament), mood: JSON.parse(r.mood), bornAt: r.born_at, lastSeenAt: r.last_seen_at };
  }

  createBlob(t: Temperament, mood: MoodState, now: number): BlobRow {
    const info = this.db
      .prepare('INSERT INTO blobs (seed, temperament, born_at, mood, last_seen_at) VALUES (?, ?, ?, ?, ?)')
      .run(t.seed, JSON.stringify(t), now, JSON.stringify(mood), now);
    return { id: Number(info.lastInsertRowid), temperament: t, mood, bornAt: now, lastSeenAt: now };
  }

  saveMood(blobId: number, mood: MoodState, lastSeenAt: number) {
    this.db.prepare('UPDATE blobs SET mood = ?, last_seen_at = ? WHERE id = ?').run(JSON.stringify(mood), lastSeenAt, blobId);
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
    return (this.db.prepare(sql).all(...args) as EntryRecord[]).map(toEntry);
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

  close() {
    this.db.close();
  }
}
