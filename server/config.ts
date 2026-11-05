// Configuration from `.env` (see .env.example).

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The project (or installed app) folder. The desktop app sets MOTE_ROOT to where it is installed. */
export const ROOT_DIR = process.env.MOTE_ROOT ? path.resolve(process.env.MOTE_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface AppConfig {
  decisionProvider: string;
  ollamaUrl: string;
  decisionModel: string;
  /** Sent to Ollama as keep_alive: a duration like "30m", or seconds as a number (-1 = keep loaded). */
  keepAlive: string | number;
  decisionTimeoutMs: number;
  host: string;
  port: number;
  dbPath: string;
  /** Where Mote keeps its own engine and models if it sets them up itself (next to the journal by default). */
  dataDir: string;
  /** Port for Mote's own engine, so it never clashes with an Ollama you run yourself. */
  enginePort: number;
  /** Overrides where the engine is downloaded from (a mirror, or a local file server in tests). */
  engineUrl: string | null;
  /** Running inside the desktop app. */
  desktop: boolean;
  debugTools: boolean;
  production: boolean;
}

const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

/**
 * OLLAMA_KEEP_ALIVE in any form Ollama itself accepts: a duration ("30m", "24h", "-1m") or a bare
 * number of seconds ("-1" keeps the model loaded, "0" unloads it). Ollama's API rejects a bare
 * number sent as text ("time: missing unit in duration"), so numbers are sent as numbers.
 */
export function parseKeepAlive(raw: string | undefined): string | number {
  const v = (raw ?? '').trim();
  if (!v) return '30m';
  return /^[+-]?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const production = env.NODE_ENV === 'production';
  const dbPath = env.MOTE_DB_PATH || path.join(ROOT_DIR, 'data', 'mote.sqlite');
  const absDb = path.isAbsolute(dbPath) ? dbPath : path.join(ROOT_DIR, dbPath);
  const dataDir = env.MOTE_DATA_DIR ? path.resolve(env.MOTE_DATA_DIR) : path.dirname(absDb);
  return {
    decisionProvider: (env.DECISION_PROVIDER || 'ollama').trim().toLowerCase(),
    ollamaUrl: (env.OLLAMA_URL || 'http://localhost:11434').trim().replace(/\/+$/, ''),
    decisionModel: (env.DECISION_MODEL || 'tev1').trim(),
    keepAlive: parseKeepAlive(env.OLLAMA_KEEP_ALIVE),
    decisionTimeoutMs: Number(env.DECISION_TIMEOUT_MS) > 0 ? Number(env.DECISION_TIMEOUT_MS) : 300_000,
    host: env.MOTE_HOST || '127.0.0.1',
    port: Number(env.MOTE_PORT) > 0 ? Number(env.MOTE_PORT) : 5174,
    dbPath: absDb,
    dataDir,
    enginePort: Number(env.MOTE_ENGINE_PORT) > 0 ? Number(env.MOTE_ENGINE_PORT) : 11435,
    engineUrl: env.MOTE_ENGINE_URL?.trim() || null,
    desktop: bool(env.MOTE_DESKTOP, false),
    // Hidden unless you ask for it (MOTE_DEBUG=true).
    debugTools: bool(env.MOTE_DEBUG, false),
    production,
  };
}

/**
 * Mote only talks to an Ollama server on this computer or the local network.
 * Anything else (in particular ollama.com, which hosts cloud models) is refused.
 */
export function checkLocalUrl(url: string): { ok: true } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: `OLLAMA_URL "${url}" is not a valid URL.` };
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'ollama.com' || host.endsWith('.ollama.com')) {
    return { ok: false, reason: 'OLLAMA_URL points to ollama.com (cloud). Mote only uses a local Ollama server.' };
  }
  const local =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.lan') ||
    host === 'host.docker.internal' ||
    !host.includes('.') && !host.includes(':') || // single-label LAN names like "homeserver"
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^f[cd][0-9a-f]{2}:/.test(host) ||
    /^fe80:/.test(host) ||
    host === '0.0.0.0';
  return local
    ? { ok: true }
    : { ok: false, reason: `OLLAMA_URL points to "${host}", which is not on this computer or your local network. Mote only talks to a local Ollama server.` };
}
