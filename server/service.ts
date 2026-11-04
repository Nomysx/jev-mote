// The app's core flow: message -> state -> decision model -> signals -> mood engine -> visuals -> journal.
// Only the DecisionProvider interface is used here; nothing provider-specific.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { topTwo } from '../shared/math';
import { IDLE_ACTIONS, IDLE_THOUGHTS, type IdleAction, type IdleThought, type InstalledModel, type JournalEntry, type MoodState, type ProviderStatus, type Signals, type Temperament } from '../shared/types';
import { moodToVisual, type VisualParams } from '../shared/visuals';
import type { Clock } from './clock';
import { ROOT_DIR, type AppConfig } from './config';
import type { BlobRow, EntryFilter, MoteDb } from './db';
import type { Catalog, Preset } from './decision/catalog';
import { choiceDist, toSignals } from './decision/parse';
import { buildIdleQuestions, buildQuestions } from './decision/questions';
import { buildState, type BuiltState } from './decision/stateBuilder';
import { DecisionError, type DecisionProvider } from './decision/types';
import { guessLanguage } from './language';
import { buildIdleState, pickMemory } from './mind';
import { applyMessage, applyUnreadable, decay, describeGrudges, describeMood, initialMood } from './mood/engine';
import { describeTemperament, generateTemperament, randomSeed } from './mood/temperament';
import { TUNING } from './mood/tuning';

export interface WellbeingCard {
  title: string;
  body: string;
  lines: { label: string; text: string }[];
  note: string;
}

export interface MoodSummary {
  words: string;
  valence: number;
  arousal: number;
  trust: number;
  clarity: number;
  mixedness: number;
  soothe: number;
  emotions: MoodState['emotions'];
  grudges: { cause: string; weight: number; ageMs: number; words: string }[];
}

export interface BlobInfo {
  seed: number;
  archetype: string;
  description: string;
  temperament: Temperament;
  bornAt: number;
}

const MAX_MESSAGE_CHARS = 20_000;
const HISTORY_LOOKBACK = 40;
const MODEL_SETTING = (provider: string) => `model:${provider}`;
const HINT_SETTING = 'hint_multilingual_shown';

const SKIP_NOTICES: Record<string, string> = {
  offline: 'Saved to your journal. Ollama isn’t running, so Mote couldn’t react.',
  outdated: 'Saved to your journal. Ollama needs an update before Mote can react.',
  endpoint_missing: 'Saved to your journal. Ollama needs an update before Mote can react.',
  model_missing: 'Saved to your journal. The selected model isn’t downloaded yet.',
  cloud_model: 'Saved to your journal. Cloud models aren’t used; pick a local model in settings.',
  not_decision_model: 'Saved to your journal. The selected model isn’t a decision model.',
  remote_host: 'Saved to your journal. OLLAMA_URL must point to a local Ollama.',
  context_exceeded: 'Saved to your journal. This entry is longer than the current model can read at once; a model with a bigger context (e.g. nimble) can read it.',
  too_large: 'Saved to your journal. This entry is too long to send to the model in one go.',
  timeout: 'Saved to your journal. The model took too long to answer; it may still be loading. Try again in a moment.',
  out_of_memory: 'Saved to your journal. The model ran out of memory. Try a smaller model (Lite or Balanced in settings), or close other apps.',
  bad_response: 'Saved to your journal. The model’s answer couldn’t be read.',
  http_error: 'Saved to your journal. The model ran into a problem.',
  language: 'Saved to your journal. The current model only reads English, so Mote didn’t react to this one.',
};

export interface ThinkResult {
  thought: { probabilities: Record<IdleThought, number>; confidence: number } | null;
  action: { probabilities: Record<IdleAction, number>; confidence: number } | null;
  memory: { id: number; text: string; when: number } | null;
  ms: number;
  skipped: string | null;
}

export class MoteService {
  private queue: Promise<unknown> = Promise.resolve();
  private recentlyRemembered: number[] = [];
  readonly wellbeing: WellbeingCard;

  constructor(
    private db: MoteDb,
    private provider: DecisionProvider,
    private catalog: Catalog,
    private config: AppConfig,
    private clock: Clock,
    private log: (msg: string) => void = console.log,
  ) {
    const raw = JSON.parse(readFileSync(path.join(ROOT_DIR, 'server', 'wellbeing.json'), 'utf8')) as WellbeingCard & { $comment?: string };
    this.wellbeing = { title: raw.title, body: raw.body, lines: raw.lines, note: raw.note };
  }

  get providerId() {
    return this.provider.providerId;
  }

  /** Serialize everything that touches the mood, so concurrent requests never race. */
  private serialize<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** The model saved in settings for this provider, falling back to DECISION_MODEL. */
  savedModel(): string {
    return this.db.getSetting(MODEL_SETTING(this.provider.providerId)) ?? this.config.decisionModel;
  }

  private ensureBlob(seed?: number): { blob: BlobRow; newborn: boolean } {
    const existing = this.db.activeBlob();
    if (existing) return { blob: existing, newborn: false };
    const now = this.clock.now();
    const t = generateTemperament(seed ?? randomSeed());
    const blob = this.db.createBlob(t, initialMood(t, now), now);
    this.log(`[mote] A new blob was born: ${t.archetype} (seed ${t.seed}).`);
    return { blob, newborn: true };
  }

