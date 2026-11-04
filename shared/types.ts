// Types shared by the server and the client.

export const EMOTIONS = ['joy', 'sadness', 'anger', 'fear', 'calm', 'curiosity', 'disgust'] as const;
export type Emotion = (typeof EMOTIONS)[number];
export type EmotionDist = Record<Emotion, number>;

export const LIFE_AREAS = ['work', 'relationships', 'health', 'self', 'other'] as const;
export type LifeArea = (typeof LIFE_AREAS)[number];

export const TONES = ['kind', 'neutral', 'dismissive', 'hostile'] as const;
export type Tone = (typeof TONES)[number];

export const TRUST_CHANGES = ['decrease', 'stay', 'increase'] as const;
export type TrustChange = (typeof TRUST_CHANGES)[number];

export const ARCHETYPES = ['anxious', 'cheerful', 'moody', 'stoic', 'curious'] as const;
export type Archetype = (typeof ARCHETYPES)[number];

/** What kind of moment an entry is (asked of the model, shown as Mote's thoughts). */
export const SITUATIONS = [
  'greeting',
  'goodnight',
  'win',
  'good_news',
  'gratitude',
  'kindness',
  'apology',
  'insult',
  'loss',
  'loneliness',
  'conflict',
  'worry',
  'stress',
  'tired',
  'self_criticism',
  'confusion',
  'change',
  'question',
  'ordinary',
  'none',
] as const;
export type Situation = (typeof SITUATIONS)[number];

/** What Mote decides to do after reading an entry. */
export const INTENTS = ['come_closer', 'comfort', 'celebrate', 'give_space', 'hide', 'listen', 'play', 'rest'] as const;
export type Intent = (typeof INTENTS)[number];

/** What is on Mote's mind while nobody is writing (background thinking). */
export const IDLE_THOUGHTS = [
  'remember_good',
  'remember_hard',
  'miss_writer',
  'wonder_day',
  'worried',
  'grateful',
  'still_hurt',
  'forgiving',
  'sleepy',
  'bored',
  'content',
  'curious',
  'daydream',
] as const;
export type IdleThought = (typeof IDLE_THOUGHTS)[number];

/** What Mote does on its own while it waits. */
export const IDLE_ACTIONS = ['nap', 'look_around', 'wait_by_text', 'wander', 'stretch', 'hum', 'sulk', 'glow'] as const;
export type IdleAction = (typeof IDLE_ACTIONS)[number];

/** Where a dream takes place (the model chooses when Mote dreams). */
export const DREAM_PLACES = ['sky', 'sea', 'forest', 'city', 'home', 'school', 'space', 'dark'] as const;
export type DreamPlace = (typeof DREAM_PLACES)[number];

/** What happens in a dream. */
export const DREAM_EVENTS = ['flying', 'falling', 'chased', 'lost', 'searching', 'floating', 'held', 'reunion', 'storm', 'melting', 'growing', 'shrinking'] as const;
export type DreamEvent = (typeof DREAM_EVENTS)[number];

/** How a dream ends. */
export const DREAM_ENDINGS = ['peaceful', 'woke_suddenly', 'faded', 'transformed', 'found'] as const;
export type DreamEnding = (typeof DREAM_ENDINGS)[number];

export type SleepCause = 'night' | 'tired' | 'nap';
export type WakeCause = 'morning' | 'rested' | 'message' | 'poke' | 'nightmare';

/**
 * Mote's body: needs that change by themselves as time passes, simulated in code (like the mood).
 * It keeps living while the page is closed, as long as the Mote server runs.
 */
export interface LifeState {
  /** 0..1: drains while awake (faster when stirred up), refills while asleep. */
  energy: number;
  /** 0..1: restlessness that builds while awake with nothing happening. */
  boredom: number;
  asleep: boolean;
  sleepCause: SleepCause | null;
  sleptAt: number | null;
  wokeAt: number | null;
  dreamsThisSleep: number;
  lastDreamAt: number | null;
  /** It slept without dreaming (the model wasn't loaded): it may still remember the dream later. */
  dreamPending: boolean;
  /** The last thing it thought on its own, so the next thought can follow from it. */
  lastThought: { kind: IdleThought; at: number; memoryId: number | null } | null;
  lastEntryAt: number | null;
  /** Last time the page was open and visible: the writer was there. */
  lastSeenAt: number;
  /** Last time the writer did something (typed, wrote, poked). It never falls asleep right after. */
  lastActiveAt: number;
  /** When it next thinks on its own while nobody is watching. */
  nextAwayThinkAt: number;
  updatedAt: number;
}

