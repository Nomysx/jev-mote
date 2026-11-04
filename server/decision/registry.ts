// Provider discovery. Every file in ./providers default-exports a ProviderFactory with an `id`.
// Adding a provider = adding one file there and setting DECISION_PROVIDER=<id>.

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DecisionProvider, ProviderContext, ProviderFactory } from './types';

const PROVIDERS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'providers');

let factories: Map<string, ProviderFactory> | null = null;

export async function loadProviderFactories(dir = PROVIDERS_DIR): Promise<Map<string, ProviderFactory>> {
  if (factories && dir === PROVIDERS_DIR) return factories;
  const found = new Map<string, ProviderFactory>();
  const files = readdirSync(dir).filter((f) => /\.(ts|js|mjs)$/.test(f) && !/\.(test|spec|d)\.(ts|js)$/.test(f));
  for (const file of files.sort()) {
    const mod = (await import(pathToFileURL(path.join(dir, file)).href)) as { default?: ProviderFactory };
    const f = mod.default;
    if (f && typeof f.id === 'string' && typeof f.create === 'function') found.set(f.id.toLowerCase(), f);
  }
  if (dir === PROVIDERS_DIR) factories = found;
  return found;
}

export async function createProvider(id: string, ctx: ProviderContext, model: string): Promise<DecisionProvider> {
  const all = await loadProviderFactories();
  const f = all.get(id.toLowerCase());
  if (!f) {
    throw new Error(`Unknown DECISION_PROVIDER "${id}". Available providers: ${[...all.keys()].join(', ')}.`);
  }
  return f.create(ctx, model);
}