  blobInfo(b: BlobRow): BlobInfo {
    return {
      seed: b.temperament.seed,
      archetype: b.temperament.archetype,
      description: describeTemperament(b.temperament),
      temperament: b.temperament,
      bornAt: b.bornAt,
    };
  }

  moodSummary(m: MoodState, now: number): MoodSummary {
    const words = describeGrudges(m.grudges, now);
    return {
      words: describeMood(m),
      valence: m.valence,
      arousal: m.arousal,
      trust: m.trust,
      clarity: m.clarity,
      mixedness: m.mixedness,
      soothe: m.soothe,
      emotions: m.emotions,
      grudges: [...m.grudges]
        .sort((a, b) => b.weight - a.weight)
        .map((g, i) => ({ cause: g.cause, weight: g.weight, ageMs: now - g.createdAt, words: words[i] })),
    };
  }

  /** Full state for page load. Applies decay for the time the app was closed; reports a wake-up transition. */
  state(markNewborn = false) {
    return this.serialize(async () => {
      const ensured = this.ensureBlob();
      const blob = ensured.blob;
      const newborn = ensured.newborn || markNewborn;
      const now = this.clock.now();
      const elapsed = now - blob.lastSeenAt;
      const before = moodToVisual(blob.mood, blob.temperament);
      const mood = decay(blob.mood, blob.temperament, now);
      this.db.saveMood(blob.id, mood, now);
      const status = await this.provider.status();
      return {
        now,
        newborn,
        blob: this.blobInfo(blob),
        mood: this.moodSummary(mood, now),
        visual: moodToVisual(mood, blob.temperament),
        wake: !newborn && elapsed >= TUNING.wakeAfterMs ? { elapsedMs: elapsed, before } : null,
        status,
        profile: this.provider.profile(),
        debugTools: this.config.debugTools,
        clockOffsetMs: this.clock.offsetMs,
        wellbeing: this.wellbeing,
      };
    });
  }

  /** Periodic heartbeat while the app is open: mood keeps drifting toward baseline. */
  tick(forceStatus = false) {
    return this.serialize(async () => {
      const { blob } = this.ensureBlob();
      const now = this.clock.now();
      const mood = decay(blob.mood, blob.temperament, now);
      this.db.saveMood(blob.id, mood, now);
      return {
        now,
        mood: this.moodSummary(mood, now),
        visual: moodToVisual(mood, blob.temperament),
        status: await this.provider.status(forceStatus),
        profile: this.provider.profile(),
        clockOffsetMs: this.clock.offsetMs,
      };
    });
  }

  message(rawText: string) {
    return this.serialize(async () => {
      const text = rawText.replace(/\r\n/g, '\n').trim().slice(0, MAX_MESSAGE_CHARS);
      if (!text) throw new Error('empty message');
      const { blob } = this.ensureBlob();
      const t = blob.temperament;
      const now = this.clock.now();
      const history = this.db.recentHistory(blob.id, HISTORY_LOOKBACK);
      const profile = this.provider.profile();

      let mood = decay(blob.mood, t, now);
      let signals: Signals | null = null;
      let answers: unknown = null;
      let usage: unknown = null;
      let skipped: string | null = null;
      let pulse = false;
      let distress = false;
      let hint: string | null = null;
      let built: BuiltState | null = null;
      let invalid: string[] = [];

      const lang = guessLanguage(text);
      if (lang.nonEnglish && profile.englishOnly && this.provider.providerId !== 'mock') {
        // Only English-language messages go to English-only models.
        skipped = 'language';
        mood = applyUnreadable(mood, t, now);
        if (!this.db.getSetting(HINT_SETTING)) {
          this.db.setSetting(HINT_SETTING, '1');
          hint = `This entry doesn't look like English, and ${this.provider.model} only reads English. For other languages, the multilingual Lite model works on small machines: run "ollama pull laya:322m-multilingual-bf16", then pick it in settings.`;
        }
      } else {
        built = buildState({ newMessage: text, history, mood, temperament: t, now }, profile);
        try {
          const res = await this.provider.ask(built.state, buildQuestions());
          answers = res.answers;
          usage = res.usage ?? null;
          invalid = (res as { invalid?: string[] }).invalid ?? [];
          signals = toSignals(res.answers);
          const outcome = applyMessage(mood, t, signals, now, { hasHistory: history.length > 0 });
          mood = outcome.mood;
          pulse = outcome.pulse;
          distress = outcome.distress;
        } catch (err) {
          if (!(err instanceof DecisionError)) throw err;
          skipped = err.code;
          this.log(`[mote] Decision request failed (${err.code}): ${err.message}`);
        }
      }

      const visual: VisualParams = moodToVisual(mood, t);
      const entry: JournalEntry = this.db.insertEntry({
        blobId: blob.id,
        createdAt: now,
        text,
        provider: signals ? this.provider.providerId : null,
        model: signals ? this.provider.model : null,
        answers,
        signals,
        visual,
        moodAfter: mood,
        lifeArea: signals?.lifeArea ?? null,
        userEmotion: signals?.userEmotionTop ?? null,
        distress,
        skipped,
        meta: built
          ? { estimatedTokens: built.estimatedTokens, budget: built.budget, dropped: built.droppedMessages, shortened: built.shortenedMessages, usage, invalid }
          : undefined,
      });
      this.db.saveMood(blob.id, mood, now);

      const status = skipped && skipped !== 'language' ? await this.provider.status(true) : await this.provider.status();
      return {
        entry,
        visual,
        mood: this.moodSummary(mood, now),
        pulse,
        distress,
        wellbeing: distress ? this.wellbeing : null,
        hint,
        notice: skipped ? SKIP_NOTICES[skipped] ?? SKIP_NOTICES.http_error : null,
        status,
        stateInfo: built
          ? { estimatedTokens: built.estimatedTokens, budget: built.budget, dropped: built.droppedMessages, shortened: built.shortenedMessages, overBudget: built.overBudget }
          : null,
        dominant: signals ? topTwo(signals.blobReaction)[0][0] : null,
      };
    });
  }

