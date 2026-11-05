// The app's core flow: message -> state -> decision model -> signals -> mood engine -> visuals -> journal.
// Plus Mote's life (server/life): a body clock that keeps running while the page is closed, thoughts
// on its own, sleep, and dreams made from its memories. Only the DecisionProvider interface is used
// here; nothing provider-specific.

import { decideIdleAction, decideIntent } from '../shared/decide';
import { topKey } from '../shared/dream';
import { topTwo } from '../shared/math';
import {
  IDLE_ACTIONS,
  IDLE_THOUGHTS,
  type AwayDigest,
  type CharacterReport,
  type Dream,
  type IdleAction,
  type IdleThought,
  type InstalledModel,
  type JournalEntry,
  type LifeEvent,
  type LifeState,
  type LifeView,
  type MoodState,
  type ProviderStatus,
  type Signals,
  type SleepCause,
  type Temperament,
  type WakeCause,
} from '../shared/types';
import { applyBody, moodToVisual, type VisualParams } from '../shared/visuals';
import type { Clock } from './clock';
import type { AppConfig } from './config';
import type { BlobRow, EntryFilter, EventFilter, MoteDb } from './db';
import type { Catalog, Preset } from './decision/catalog';
import { choiceDist, toSignals } from './decision/parse';
import { buildDreamQuestions, buildIdleQuestions, buildQuestions } from './decision/questions';
import { buildState, type BuiltState } from './decision/stateBuilder';
import { DecisionError, type DecisionProvider } from './decision/types';
import { guessLanguage } from './language';
import { buildCharacter } from './life/character';
import { buildDreamState, dreamFromAnswers, isHard, pickDreamSeeds } from './life/dreams';
import { applyDream, applyThought } from './life/effects';
import {
  advanceLife,
  circadian,
  dreamDue,
  fallAsleep,
  initialLife,
  isDreaming,
  lifeWords,
  localHour,
  longing,
  noteEntry,
  sleepPressure,
  tiredness,
  wakeUp,
  type BodyNeeds,
  type Transition,
} from './life/engine';
import { buildIdleState, pickMemory } from './mind';
import { applyMessage, applyUnreadable, decay, describeGrudges, describeMood, grudgeTotal, initialMood, relativeTime } from './mood/engine';
import { describeTemperament, generateTemperament, randomSeed } from './mood/temperament';
import { TUNING } from './mood/tuning';
import wellbeingJson from './wellbeing.json' with { type: 'json' };

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

/** The writer has the page open and visible; idleMs is how long since they last typed or clicked. */
export interface Presence {
  idleMs?: number;
}

export interface WakeInfo {
  cause: WakeCause;
  sleptMs: number;
  /** Woken early or still tired: a slow, sleepy wake-up. */
  groggy: boolean;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LIFE = TUNING.life;
const MAX_MESSAGE_CHARS = 20_000;
const HISTORY_LOOKBACK = 40;
const MODEL_SETTING = (provider: string) => `model:${provider}`;
const HINT_SETTING = 'hint_multilingual_shown';
const BACKGROUND_SETTING = 'life_background';

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
  /** thought: it thought on its own. dream: it dreamed (or remembered a dream). asleep: sleeping, nothing now. */
  kind: 'thought' | 'dream' | 'asleep' | 'skipped';
  thought: { probabilities: Record<IdleThought, number>; confidence: number } | null;
  /** The model's suggestion. */
  action: { probabilities: Record<IdleAction, number>; confidence: number } | null;
  /** What it decided to do: the suggestion x what's on its mind x the time of day x its body. */
  decision: { probabilities: Record<IdleAction, number>; chosen: IdleAction } | null;
  memory: { id: number; text: string; when: number } | null;
  /** Picks the thought's line, so the inner-life log shows the same words later. */
  seed: number;
  event: LifeEvent | null;
  /** A nap turned into real sleep. */
  fellAsleep: boolean;
  /** A nightmare woke it up. */
  wokeUp: boolean;
  life: LifeView | null;
  visual: VisualParams | null;
  mood: MoodSummary | null;
  ms: number;
  skipped: string | null;
}

