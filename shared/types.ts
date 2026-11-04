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
}