  journal(filter: EntryFilter) {
    return this.db.listEntries(filter);
  }

  /**
   * Background thinking: what is on Mote's mind right now, and what it does next. Read-only (the
   * mood is not changed) and not queued behind entries; the client cancels it when you start typing.
   */
  async think(signal?: AbortSignal): Promise<ThinkResult> {
    const empty: ThinkResult = { thought: null, action: null, memory: null, ms: 0, skipped: null };
    const status = await this.provider.status();
    if (status.state !== 'ready') return { ...empty, skipped: status.state };
    const { blob } = this.ensureBlob();
    const now = this.clock.now();
    const mood = decay(blob.mood, blob.temperament, now);
    const recent = this.db.listEntries({ since: now - 14 * 24 * 3_600_000, limit: 200 });
    const last = this.db.listEntries({ limit: 1 })[0];
    const memory = pickMemory(recent, now, this.recentlyRemembered);
    const profile = this.provider.profile();
    const state = buildIdleState({ mood, temperament: blob.temperament, now, lastEntryAt: last?.createdAt ?? null, memory }, profile);
    const t0 = Date.now();
    try {
      const res = await this.provider.ask(state, buildIdleQuestions(!!memory), { signal, background: true });
      const thought = choiceDist(res.answers, 'idle_thought', IDLE_THOUGHTS, 'content');
      const action = choiceDist(res.answers, 'idle_action', IDLE_ACTIONS, 'look_around');
      const top = Object.entries(thought.dist).sort((a, b) => b[1] - a[1])[0][0];
      if (memory && top.startsWith('remember')) {
        this.recentlyRemembered = [memory.id, ...this.recentlyRemembered.filter((id) => id !== memory.id)].slice(0, 5);
      }
      return {
        thought: { probabilities: thought.dist, confidence: thought.confidence },
        action: { probabilities: action.dist, confidence: action.confidence },
        memory: memory ? { id: memory.id, text: memory.text, when: memory.createdAt } : null,
        ms: Date.now() - t0,
        skipped: null,
      };
    } catch (err) {
      if (err instanceof DecisionError) return { ...empty, skipped: err.code, ms: Date.now() - t0 };
      throw err;
    }
  }

  async models(): Promise<{
    current: string;
    provider: string;
    status: ProviderStatus;
    installed: InstalledModel[];
    catalog: Catalog['models'];
    presets: Preset[];
  }> {
    const [installed, status] = await Promise.all([this.provider.listModels(), this.provider.status()]);
    return {
      current: this.provider.model,
      provider: this.provider.providerId,
      status,
      installed,
      catalog: this.catalog.models,
      presets: this.catalog.presets,
    };
  }

  setModel(model: string) {
    return this.serialize(async () => {
      const name = model.trim();
      if (!name || name.length > 200) throw new Error('invalid model name');
      const status = await this.provider.setModel(name);
      this.db.setSetting(MODEL_SETTING(this.provider.providerId), this.provider.model);
      this.log(`[mote] Switched model to ${this.provider.model}: ${status.state}`);
      return { status, profile: this.provider.profile() };
    });
  }

  // ---- Debug tools ----

  fastForward(hours: number) {
    return this.serialize(async () => {
      const h = Math.min(Math.max(Number(hours) || 0, 0), 24 * 60);
      this.clock.advance(h * 3_600_000);
      this.log(`[mote] Fast-forwarded ${h} h (clock offset now ${(this.clock.offsetMs / 3_600_000).toFixed(1)} h).`);
    }).then(() => this.tick());
  }

  rebirth(seed?: number) {
    return this.serialize(async () => {
      const current = this.db.activeBlob();
      if (current) this.db.retireBlob(current.id, this.clock.now());
      const s = Number.isInteger(seed) && seed! > 0 && seed! < 2 ** 31 ? seed : undefined;
      this.ensureBlob(s);
    }).then(() => this.state(true));
  }
}
