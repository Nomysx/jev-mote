// Thin client for the local Mote server. All requests stay on this machine.

import type {
  AwayDigest,
  CharacterReport,
  Emotion,
  IdleAction,
  IdleThought,
  InstalledModel,
  JournalEntry,
  LifeEvent,
  LifeView,
  ModelProfile,
  MoodState,
  ProviderStatus,
  SensesView,
  Temperament,
  Traits,
} from '../../shared/types';
import type { VisualParams } from '../../shared/visuals';

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

export interface WellbeingCard {
  title: string;
  body: string;
  lines: { label: string; text: string }[];
  note: string;
}

export interface BlobInfo {
  seed: number;
  archetype: string;
  description: string;
  temperament: Temperament;
  bornAt: number;
}

export interface CharacterBrief {
  traits: Traits;
  description: string;
}

export interface WakeInfo {
  cause: string;
  sleptMs: number;
  groggy: boolean;
}

export interface StateResponse {
  now: number;
  newborn: boolean;
  blob: BlobInfo;
  mood: MoodSummary;
  visual: VisualParams;
  wake: { elapsedMs: number; before: VisualParams } | null;
  life: LifeView;
  away: AwayDigest | null;
  character: CharacterBrief;
  status: ProviderStatus;
  profile: ModelProfile;
  debugTools: boolean;
  clockOffsetMs: number;
  wellbeing: WellbeingCard;
}

export interface TickResponse {
  now: number;
  mood: MoodSummary;
  visual: VisualParams;
  status: ProviderStatus;
  profile: ModelProfile;
  clockOffsetMs: number;
  life: LifeView;
  away: AwayDigest | null;
}

export interface MessageResponse {
  entry: JournalEntry;
  visual: VisualParams;
  mood: MoodSummary;
  life: LifeView;
  character: CharacterBrief;
  woke: WakeInfo | null;
  pulse: boolean;
  distress: boolean;
  wellbeing: WellbeingCard | null;
  hint: string | null;
  notice: string | null;
  status: ProviderStatus;
  stateInfo: { estimatedTokens: number; budget: number; dropped: number; shortened: number; overBudget: boolean } | null;
  dominant: Emotion | null;
}

/** One moment of inner life (see MoteService.think). */
export interface ThinkResponse {
  kind: 'thought' | 'dream' | 'asleep' | 'skipped';
  thought: { probabilities: Record<IdleThought, number>; confidence: number } | null;
  action: { probabilities: Record<IdleAction, number>; confidence: number } | null;
  decision: { probabilities: Record<IdleAction, number>; chosen: IdleAction } | null;
  memory: { id: number; text: string; when: number } | null;
  seed: number;
  event: LifeEvent | null;
  fellAsleep: boolean;
  wokeUp: boolean;
  life: LifeView | null;
  visual: VisualParams | null;
  mood: MoodSummary | null;
  ms: number;
  skipped: string | null;
}

export interface WakeResponse {
  woke: WakeInfo | null;
  visual: VisualParams;
  life: LifeView;
}

export interface EngineInfo {
  state: 'running' | 'stopped' | 'missing' | 'installing' | 'starting' | 'error';
  source: 'system' | 'managed' | null;
  url: string;
  version: string | null;
  systemInstalled: boolean;
  canInstall: boolean;
  downloadSize: string | null;
  job: { phase: 'downloading' | 'extracting' | 'starting'; received: number; total: number | null } | null;
  error: string | null;
  dir: string;
}

export interface PullJob {
  model: string;
  status: string;
  completed: number;
  total: number;
  done: boolean;
  error: string | null;
  startedAt: number;
}

export interface SetupResponse {
  provider: string;
  engine: EngineInfo | null;
  installed: InstalledModel[];
  current: string;
  status: ProviderStatus;
  pulls: PullJob[];
  recommended: { model: string; label: string; why: string; size: string; best: boolean; big: boolean }[];
  memoryGb: number;
  desktop: boolean;
}

export interface ModelsResponse {
  current: string;
  provider: string;
  status: ProviderStatus;
  installed: InstalledModel[];
  catalog: ModelProfile[];
  presets: { id: string; label: string; hardware: string; models: { model: string; when: string }[] }[];
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const query = (q: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
};

export const api = {
  state: (idleMs = 0) => call<StateResponse>(`/api/state?${query({ idle: Math.round(idleMs) })}`),
  /** `seen`: the page is visible (the writer is here). */
  tick: (force = false, presence: { seen: boolean; idleMs: number } = { seen: true, idleMs: 0 }) =>
    call<TickResponse>(`/api/tick?${query({ force: force ? 1 : undefined, seen: presence.seen ? 1 : 0, idle: Math.round(presence.idleMs) })}`),
  message: (text: string) => call<MessageResponse>('/api/message', { body: { text } }),
  journal: (q: { area?: string; emotion?: string; before?: number; since?: number; limit?: number }) => call<{ entries: JournalEntry[] }>(`/api/journal?${query(q)}`),
  models: () => call<ModelsResponse>('/api/models'),
  setModel: (model: string) => call<{ status: ProviderStatus; profile: ModelProfile }>('/api/settings/model', { body: { model } }),
  fastForward: (hours: number) => call<TickResponse>('/api/debug/fast-forward', { body: { hours } }),
  /** Inner life; aborting the signal also cancels the model request on the server. */
  think: async (signal: AbortSignal): Promise<ThinkResponse> => {
    const res = await fetch('/api/think', { method: 'POST', signal });
    if (!res.ok) throw new Error(`think failed (${res.status})`);
    return (await res.json()) as ThinkResponse;
  },
  wake: () => call<WakeResponse>('/api/wake', { body: {} }),
  dreams: (q: { before?: number; limit?: number } = {}) => call<{ dreams: LifeEvent[] }>(`/api/dreams?${query(q)}`),
  dreamSeen: (id: number) => call<{ ok: boolean }>(`/api/dreams/${id}/seen`, { body: {} }),
  lifeLog: (q: { before?: number; limit?: number } = {}) => call<{ events: LifeEvent[] }>(`/api/life?${query(q)}`),
  character: () => call<CharacterReport>('/api/character'),
  setLifeBackground: (background: boolean) => call<{ background: boolean }>('/api/settings/life', { body: { background } }),
  senses: () => call<SensesView>('/api/senses'),
  setPresence: (presence: boolean) => call<SensesView>('/api/settings/senses', { body: { presence } }),
  forgetRhythm: () => call<SensesView>('/api/senses/forget', { body: {} }),
  setup: () => call<SetupResponse>(`/api/setup?${query({ lang: navigator.language })}`),
  installEngine: () => call<{ ok: boolean }>('/api/setup/engine', { body: { action: 'install' } }),
  startEngine: () => call<{ status: ProviderStatus }>('/api/setup/engine', { body: { action: 'start' } }),
  pull: (model: string, use = true) => call<PullJob>('/api/setup/pull', { body: { model, use } }),
  cancelPull: (model: string) => call<{ ok: boolean }>('/api/setup/pull/cancel', { body: { model } }),
  debugSleep: () => call<TickResponse>('/api/debug/sleep', { body: {} }),
  debugDream: () => call<ThinkResponse>('/api/debug/dream', { body: {} }),
  rebirth: (seed?: number) => call<StateResponse>('/api/debug/rebirth', { body: { seed } }),
};