/** A dream: what the decision model chose, plus the memories it came from. */
export interface Dream {
  place: Record<DreamPlace, number>;
  event: Record<DreamEvent, number>;
  feeling: Record<Emotion, number>;
  ending: Record<DreamEnding, number>;
  /** 0..1: how sure the model was about what happened (vivid vs. hazy). */
  vividness: number;
  /** The entries it dreamed about (most recent first), never ones that raised a distress flag. */
  memories: { id: number; text: string; when: number }[];
  /** Words from those entries that drift through the dream. */
  fragments: string[];
  /** What the dream did to it. */
  effect: 'processed' | 'nightmare' | 'sweet' | 'none';
  /** It slept without dreaming and remembered the dream later. */
  remembered: boolean;
  model: string;
  /** Replayed to the writer. */
  seen: boolean;
}

export type LifeEventData =
  | {
      kind: 'thought';
      thought: Record<IdleThought, number>;
      confidence: number;
      /** What it decided to do (model suggestion x what's on its mind x its body). */
      action: Record<IdleAction, number>;
      actionConfidence: number;
      chosen: IdleAction;
      memory: { id: number; text: string; when: number } | null;
      /** Picks the thought's line, so the timeline shows the same words later. */
      seed: number;
      /** The writer was watching when it happened. */
      watched: boolean;
    }
  | { kind: 'sleep'; cause: SleepCause }
  | { kind: 'wake'; cause: WakeCause; sleptMs: number }
  | { kind: 'dream'; dream: Dream };

/** Something that happened in Mote's life (its inner-life log). */
export type LifeEvent = LifeEventData & { id: number; at: number };

/** Mote's body as the page shows it. */
export interface LifeView {
  energy: number;
  /** 0..1: missing the writer (grows while they're away, faster the more it trusts them). */
  longing: number;
  boredom: number;
  asleep: boolean;
  /** Asleep and in a dreaming (REM) phase right now. */
  dreaming: boolean;
  sleptAt: number | null;
  wokeAt: number | null;
  /** The newest dream the writer hasn't watched yet. */
  unseenDream: { id: number; at: number } | null;
  /** "awake, a bit tired, misses you": for settings and debug. */
  words: string;
  /** Lets it think, sleep-dream and live on its own (a server setting). */
  background: boolean;
}

/**
 * Character: who Mote becomes. It starts from its temperament (its nature, fixed at birth) and is
 * shaped by its life: how it is treated, what it thinks about on its own, and what it dreams.
 */
export const TRAITS = ['warmth', 'trust', 'courage', 'wariness', 'curiosity', 'playfulness', 'dreaminess'] as const;
export type Trait = (typeof TRAITS)[number];
export type Traits = Record<Trait, number>;

export interface Milestone {
  at: number;
  kind: string;
  /** "First dream", "Began to trust you", "Became playful"... */
  label: string;
  detail?: string;
  /** The entry or life event behind it. */
  ref?: { type: 'entry' | 'event'; id: number };
}

/** How Mote's character developed, for the mind map. */
export interface CharacterReport {
  bornAt: number;
  archetype: Archetype;
  nature: Traits;
  traits: Traits;
  /** "a warm, playful dreamer who trusts you". */
  description: string;
  natureDescription: string;
  /** Trait values over time, oldest first. */
  timeline: { at: number; traits: Traits }[];
  milestones: Milestone[];
  /** Entries as nodes: what each one changed, how often Mote recalls it. Never distress entries. */
  memories: {
    id: number;
    at: number;
    text: string;
    emotion: Emotion | 'none';
    valence: number;
    intensity: number;
    recalls: number;
    core: boolean;
    impact: Partial<Traits>;
  }[];
  dreams: {
    id: number;
    at: number;
    event: DreamEvent;
    place: DreamPlace;
    feeling: Emotion;
    effect: Dream['effect'];
    memoryIds: number[];
    impact: Partial<Traits>;
  }[];
  /** How often each kind of thought came up on its own. */
  thoughtCounts: Partial<Record<IdleThought, number>>;
}

export type Greeting = 'joyful' | 'warm' | 'sulky' | 'sleepy' | 'asleep';

/** What Mote did while the page was closed or hidden. */
export interface AwayDigest {
  since: number;
  until: number;
  events: LifeEvent[];
  /** How it greets the writer, from how much it missed them, its grudges and how tired it is. */
  greeting: Greeting;
  longing: number;
}

/** Permanent personality, generated once at birth from a seed. All traits are 0..1. */
export interface Temperament {
  seed: number;
  archetype: Archetype;
  baselineValence: number;
  volatility: number;
  trustSpeed: number;
  recoverySpeed: number;
  grudgeMemory: number;
  /** Base color hue, 0..1 around the color wheel. */
  hue: number;
  /** Base shape lumpiness. */
  lumpiness: number;
}

