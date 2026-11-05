import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config';
import { MoteDb } from '../server/db';
import { archiveKind, engineAssets, EngineManager, findBinary } from '../server/setup/engine';
import { applyPullLine, Puller, recommendModels, type PullJob } from '../server/setup/models';

describe('engine downloads', () => {
  it('pick the official build for each kind of computer', () => {
    expect(engineAssets('win32', 'x64')).toEqual([{ name: 'ollama-windows-amd64.zip', kind: 'zip' }]);
    expect(engineAssets('win32', 'arm64')[0].name).toBe('ollama-windows-arm64.zip');
    expect(engineAssets('linux', 'x64').map((a) => a.name)).toEqual(['ollama-linux-amd64.tar.zst', 'ollama-linux-amd64.tgz']);
    expect(engineAssets('darwin', 'arm64')[0].name).toBe('ollama-darwin.tgz');
    expect(engineAssets('aix' as NodeJS.Platform, 'ppc64')).toEqual([]);
    expect(archiveKind('x.zip')).toBe('zip');
    expect(archiveKind('x.tar.zst')).toBe('tzst');
    expect(archiveKind('x.tgz')).toBe('tgz');
  });

  it('find the engine inside what was unpacked', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mote-find-'));
    mkdirSync(path.join(dir, 'bin'));
    writeFileSync(path.join(dir, 'bin', 'ollama'), '');
    writeFileSync(path.join(dir, 'ollama.exe'), '');
    expect(findBinary(dir, 'linux')).toBe(path.join(dir, 'bin', 'ollama'));
    expect(findBinary(dir, 'win32')).toBe(path.join(dir, 'ollama.exe'));
    expect(findBinary(path.join(dir, 'nope'), 'linux')).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('model downloads', () => {
  const job = (): PullJob => ({ model: 'laya', status: '', completed: 0, total: 0, done: false, error: null, startedAt: 0 });

  it('add up progress over all layers, and finish on success', () => {
    const j = job();
    const layers = new Map();
    applyPullLine(j, layers, '{"status":"pulling manifest"}');
    applyPullLine(j, layers, '{"status":"pulling a","digest":"a","total":800,"completed":200}');
    applyPullLine(j, layers, '{"status":"pulling b","digest":"b","total":200}');
    expect([j.completed, j.total]).toEqual([200, 1000]);
    applyPullLine(j, layers, '{"status":"pulling a","digest":"a","total":800,"completed":800}');
    applyPullLine(j, layers, 'not json');
    expect(j.completed).toBe(800);
    applyPullLine(j, layers, '{"status":"success"}');
    expect(j.done).toBe(true);
    expect(j.completed).toBe(1000);
    const e = job();
    applyPullLine(e, new Map(), '{"error":"pull model manifest: file does not exist"}');
    expect(e.error).toMatch(/does not exist/);
  });

  it('recommend a small model for the language you write in, bigger ones only with enough memory', () => {
    const en = recommendModels(8 * 1024 ** 3, 'en-US');
    expect(en[0]).toMatchObject({ model: 'tev1:0.8b', best: true });
    expect(en.some((r) => r.big)).toBe(false);
    expect(recommendModels(8 * 1024 ** 3, 'de-DE')[0].model).toBe('laya:322m-multilingual-bf16');
    expect(recommendModels(32 * 1024 ** 3, 'en').filter((r) => r.big).map((r) => r.model)).toEqual(['tev1', 'nimble']);
  });

  it('refuse cloud models', () => {
    expect(() => new Puller().start('http://127.0.0.1:1', 'clef:cloud')).toThrow(/cloud/);
  });
});

// A fake engine: /api/version and a streamed /api/pull, like Ollama.
let server: Server;
let base = '';
let archive = '';
const work = mkdtempSync(path.join(os.tmpdir(), 'mote-setup-'));

beforeAll(async () => {
  // A tiny stand-in for the engine program, packed the way the official Linux build is.
  const pkg = path.join(work, 'pkg', 'bin');
  mkdirSync(pkg, { recursive: true });
  const script = path.join(pkg, 'ollama');
  writeFileSync(
    script,
    `#!${process.execPath}\nconst port = Number(process.env.OLLAMA_HOST.split(':')[1]);\nrequire('http').createServer((q, s) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ version: '9.9.9', models: process.env.OLLAMA_MODELS })); }).listen(port, '127.0.0.1');\n`,
  );
  execFileSync('chmod', ['+x', script]);
  archive = path.join(work, 'engine.tgz');
  execFileSync('tar', ['-czf', archive, '-C', path.join(work, 'pkg'), 'bin']);
  server = createServer((req, res) => {
    if (req.url === '/engine.tgz') {
      const data = readFileSync(archive);
      res.writeHead(200, { 'content-length': data.length });
      return res.end(data);
    }
    if (req.url === '/api/pull') {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write('{"status":"pulling manifest"}\n{"status":"pulling x","digest":"x","total":100,"comp');
      setTimeout(() => {
        res.write('leted":50}\n');
        res.end('{"status":"pulling x","digest":"x","total":100,"completed":100}\n{"status":"success"}\n');
      }, 20);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(work, { recursive: true, force: true });
});

describe('setting up', () => {
  it('downloads a model with progress, across chunk boundaries', async () => {
    const done = new Promise<PullJob>((resolve) => new Puller().start(base, 'laya', resolve));
    const j = await done;
    expect(j.error).toBeNull();
    expect(j.done).toBe(true);
    expect([j.completed, j.total]).toEqual([100, 100]);
  });

  it.skipIf(process.platform === 'win32')('downloads, unpacks and starts its own engine, then uses it', async () => {
    const dataDir = path.join(work, 'data');
    const config = {
      ...loadConfig({}),
      dbPath: ':memory:',
      dataDir,
      ollamaUrl: 'http://127.0.0.1:1', // no Ollama of yours running
      enginePort: 20000 + Math.floor(Math.random() * 20000),
      engineUrl: `${base}/engine.tgz`,
    };
    const db = new MoteDb(':memory:');
    const engine = new EngineManager(config, db, () => {});
    expect((await engine.info()).state).toBe('missing');
    await engine.install();
    const info = await engine.info();
    expect(info).toMatchObject({ state: 'running', source: 'managed', version: '9.9.9' });
    expect(config.ollamaUrl).toBe(`http://127.0.0.1:${config.enginePort}`);
    expect(db.getSetting('engine')).toBe('managed');
    // Its models live in Mote's data folder.
    const v = (await (await fetch(`${config.ollamaUrl}/api/version`)).json()) as { models: string };
    expect(v.models).toBe(path.join(dataDir, 'models'));
    engine.stop();
    db.close();
  });
});
