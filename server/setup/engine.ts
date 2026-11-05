// The engine that runs decision models. Mote uses an Ollama you already run if there is one.
// Otherwise it can set up its own: download the official open-source Ollama build once (from the
// Ollama project's GitHub releases), keep it with its models in Mote's data folder, and run it
// privately on its own port while Mote runs. Nothing is installed system-wide and no admin rights are
// needed. This download (and model downloads) only ever happen when you press the button.

import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, chmodSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import type { AppConfig } from '../config';
import type { MoteDb } from '../db';

const RELEASES = 'https://github.com/ollama/ollama/releases/latest/download/';
const ENGINE_SETTING = 'engine';

export type ArchiveKind = 'zip' | 'tgz' | 'tzst';

/** Which official Ollama build fits this computer, best first (with fallbacks for older names). */
export function engineAssets(platform: NodeJS.Platform = process.platform, arch: string = process.arch): { name: string; kind: ArchiveKind }[] {
  const a = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'amd64' : null;
  if (platform === 'win32' && a) return [{ name: `ollama-windows-${a}.zip`, kind: 'zip' }];
  if (platform === 'linux' && a)
    return [
      { name: `ollama-linux-${a}.tar.zst`, kind: 'tzst' },
      { name: `ollama-linux-${a}.tgz`, kind: 'tgz' },
    ];
  if (platform === 'darwin') return [{ name: 'ollama-darwin.tgz', kind: 'tgz' }];
  return [];
}