export interface Grudge {
  id: string;
  /** 0..1, decays over time according to grudgeMemory. */
  weight: number;
  createdAt: number;
  cause: 'hostile' | 'dismissive';
}

export interface MoodState {
  /** -1..1 */
  valence: number;
  /** 0..1 */
  arousal: number;
  emotions: EmotionDist;
  /** 0..1, how clear-cut the latest reaction was (from the model's confidence). Drifts back to a resting value. */
  clarity: number;
  /** 0..1, how evenly the latest reaction was split between its top two emotions. Drifts back to 0. */
  mixedness: number;
  /** The two emotions of the latest mixed reaction (used for the two color zones). */
  mixPair: [Emotion, Emotion];
  /** 0..1 */
  trust: number;
  grudges: Grudge[];
  /** Recent trust gains, used to cap how fast trust can grow per day. */
  trustGains: { at: number; amount: number }[];
  /** 0..1, a calming overlay after a distress signal. Fades over time. */
  soothe: number;
  updatedAt: number;
}

/** What the app extracted from one decision-model response, in domain terms. */
export interface Signals {
  userEmotion: Record<Emotion | 'none', number>;
  userEmotionTop: Emotion | 'none';
  /** -2..+2 */
  userValence: number;
  /** 0..1 */
  userIntensity: number;
  lifeArea: LifeArea;
  lifeAreaProbabilities: Record<LifeArea, number>;
  tone: Record<Tone, number>;
  blobReaction: EmotionDist;
  /** 0..1, from the model's `confidence` for blob_reaction. */
  blobReactionConfidence: number;
  trustChange: Record<TrustChange, number>;
  /** Probability (0..1) that the message is unexpected. */
  surprising: number;
  /** Probability (0..1) that the writer expresses self-harm thoughts or crisis. */
  distress: number;
  /** What kind of moment this was. Missing on entries saved before thoughts existed. */
  situation?: Record<Situation, number>;
  situationConfidence?: number;
  /** What Mote decided to do. Missing on older entries. */
  intent?: Record<Intent, number>;
  intentConfidence?: number;
  /** Answers that were missing or malformed and replaced with neutral defaults. */
  warnings: string[];
}

export type ProviderState =
  | 'ready'
  | 'checking'
  | 'offline'
  | 'outdated'
  | 'endpoint_missing'
  | 'model_missing'
  | 'cloud_model'
  | 'not_decision_model'
  | 'remote_host'
  | 'error';

export interface ProviderStatus {
  state: ProviderState;
  provider: string;
  model: string;
  /** Short friendly message for the UI. */
  message: string;
  /** Optional command the user can run, e.g. `ollama pull laya`. */
  command?: string;
  serverVersion?: string;
  requiredVersion?: string;
  checkedAt: number;
}

export interface InstalledModel {
  name: string;
  sizeBytes?: number;
  /** Matches a profile in the model catalog. */
  catalogName?: string;
  isDecisionModel: boolean;
  isCloud: boolean;
  tier?: Tier;
  languages?: string[];
}

export type Tier = 'lite' | 'balanced' | 'best' | 'other';

export interface ModelProfile {
  name: string;
  aliases: string[];
  publisher: string;
  parameters: string;
  downloadSize: string;
  inputTypes: string[];
  languages: string[];
  englishOnly: boolean;
  minOllama: string;
  minOllamaSource: 'model page' | 'api minimum';
  contextNote: string;
  maxStateTokens: number;
  maxRecentMessages: number;
  recentMessageMaxChars: number;
  compactState: boolean;
  /**
   * Optional: which state fields to send (new_message is always sent). Some small encoder models
   * blend every word in the state into every answer, so they get a minimal state.
   */
  stateFields?: ('current_mood' | 'temperament' | 'grudges' | 'recent_messages')[];
  /** "numbers" describes the mood without emotion words (avoids leaking words into answers). */
  moodStyle?: 'words' | 'numbers';
  /** Notes from testing this model with Mote's questions. */
  testNotes?: string;
  license: string;
  tier: Tier;
  notes: string;
  cloudTags: string[];
}

export interface JournalEntry {
  id: number;
  createdAt: number;
  text: string;
  provider: string | null;
  model: string | null;
  /** Raw answers from the decision model, exactly as returned (after validation). */
  answers: unknown | null;
  signals: Signals | null;
  visual: import('./visuals').VisualParams;
  lifeArea: LifeArea | null;
  userEmotion: Emotion | 'none' | null;
  distress: boolean;
  /** Why the model was not asked, or why it failed. */
  skipped: string | null;
  /** How often Mote has thought or dreamed about this entry. Often-recalled entries become core memories. */
  recalls?: number;
  /** What Mote decided to do at the time (weighed with its character then). Missing on older entries. */
  decision?: Record<Intent, number>;
}