function emptyThink(over: Partial<ThinkResult> = {}): ThinkResult {
  return {
    kind: 'skipped',
    thought: null,
    action: null,
    decision: null,
    memory: null,
    seed: 0,
    event: null,
    fellAsleep: false,
    wokeUp: false,
    life: null,
    visual: null,
    mood: null,
    ms: 0,
    skipped: null,
    ...over,
  };
}

const hours = (ms: number) => `${(ms / HOUR).toFixed(1)} h`;

export class MoteService {
  private queue: Promise<unknown> = Promise.resolve();
  private recentlyRemembered: number[] = [];
  /** One thought or dream at a time; a new entry cancels it (the writer comes first). */
  private bgBusy = false;
  private bgCtrl: AbortController | null = null;
  private lastDreamTry = -Infinity;
  private characterCache: { key: string; report: CharacterReport } | null = null;
  readonly wellbeing: WellbeingCard;

  constructor(
    private db: MoteDb,
    private provider: DecisionProvider,
    private catalog: Catalog,
    private config: AppConfig,
    private clock: Clock,
    private log: (msg: string) => void = console.log,
  ) {
    const raw = wellbeingJson as WellbeingCard & { $comment?: string };
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

  /** Whether Mote thinks, sleeps-and-dreams and lives on its own (a setting; on by default). */
  backgroundOn(): boolean {
    return this.db.getSetting(BACKGROUND_SETTING) !== '0';
  }

  setBackground(on: boolean) {
    this.db.setSetting(BACKGROUND_SETTING, on ? '1' : '0');
    if (!on) this.bgCtrl?.abort();
    return { background: on };
  }

  private ensureBlob(seed?: number): { blob: BlobRow; newborn: boolean } {
    const existing = this.db.activeBlob();
    if (existing) return { blob: existing, newborn: false };
    const now = this.clock.now();
    const t = generateTemperament(seed ?? randomSeed());
    const blob = this.db.createBlob(t, initialMood(t, now), now, initialLife(now));
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

  // ---- Who Mote is becoming ----

  /**
   * Its character, replayed from its whole history (entries, thoughts, dreams). Cached until
   * something new happens, and at most an hour (traits drift slowly back toward its nature).
   */
  private characterFor(blob: BlobRow, now: number): CharacterReport {
    const key = `${blob.id}:${this.db.historyVersion(blob.id)}:${Math.floor(now / HOUR)}`;
    if (this.characterCache?.key === key) return this.characterCache.report;
    const report = buildCharacter({
      temperament: blob.temperament,
      bornAt: blob.bornAt,
      entries: this.db.characterEntries(blob.id),
      events: this.db.allEvents(blob.id),
      now,
    });
    this.characterCache = { key, report };
    return report;
  }

  /** The mind map: how Mote's character grew, and the memories and dreams that shaped it. */
  character() {
    return this.serialize(() => {
      const { blob } = this.ensureBlob();
      return this.characterFor(blob, this.clock.now());
    });
  }

  private characterBrief(blob: BlobRow, now: number) {
    const c = this.characterFor(blob, now);
    return { traits: c.traits, description: c.description };
  }

  // ---- Mote's life: the body clock ----

  /** The live look: the mood, plus the body (asleep, or tired). */
  private visualOf(mood: MoodState, t: Temperament, life: LifeState): VisualParams {
    return applyBody(moodToVisual(mood, t), { asleep: life.asleep, tired: tiredness(life.energy) });
  }

  private needs(life: LifeState, mood: MoodState, now: number): BodyNeeds {
    return { energy: life.energy, boredom: life.boredom, longing: longing(life, mood.trust, now) };
  }

  lifeView(blobId: number, life: LifeState, mood: MoodState, now: number): LifeView {
    const n = this.needs(life, mood, now);
    const dreaming = isDreaming(life, now);
    const unseen = this.db.listEvents(blobId, { kinds: ['dream'], limit: 3 }).find((e) => e.kind === 'dream' && !e.dream.seen);
    return {
      energy: life.energy,
      longing: n.longing,
      boredom: life.boredom,
      asleep: life.asleep,
      dreaming,
      sleptAt: life.sleptAt,
      wokeAt: life.wokeAt,
      unseenDream: unseen ? { id: unseen.id, at: unseen.at } : null,
      words: lifeWords(life, n, dreaming),
      background: this.backgroundOn(),
    };
  }

  private logTransitions(blobId: number, transitions: Transition[]) {
    for (const tr of transitions) {
      if (tr.kind === 'sleep') {
        this.db.insertEvent(blobId, tr.at, { kind: 'sleep', cause: tr.cause as SleepCause });
        this.log(`[mote] Mote fell asleep (${tr.cause}) at ${new Date(tr.at).toLocaleTimeString()}.`);
      } else {
        this.db.insertEvent(blobId, tr.at, { kind: 'wake', cause: tr.cause as WakeCause, sleptMs: tr.sleptMs ?? 0 });
        this.log(`[mote] Mote woke up (${tr.cause}) at ${new Date(tr.at).toLocaleTimeString()} after ${hours(tr.sleptMs ?? 0)}.`);
      }
    }
  }

  /**
   * Lets time pass for mood and body (call inside serialize()). With `presence`, the writer has the
   * page open: if they were away for a while, the result includes what Mote did meanwhile.
   */
  private advance(blob: BlobRow, now: number, presence: Presence | null) {
    const t = blob.temperament;
    const mood = decay(blob.mood, t, now);
    let start = blob.life;
    if (!start) {
      // A blob from before Mote had a body clock: start it from when it was last seen.
      start = initialLife(Math.min(now, blob.lastSeenAt));
      start.lastEntryAt = this.db.listEntries({ blobId: blob.id, limit: 1 })[0]?.createdAt ?? null;
    }
    const { life, transitions } = advanceLife(start, now, { arousal: mood.arousal });
    this.logTransitions(blob.id, transitions);
    let away: AwayDigest | null = null;
    if (presence) {
      if (now - life.lastSeenAt >= TUNING.wakeAfterMs) away = this.digest(blob.id, life.lastSeenAt, now, mood, life);
      life.lastSeenAt = now;
      if (presence.idleMs !== undefined && Number.isFinite(presence.idleMs)) life.lastActiveAt = Math.max(life.lastActiveAt, now - Math.max(0, presence.idleMs));
    }
    this.db.saveBlobState(blob.id, mood, life, presence ? now : undefined);
    blob.mood = mood;
    blob.life = life;
    return { mood, life, away };
  }

  /** What happened while the writer was away: every sleep, wake-up and dream, and the notable thoughts. */
  private digest(blobId: number, since: number, until: number, mood: MoodState, life: LifeState): AwayDigest {
    const all = this.db.listEvents(blobId, { since, until, limit: 300 });
    const notable = new Set<LifeEvent>(all.filter((e) => e.kind !== 'thought'));
    const score = (e: LifeEvent) => (e.kind === 'thought' ? (e.memory ? 1 : 0) + e.confidence : 0);
    all
      .filter((e) => e.kind === 'thought')
      .sort((a, b) => score(b) - score(a))
      .slice(0, 4)
      .forEach((e) => notable.add(e));
    const events = [...notable].sort((a, b) => a.at - b.at || a.id - b.id).slice(-10);
    const miss = longing(life, mood.trust, until);
    const greeting: AwayDigest['greeting'] = life.asleep
      ? 'asleep'
      : tiredness(life.energy) > 0.6
        ? 'sleepy'
        : grudgeTotal(mood.grudges) >= 0.3
          ? 'sulky'
          : miss >= 0.3
            ? 'joyful'
            : 'warm';
    return { since, until, events, greeting, longing: miss };
  }

  /** This blob's recent entries plus its core memories (any age). */
  private memoryPool(blobId: number, now: number, days: number): JournalEntry[] {
    const recent = this.db.listEntries({ blobId, since: now - days * DAY, limit: 200 });
    const ids = new Set(recent.map((e) => e.id));
    return [...recent, ...this.db.coreMemories(blobId, TUNING.coreMemoryRecalls).filter((e) => !ids.has(e.id))];
  }

  private wakeInfo(tr: Transition, life: LifeState): WakeInfo {
    const slept = tr.sleptMs ?? 0;
    return { cause: tr.cause as WakeCause, sleptMs: slept, groggy: slept < 3 * HOUR || tiredness(life.energy) > 0.2 };
  }

  /** Full state for page load. Lets the time the app was closed pass; reports what Mote did meanwhile. */
  state(markNewborn = false, presence: Presence = { idleMs: 0 }) {
    return this.serialize(async () => {
      const ensured = this.ensureBlob();
      const blob = ensured.blob;
      const newborn = ensured.newborn || markNewborn;
      const now = this.clock.now();
      const t = blob.temperament;
      const elapsed = now - (blob.life?.lastSeenAt ?? blob.lastSeenAt);
      const before = this.visualOf(blob.mood, t, blob.life ?? initialLife(now));
      const { mood, life, away } = this.advance(blob, now, presence);
      const status = await this.provider.status();
      return {
        now,
        newborn,
        blob: this.blobInfo(blob),
        mood: this.moodSummary(mood, now),
        visual: this.visualOf(mood, t, life),
        wake: !newborn && elapsed >= TUNING.wakeAfterMs ? { elapsedMs: elapsed, before } : null,
        life: this.lifeView(blob.id, life, mood, now),
        away: newborn ? null : away,
        character: this.characterBrief(blob, now),
        status,
        profile: this.provider.profile(),
        debugTools: this.config.debugTools,
        clockOffsetMs: this.clock.offsetMs,
        wellbeing: this.wellbeing,
      };
    });
  }

  /** Periodic heartbeat from the page. `presence` is null while the page is hidden. */
  tick(forceStatus = false, presence: Presence | null = { idleMs: 0 }) {
    return this.serialize(async () => {
      const { blob } = this.ensureBlob();
      const now = this.clock.now();
      const { mood, life, away } = this.advance(blob, now, presence);
      return {
        now,
        mood: this.moodSummary(mood, now),
        visual: this.visualOf(mood, blob.temperament, life),
        status: await this.provider.status(forceStatus),
        profile: this.provider.profile(),
        clockOffsetMs: this.clock.offsetMs,
        life: this.lifeView(blob.id, life, mood, now),
        away,
      };
    });
  }

  message(rawText: string) {
    // The writer comes first: a thought or dream in progress is cancelled, freeing the model.
    this.bgCtrl?.abort();
    return this.serialize(async () => {
      const text = rawText.replace(/\r\n/g, '\n').trim().slice(0, MAX_MESSAGE_CHARS);
      if (!text) throw new Error('empty message');
      const { blob } = this.ensureBlob();
      const t = blob.temperament;
      const now = this.clock.now();
      const history = this.db.recentHistory(blob.id, HISTORY_LOOKBACK);
      const profile = this.provider.profile();

      const adv = this.advance(blob, now, { idleMs: 0 });
      const life = adv.life;
      let mood = adv.mood;
      let woke: WakeInfo | null = null;
      if (life.asleep) {
        const tr = wakeUp(life, now, 'message');
        this.logTransitions(blob.id, [tr]);
        woke = this.wakeInfo(tr, life);
      }
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

      // What it decides to do: the model's suggestion x the moment x temperament x who it has become.
      const decision = signals?.intent && signals.situation ? decideIntent(signals.intent, signals.situation, t.archetype, this.characterFor(blob, now).traits) : undefined;
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
          ? { estimatedTokens: built.estimatedTokens, budget: built.budget, dropped: built.droppedMessages, shortened: built.shortenedMessages, usage, invalid, decision }
          : undefined,
      });
      noteEntry(life, now, signals?.userIntensity ?? 0.3);
      this.db.saveBlobState(blob.id, mood, life, now);

      const status = skipped && skipped !== 'language' ? await this.provider.status(true) : await this.provider.status();
      return {
        entry,
        visual: this.visualOf(mood, t, life),
        mood: this.moodSummary(mood, now),
        life: this.lifeView(blob.id, life, mood, now),
        character: this.characterBrief(blob, now),
        woke,
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

  // ---- Mote's life: thinking on its own, sleeping, dreaming ----

  /**
   * One moment of inner life: a thought on its own (what's on its mind, what it does next), a dream
   * if it is asleep and in a dreaming phase, or nothing while it sleeps. Thoughts nudge the mood a
   * little and can turn a nap into real sleep. Not queued behind entries; a new entry (or the page,
   * via `signal`) cancels it. Background requests never load a model (see AskOptions.background).
   */
  async think(signal?: AbortSignal): Promise<ThinkResult> {
    const status = await this.provider.status();
    if (status.state !== 'ready') return emptyThink({ skipped: status.state });
    if (this.bgBusy) return emptyThink({ skipped: 'busy' });
    this.bgBusy = true;
    const ctrl = new AbortController();
    this.bgCtrl = ctrl;
    const sig = signal ? AbortSignal.any([signal, ctrl.signal]) : ctrl.signal;
    try {
      // Presence is reported by the page's ticks, not here, so a thought never swallows the
      // "while you were away" summary.
      const pre = await this.serialize(() => {
        const { blob } = this.ensureBlob();
        const now = this.clock.now();
        return { blob, now, ...this.advance(blob, now, null) };
      });
      if (pre.life.asleep) {
        if (dreamDue(pre.life, pre.now)) return await this.composeDream(sig, { background: true });
        return emptyThink({ kind: 'asleep', skipped: 'asleep', life: this.lifeView(pre.blob.id, pre.life, pre.mood, pre.now) });
      }
      if (pre.life.dreamPending) {
        // It slept without dreaming while the model was away: maybe it remembers the dream now.
        const r = await this.composeDream(sig, { background: true });
        if (r.kind === 'dream' || r.skipped === 'not_loaded' || r.skipped === 'aborted') return r;
      }
      return await this.thought(pre.blob, sig);
    } finally {
      this.bgBusy = false;
      if (this.bgCtrl === ctrl) this.bgCtrl = null;
    }
  }

  private async thought(blob: BlobRow, signal: AbortSignal): Promise<ThinkResult> {
    const t = blob.temperament;
    const life = blob.life!;
    const now = this.clock.now();
    const memory = pickMemory(this.memoryPool(blob.id, now, 14), now, this.recentlyRemembered);
    const character = this.characterFor(blob, now);
    const state = buildIdleState(
      {
        mood: blob.mood,
        temperament: t,
        now,
        lastEntryAt: life.lastEntryAt,
        memory,
        body: this.needs(life, blob.mood, now),
        lastThought: life.lastThought,
        character: character.description,
      },
      this.provider.profile(),
    );
    const t0 = Date.now();
    let answers;
    try {
      answers = (await this.provider.ask(state, buildIdleQuestions(!!memory), { signal, background: true })).answers;
    } catch (err) {
      if (err instanceof DecisionError) return emptyThink({ skipped: err.code, ms: Date.now() - t0 });
      throw err;
    }
    const ms = Date.now() - t0;
    if (signal.aborted) return emptyThink({ skipped: 'aborted', ms });
    const thought = choiceDist(answers, 'idle_thought', IDLE_THOUGHTS, 'content');
    const action = choiceDist(answers, 'idle_action', IDLE_ACTIONS, 'look_around');
    const top = topKey(thought.dist);
    const remembering = !!memory && top.startsWith('remember');
    if (memory && remembering) this.recentlyRemembered = [memory.id, ...this.recentlyRemembered.filter((id) => id !== memory.id)].slice(0, 5);
    const memInfo = memory ? { id: memory.id, text: memory.text, when: memory.createdAt } : null;
    const seed = Math.floor(Math.random() * 1e9);

    // Its consequences, applied to the latest mood (an entry may have arrived meanwhile).
    return this.serialize(() => {
      const b = this.db.activeBlob();
      if (!b || b.id !== blob.id) return emptyThink({ skipped: 'reborn', ms });
      const now2 = this.clock.now();
      const adv = this.advance(b, now2, null);
      const life2 = adv.life;
      const mood2 = applyThought(adv.mood, b.temperament, thought.dist, now2);
      const hour = localHour(now2);
      const decision = decideIdleAction(action.dist, thought.dist, hour, this.needs(life2, mood2, now2), character.traits);
      const chosen = topKey(decision);
      life2.lastThought = { kind: top, at: now2, memoryId: remembering ? memory!.id : null };
      if (chosen === 'wander' || chosen === 'look_around' || chosen === 'stretch') life2.boredom *= LIFE.boredomAfterAction;
      const event = this.db.insertEvent(b.id, now2, {
        kind: 'thought',
        thought: thought.dist,
        confidence: thought.confidence,
        action: decision,
        actionConfidence: action.confidence,
        chosen,
        memory: remembering ? memInfo : null,
        seed,
        watched: now2 - life2.lastSeenAt < LIFE.watchedMs,
      });
      // A nap when it's really sleepy (and the writer has been quiet a while) becomes real sleep.
      let fellAsleep = false;
      const quiet = now2 - Math.max(life2.lastActiveAt, life2.lastEntryAt ?? -Infinity) >= LIFE.sleepAfterQuietMs;
      if (chosen === 'nap' && quiet && sleepPressure(life2.energy, hour) >= LIFE.napSleepAt) {
        this.logTransitions(b.id, [fallAsleep(life2, now2, circadian(hour) > 0.1 ? 'night' : 'nap')]);
        fellAsleep = true;
      }
      if (remembering) this.db.markRecalled([memory!.id], now2);
      this.db.saveBlobState(b.id, mood2, life2);
      return {
        kind: 'thought',
        thought: { probabilities: thought.dist, confidence: thought.confidence },
        action: { probabilities: action.dist, confidence: action.confidence },
        decision: { probabilities: decision, chosen },
        memory: memInfo,
        seed,
        event,
        fellAsleep,
        wokeUp: false,
        life: this.lifeView(b.id, life2, mood2, now2),
        visual: this.visualOf(mood2, b.temperament, life2),
        mood: this.moodSummary(mood2, now2),
        ms,
        skipped: null,
      } satisfies ThinkResult;
    });
  }

  /**
   * A dream: code picks the memories (the day's residue), the model decides where it goes, what
   * happens, how it feels and how it ends. Asleep, it counts as tonight's dream; awake, it is a dream
   * it remembers from a night when the model wasn't around.
   */
  private async composeDream(signal: AbortSignal | undefined, o: { background: boolean }): Promise<ThinkResult> {
    const { blob } = this.ensureBlob();
    const now = this.clock.now();
    this.lastDreamTry = now;
    const remembered = !blob.life?.asleep;
    const seeds = pickDreamSeeds(this.memoryPool(blob.id, now, 3), now);
    const state = buildDreamState(
      { seeds, mood: blob.mood, temperament: blob.temperament, now, character: this.characterFor(blob, now).description },
      this.provider.profile(),
    );
    const t0 = Date.now();
    let answers;
    try {
      answers = (await this.provider.ask(state, buildDreamQuestions(), { signal, background: o.background })).answers;
    } catch (err) {
      if (err instanceof DecisionError) return emptyThink({ skipped: err.code, ms: Date.now() - t0 });
      throw err;
    }
    const ms = Date.now() - t0;
    if (signal?.aborted) return emptyThink({ skipped: 'aborted', ms });
    const base = dreamFromAnswers(answers, seeds, this.provider.model, remembered);

    return this.serialize(() => {
      const b = this.db.activeBlob();
      if (!b || b.id !== blob.id) return emptyThink({ skipped: 'reborn', ms });
      const now2 = this.clock.now();
      const adv = this.advance(b, now2, null);
      const life = adv.life;
      const out = applyDream(adv.mood, b.temperament, base, seeds.some(isHard), now2);
      const dream: Dream = { ...base, effect: out.effect, seen: false };
      const event = this.db.insertEvent(b.id, now2, { kind: 'dream', dream });
      life.lastDreamAt = now2;
      if (life.asleep) life.dreamsThisSleep += 1;
      life.dreamPending = false;
      let wokeUp = false;
      if (out.effect === 'nightmare' && life.asleep) {
        this.logTransitions(b.id, [wakeUp(life, now2, 'nightmare')]);
        life.lastActiveAt = now2; // lies awake a while before it can fall asleep again
        wokeUp = true;
      }
      if (seeds.length) this.db.markRecalled(seeds.map((e) => e.id), now2);
      this.db.saveBlobState(b.id, out.mood, life);
      const about = seeds[0] ? ` about "${seeds[0].text.slice(0, 40)}${seeds[0].text.length > 40 ? '…' : ''}" (${relativeTime(now2 - seeds[0].createdAt)})` : '';
      this.log(`[mote] Mote ${remembered ? 'remembered a dream' : 'dreamed'}: ${topKey(base.event)}, ${topKey(base.place)}, ${topKey(base.feeling)}, ${topKey(base.ending)}${about} -> ${out.effect}.`);
      return {
        ...emptyThink(),
        kind: 'dream',
        seed: event.id,
        event,
        wokeUp,
        life: this.lifeView(b.id, life, out.mood, now2),
        visual: this.visualOf(out.mood, b.temperament, life),
        mood: this.moodSummary(out.mood, now2),
        ms,
      } satisfies ThinkResult;
    });
  }

  /**
   * Called every minute by the server (server/life/loop.ts), whether or not a page is open: time
   * passes for the body, and while nobody is watching Mote thinks now and then, and dreams in its
   * sleep. While a page is open and visible, the page does the thinking instead.
   */
  async live(): Promise<void> {
    const pre = await this.serialize(() => {
      const { blob } = this.ensureBlob();
      const now = this.clock.now();
      return { now, life: this.advance(blob, now, null).life };
    });
    if (!this.backgroundOn() || this.bgBusy) return;
    const { now, life } = pre;
    if (now - life.lastSeenAt < LIFE.watchedMs) return;
    if (life.asleep) {
      if (dreamDue(life, now) && now - this.lastDreamTry >= LIFE.awayRetryMs) await this.think();
      return;
    }
    if (now < life.nextAwayThinkAt) return;
    const r = await this.think();
    const wait = r.skipped && r.skipped !== 'asleep' ? LIFE.awayRetryMs : LIFE.awayThinkMinMs + Math.random() * (LIFE.awayThinkMaxMs - LIFE.awayThinkMinMs);
    await this.serialize(() => {
      const b = this.db.activeBlob();
      if (!b?.life) return;
      b.life.nextAwayThinkAt = this.clock.now() + wait;
      this.db.saveBlobState(b.id, b.mood, b.life);
    });
  }

  /** Woken by the writer (poking it awake). */
  wake(cause: 'poke' = 'poke') {
    return this.serialize(async () => {
      const { blob } = this.ensureBlob();
      const now = this.clock.now();
      const { mood, life } = this.advance(blob, now, { idleMs: 0 });
      let woke: WakeInfo | null = null;
      if (life.asleep) {
        const tr = wakeUp(life, now, cause);
        this.logTransitions(blob.id, [tr]);
        woke = this.wakeInfo(tr, life);
        this.db.saveBlobState(blob.id, mood, life, now);
      }
      return { woke, visual: this.visualOf(mood, blob.temperament, life), life: this.lifeView(blob.id, life, mood, now) };
    });
  }

  dreams(f: Pick<EventFilter, 'before' | 'limit'>) {
    const blob = this.db.activeBlob();
    return { dreams: blob ? this.db.listEvents(blob.id, { ...f, kinds: ['dream'] }) : [] };
  }

  /** The inner-life log: thoughts on its own, sleep, waking, dreams. Newest first. */
  lifeLog(f: Pick<EventFilter, 'before' | 'limit'>) {
    const blob = this.db.activeBlob();
    return { events: blob ? this.db.listEvents(blob.id, f) : [] };
  }

  markDreamSeen(id: number) {
    return this.serialize(() => {
      const e = this.db.event(id);
      if (!e || e.kind !== 'dream') throw new Error('dream not found');
      if (!e.dream.seen) this.db.updateEvent(id, { kind: 'dream', dream: { ...e.dream, seen: true } });
      return { ok: true };
    });
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

  /** Puts Mote to sleep now (tired enough to stay asleep for a while). */
  sleepNow() {
    return this.serialize(() => {
      const { blob } = this.ensureBlob();
      const now = this.clock.now();
      const { life } = this.advance(blob, now, null);
      if (!life.asleep) {
        life.energy = Math.min(life.energy, 0.3);
        this.logTransitions(blob.id, [fallAsleep(life, now, circadian(localHour(now)) > 0.1 ? 'night' : 'tired')]);
        this.db.saveBlobState(blob.id, blob.mood, life);
      }
    }).then(() => this.tick());
  }

  /** Dreams right now (asks the model even if it isn't loaded: you pressed the button). */
  async dreamNow(): Promise<ThinkResult> {
    if (this.bgBusy) return emptyThink({ skipped: 'busy' });
    this.bgBusy = true;
    try {
      return await this.composeDream(undefined, { background: false });
    } finally {
      this.bgBusy = false;
    }
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