/** About how big the download is (from the official releases), so the setup screen can say so up front. */
export function engineDownloadSize(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | null {
  if (platform === 'win32') return arch === 'arm64' ? '220 MB' : '1.6 GB';
  if (platform === 'linux') return arch === 'arm64' ? 'about 1.4 GB' : '1.5 GB';
  if (platform === 'darwin') return '190 MB';
  return null;
}

export function archiveKind(name: string): ArchiveKind {
  if (/\.zip$/i.test(name)) return 'zip';
  if (/\.(tar\.)?zst$/i.test(name)) return 'tzst';
  return 'tgz';
}

export interface EngineInfo {
  /** running: ready to use; stopped: set up but not running; missing: nothing found. */
  state: 'running' | 'stopped' | 'missing' | 'installing' | 'starting' | 'error';
  /** system: an Ollama you run; managed: Mote's own. */
  source: 'system' | 'managed' | null;
  url: string;
  version: string | null;
  /** An `ollama` program was found on this computer (installed, not running). */
  systemInstalled: boolean;
  /** Mote can download its own engine on this platform. */
  canInstall: boolean;
  /** About how big that download is. */
  downloadSize: string | null;
  job: { phase: 'downloading' | 'extracting' | 'starting'; received: number; total: number | null } | null;
  error: string | null;
  dir: string;
}

async function versionAt(url: string, timeoutMs = 1500): Promise<string | null> {
  try {
    const r = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const j = (await r.json()) as { version?: string };
    return typeof j.version === 'string' ? j.version : null;
  } catch {
    return null;
  }
}

/** Finds `ollama` (or `ollama.exe`) inside a folder, at most three levels down. */
export function findBinary(dir: string, platform: NodeJS.Platform = process.platform): string | null {
  const name = platform === 'win32' ? 'ollama.exe' : 'ollama';
  const walk = (d: string, depth: number): string | null => {
    let items: string[];
    try {
      items = readdirSync(d);
    } catch {
      return null;
    }
    if (items.includes(name)) {
      const p = path.join(d, name);
      try {
        if (statSync(p).isFile()) return p;
      } catch {
        /* ignore */
      }
    }
    if (depth <= 0) return null;
    for (const i of items) {
      const p = path.join(d, i);
      try {
        if (statSync(p).isDirectory() && i !== 'models') {
          const f = walk(p, depth - 1);
          if (f) return f;
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  };
  return walk(dir, 3);
}

/** An `ollama` program on PATH (installed by you), if any. */
function onPath(platform: NodeJS.Platform = process.platform): string | null {
  const name = platform === 'win32' ? 'ollama.exe' : 'ollama';
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  if (platform === 'win32' && process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama'));
  if (platform === 'darwin') dirs.push('/Applications/Ollama.app/Contents/Resources');
  for (const d of dirs) {
    const p = path.join(d, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function run(cmd: string, args: string[], opts: { stdin?: NodeJS.ReadableStream } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [opts.stdin ? 'pipe' : 'ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr?.on('data', (d) => (err += String(d)));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}: ${err.slice(-300)}`))));
    if (opts.stdin && p.stdin) {
      opts.stdin.on('error', reject);
      opts.stdin.pipe(p.stdin);
    }
  });
}

export async function extract(archive: string, kind: ArchiveKind, dest: string, platform: NodeJS.Platform = process.platform) {
  mkdirSync(dest, { recursive: true });
  if (kind === 'zip') {
    if (platform === 'win32') {
      // tar.exe (built into Windows 10+) reads zip; PowerShell is the fallback.
      try {
        await run('tar', ['-xf', archive, '-C', dest]);
      } catch {
        await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${dest}' -Force`]);
      }
    } else {
      await run('unzip', ['-o', '-q', archive, '-d', dest]);
    }
  } else if (kind === 'tgz') {
    await run('tar', ['-xzf', archive, '-C', dest]);
  } else {
    const z = (zlib as unknown as { createZstdDecompress?: () => NodeJS.ReadWriteStream }).createZstdDecompress;
    if (z) {
      const { createReadStream } = await import('node:fs');
      await run('tar', ['-x', '-C', dest], { stdin: createReadStream(archive).pipe(z()) });
    } else {
      await run('tar', ['--zstd', '-xf', archive, '-C', dest]);
    }
  }
}

export class EngineManager {
  private child: ChildProcess | null = null;
  private job: EngineInfo['job'] = null;
  private error: string | null = null;
  private busy: Promise<void> | null = null;
  private systemUrl: string;

  constructor(
    private config: AppConfig,
    private db: MoteDb,
    private log: (msg: string) => void = console.log,
    private platform: NodeJS.Platform = process.platform,
  ) {
    this.systemUrl = config.ollamaUrl;
  }

  get dir() {
    return path.join(this.config.dataDir, 'engine');
  }

  get modelsDir() {
    return path.join(this.config.dataDir, 'models');
  }

  get managedUrl() {
    return `http://127.0.0.1:${this.config.enginePort}`;
  }

  private binary(): string | null {
    return existsSync(this.dir) ? findBinary(this.dir, this.platform) : null;
  }

  /** At startup: start Mote's own engine if it has one and no Ollama of yours is running. */
  async boot() {
    const choice = this.db.getSetting(ENGINE_SETTING);
    if (!this.binary()) return;
    if (choice === 'managed' || !(await versionAt(this.systemUrl))) {
      await this.start().catch((err) => this.log(`[mote] engine: ${(err as Error).message}`));
    }
  }

  async info(): Promise<EngineInfo> {
    const base = { url: this.config.ollamaUrl, systemInstalled: !!onPath(this.platform), canInstall: engineAssets(this.platform).length > 0 || !!this.config.engineUrl, downloadSize: engineDownloadSize(this.platform), job: this.job, error: this.error, dir: this.dir };
    if (this.job) return { ...base, state: this.job.phase === 'starting' ? 'starting' : 'installing', source: 'managed', version: null };
    const managed = this.config.ollamaUrl === this.managedUrl;
    const version = await versionAt(this.config.ollamaUrl);
    if (version) return { ...base, state: 'running', source: managed ? 'managed' : 'system', version };
    if (this.binary()) return { ...base, state: this.error ? 'error' : 'stopped', source: 'managed', version: null };
    return { ...base, state: this.error ? 'error' : 'missing', source: null, version: null };
  }

  /** Downloads and starts Mote's own engine (one at a time). */
  install(): Promise<void> {
    if (this.busy) return this.busy;
    this.busy = this.doInstall().finally(() => (this.busy = null));
    return this.busy;
  }

  private async doInstall() {
    this.error = null;
    try {
      if (!this.binary()) {
        const urls = this.config.engineUrl
          ? [{ url: this.config.engineUrl, kind: archiveKind(this.config.engineUrl) }]
          : engineAssets(this.platform).map((a) => ({ url: RELEASES + a.name, kind: a.kind }));
        if (!urls.length) throw new Error('Mote can’t set up its own engine on this kind of computer. Install Ollama from ollama.com instead.');
        mkdirSync(this.dir, { recursive: true });
        let lastErr: Error | null = null;
        for (const u of urls) {
          try {
            await this.download(u.url, u.kind);
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err as Error;
            this.log(`[mote] engine download from ${u.url} failed: ${lastErr.message}`);
          }
        }
        if (lastErr) throw lastErr;
      }
      await this.start();
    } catch (err) {
      this.error = (err as Error).message;
      this.job = null;
      throw err;
    }
  }

  private async download(url: string, kind: ArchiveKind) {
    this.job = { phase: 'downloading', received: 0, total: null };
    this.log(`[mote] Downloading the engine from ${url}`);
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || null;
    this.job = { phase: 'downloading', received: 0, total };
    const file = path.join(this.dir, `.download.${kind === 'zip' ? 'zip' : kind === 'tgz' ? 'tgz' : 'tar.zst'}`);
    const job = this.job;
    const counted = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
    counted.on('data', (chunk: Buffer) => (job.received += chunk.length));
    await pipeline(counted, createWriteStream(file));
    this.job = { phase: 'extracting', received: job.received, total };
    await extract(file, kind, this.dir, this.platform);
    rmSync(file, { force: true });
    const bin = this.binary();
    if (!bin) throw new Error('the download did not contain the engine');
    if (this.platform !== 'win32') chmodSync(bin, 0o755);
    this.log(`[mote] Engine ready at ${bin}`);
  }

  /** Starts Mote's own engine and points Mote at it. */
  async start() {
    const bin = this.binary();
    if (!bin) throw new Error('Mote’s engine isn’t set up yet.');
    if (await versionAt(this.managedUrl)) {
      this.use();
      return;
    }
    this.job = { phase: 'starting', received: 0, total: null };
    mkdirSync(this.modelsDir, { recursive: true });
    const logFile = openSync(path.join(this.config.dataDir, 'engine.log'), 'a');
    this.child = spawn(bin, ['serve'], {
      env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${this.config.enginePort}`, OLLAMA_MODELS: this.modelsDir },
      stdio: ['ignore', logFile, logFile],
      windowsHide: true,
    });
    closeSync(logFile);
    const child = this.child;
    child.on('exit', (code) => {
      if (this.child === child) {
        this.child = null;
        if (code) this.log(`[mote] engine stopped (exit ${code}); see ${path.join(this.config.dataDir, 'engine.log')}`);
      }
    });
    for (let i = 0; i < 120; i++) {
      if (await versionAt(this.managedUrl, 1000)) {
        this.job = null;
        this.use();
        this.log(`[mote] Mote's own engine is running on ${this.managedUrl}`);
        return;
      }
      if (!this.child) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    this.job = null;
    throw new Error('Mote’s engine didn’t start. See engine.log in Mote’s data folder.');
  }

  private use() {
    this.config.ollamaUrl = this.managedUrl;
    this.db.setSetting(ENGINE_SETTING, 'managed');
  }

  /** Starts an Ollama you installed yourself (it keeps running after Mote closes, as if you started it). */
  async startSystem() {
    const bin = onPath(this.platform);
    if (!bin) throw new Error('Ollama isn’t installed on this computer.');
    const p = spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
    p.unref();
    for (let i = 0; i < 40; i++) {
      if (await versionAt(this.systemUrl)) {
        this.config.ollamaUrl = this.systemUrl;
        this.db.setSetting(ENGINE_SETTING, 'system');
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Ollama didn’t start.');
  }

  stop() {
    this.child?.kill();
    this.child = null;
  }
}
