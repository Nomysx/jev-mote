// Thin client for the local Mote server. All requests stay on this machine.

import type { Emotion, InstalledModel, JournalEntry, ModelProfile, MoodState, ProviderStatus, Temperament } from '../../shared/types';
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

export interface StateResponse {
  now: number;
  newborn: boolean;
  blob: BlobInfo;
  mood: MoodSummary;
  visual: VisualParams;
  wake: { elapsedMs: number; before: VisualParams } | null;
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
}

export interface MessageResponse {
  entry: JournalEntry;
  visual: VisualParams;
  mood: MoodSummary;
  pulse: boolean;
  distress: boolean;
  wellbeing: WellbeingCard | null;
  hint: string | null;
  notice: string | null;
  status: ProviderStatus;
  stateInfo: { estimatedTokens: number; budget: number; dropped: number; shortened: number; overBudget: boolean } | null;
  dominant: Emotion | null;
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

export const api = {
  state: () => call<StateResponse>('/api/state'),
  tick: (force = false) => call<TickResponse>(`/api/tick${force ? '?force=1' : ''}`),
  message: (text: string) => call<MessageResponse>('/api/message', { body: { text } }),
  journal: (q: { area?: string; emotion?: string; before?: number; since?: number; limit?: number }) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
    return call<{ entries: JournalEntry[] }>(`/api/journal?${p}`);
  },
  models: () => call<ModelsResponse>('/api/models'),
  setModel: (model: string) => call<{ status: ProviderStatus; profile: ModelProfile }>('/api/settings/model', { body: { model } }),
  fastForward: (hours: number) => call<TickResponse>('/api/debug/fast-forward', { body: { hours } }),
  rebirth: (seed?: number) => call<StateResponse>('/api/debug/rebirth', { body: { seed } }),
};
