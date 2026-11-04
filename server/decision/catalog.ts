// The decision-model catalog (models.json): profiles, presets and name matching.

import type { ModelProfile, Tier } from '../../shared/types';
import catalogJson from './models.json' with { type: 'json' };

export interface Preset {
  id: string;
  label: string;
  hardware: string;
  models: { model: string; when: string }[];
}

interface CatalogFile {
  defaults: { maxStateTokens: number; maxRecentMessages: number; recentMessageMaxChars: number; minOllama: string };
  presets: Preset[];
  models: ModelProfile[];
}

/** Splits "name:tag" (tag defaults to "latest"). */
export function splitName(name: string): { base: string; tag: string } {
  const n = name.trim().toLowerCase();
  const slash = n.lastIndexOf('/');
  const colon = n.indexOf(':', slash + 1);
  return colon === -1 ? { base: n, tag: 'latest' } : { base: n.slice(0, colon), tag: n.slice(colon + 1) || 'latest' };
}

export function canonicalName(name: string): string {
  const { base, tag } = splitName(name);
  return `${base}:${tag}`;
}

/** True for Ollama cloud tags such as `clef:cloud` or `clef:27b-cloud`. */
export function isCloudName(name: string): boolean {
  const { tag } = splitName(name);
  return tag === 'cloud' || tag.endsWith('-cloud');
}

export class Catalog {
  readonly presets: Preset[];
  readonly models: ModelProfile[];
  readonly defaults: CatalogFile['defaults'];

  constructor(data: CatalogFile = catalogJson as unknown as CatalogFile) {
    this.presets = data.presets;
    this.models = data.models;
    this.defaults = data.defaults;
  }

  /** Exact match on name or alias, then fall back to another tag of the same model family (e.g. a quantization). */
  find(name: string): ModelProfile | undefined {
    const c = canonicalName(name);
    const exact = this.models.find((m) => canonicalName(m.name) === c || m.aliases.some((a) => canonicalName(a) === c));
    if (exact) return exact;
    const { base } = splitName(name);
    return this.models.find((m) => splitName(m.name).base === base && splitName(m.name).tag === 'latest');
  }

  /** A profile for any model name: the catalog entry, or a generic one built from defaults (and the server's context size when known). */
  profileFor(name: string, opts: { contextTokens?: number; minOllama?: string } = {}): ModelProfile {
    const found = this.find(name);
    if (found) {
      if (!opts.contextTokens) return found;
      // Never budget more than about half of the context the server actually loaded.
      return { ...found, maxStateTokens: Math.min(found.maxStateTokens, Math.max(200, Math.floor(opts.contextTokens * 0.6))) };
    }
    const d = this.defaults;
    const ctx = opts.contextTokens;
    const maxStateTokens = ctx ? Math.max(200, Math.min(d.maxStateTokens * 2, Math.floor(ctx * 0.4))) : d.maxStateTokens;
    return {
      name,
      aliases: [],
      publisher: 'Unknown',
      parameters: 'Unknown',
      downloadSize: 'Unknown',
      inputTypes: ['text'],
      languages: ['Unknown'],
      englishOnly: false,
      minOllama: opts.minOllama ?? d.minOllama,
      minOllamaSource: 'api minimum',
      contextNote: ctx ? `Server context: ${ctx} tokens.` : 'Not in the catalog.',
      maxStateTokens,
      maxRecentMessages: d.maxRecentMessages,
      recentMessageMaxChars: d.recentMessageMaxChars,
      compactState: maxStateTokens < 500,
      license: 'Unknown: check the model page',
      tier: 'other' as Tier,
      notes: 'Not in Mote’s catalog. It will be used if Ollama reports it as a decision model.',
      cloudTags: [],
    };
  }
}
