import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkLocalUrl, loadConfig, parseKeepAlive } from '../server/config';
import { Catalog } from '../server/decision/catalog';
import ollama from '../server/decision/providers/ollama';
import { buildQuestions } from '../server/decision/questions';
import { DecisionError } from '../server/decision/types';

interface Fake {
  /** Models in memory (/api/ps). */
  loaded: { name: string; expires_at: string }[];
  version: string;
  tags: Record<string, unknown>[];
  show: Record<string, Record<string, unknown>>;
  systemoneRoute: boolean;
  systemone: (body: Record<string, unknown>) => { status: number; json?: unknown; text?: string };
}

let fake: Fake;
let server: Server;
let url: string;
let lastBody: Record<string, unknown> | null = null;
let unloads: unknown[] = [];

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });

function send(res: ServerResponse, status: number, json?: unknown, text?: string) {
  res.writeHead(status, { 'Content-Type': json !== undefined ? 'application/json' : 'text/plain' });
  res.end(json !== undefined ? JSON.stringify(json) : (text ?? ''));
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await read(req);
    const json = body ? JSON.parse(body) : {};
    if (req.url === '/api/version') return send(res, 200, { version: fake.version });
    if (req.url === '/api/tags') return send(res, 200, { models: fake.tags });
    if (req.url === '/api/ps') return send(res, 200, { models: fake.loaded });
    if (req.url === '/api/generate') {
      unloads.push(json);
      return send(res, 200, { done: true });
    }
    if (req.url === '/api/show') {
      const s = fake.show[json.model];
      return s ? send(res, 200, s) : send(res, 404, { error: `model '${json.model}' not found` });
    }
    if (req.url === '/v1/systemone' && fake.systemoneRoute) {
      if (!json.model) return send(res, 400, { error: 'model is required' });
      lastBody = json;
      const r = fake.systemone(json);
      return send(res, r.status, r.json, r.text);
    }
    return send(res, 404, undefined, '404 page not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const answers = {
  user_emotion: { type: 'choice', choice: 'joy', probabilities: { joy: 0.9, sadness: 0.02, anger: 0.02, fear: 0.02, calm: 0.02, curiosity: 0.01, disgust: 0.005, none: 0.005 }, confidence: 0.8 },
  surprising: { type: 'noul', noul: 0.1 },
};

beforeEach(() => {
  lastBody = null;
  unloads = [];
  fake = {
    loaded: [],
    version: '0.40.14',
    tags: [
      { name: 'laya:latest', model: 'laya:latest', size: 844_000_000, capabilities: ['decision'] },
      { name: 'tev1:latest', model: 'tev1:latest', capabilities: ['decision'] },
      { name: 'llama3:latest', model: 'llama3:latest', capabilities: ['completion'] },
      { name: 'clef:cloud', model: 'clef:cloud', remote_host: 'https://ollama.com:443', remote_model: 'clef' },
    ],
    show: {
      laya: { capabilities: ['decision'], requires: '0.40.4', parameters: 'num_ctx                        512' },
      tev1: { capabilities: ['decision'], requires: '0.40.4', parameters: 'num_ctx 8192' },
      llama3: { capabilities: ['completion'] },
    },
    systemoneRoute: true,
    systemone: (b) => ({ status: 200, json: { model: b.model, answers, usage: { input_tokens: 10, output_tokens: 0 } } }),
  };
});

function provider(model: string, ollamaUrl = url, keepAlive: string | number = '7m') {
  const config = { ...loadConfig({}), ollamaUrl, keepAlive, decisionTimeoutMs: 3000 };
  return ollama.create({ config, catalog: new Catalog(), log: () => undefined }, model);
}

describe('ollama provider: startup checks', () => {
  it('is ready with a pulled local decision model, and uses the server context', async () => {
    const p = provider('laya');
    const s = await p.status(true);
    expect(s.state).toBe('ready');
    expect(s.serverVersion).toBe('0.40.14');
    expect(p.profile().maxStateTokens).toBeLessThanOrEqual(300);
  });

  it('reports Ollama not running', async () => {
    const s = await provider('laya', 'http://127.0.0.1:1').status(true);
    expect(s.state).toBe('offline');
    expect(s.message).toBe('Start Ollama to wake me up');
  });

  it('requires at least 0.35, or the model’s higher minimum', async () => {
    fake.version = '0.34.9';
    expect((await provider('tev1').status(true)).state).toBe('outdated');
    fake.version = '0.38.0';
    const s = await provider('laya').status(true);
    expect(s.state).toBe('outdated');
    expect(s.requiredVersion).toBe('0.40.0');
    expect(s.message).toMatch(/Please update Ollama/);
  });

  it('also enforces the `requires` version Ollama reports for the package', async () => {
    fake.version = '0.40.2';
    const s = await provider('tev1').status(true);
    expect(s.state).toBe('outdated');
    expect(s.requiredVersion).toBe('0.40.4');
  });

  it('treats a 404 from /v1/systemone as Ollama being too old', async () => {
    fake.systemoneRoute = false;
    const s = await provider('laya').status(true);
    expect(s.state).toBe('endpoint_missing');
    expect(s.message).toMatch(/update Ollama/);
  });

  it('shows the exact pull command for a missing model', async () => {
    const s = await provider('nimble').status(true);
    expect(s.state).toBe('model_missing');
    expect(s.command).toBe('ollama pull nimble');
  });

  it('refuses cloud models by tag and by remote host', async () => {
    const byTag = await provider('clef:27b-cloud').status(true);
    expect(byTag.state).toBe('cloud_model');
    expect(byTag.command).toBe('ollama pull clef');
    fake.tags.push({ name: 'sneaky:latest', model: 'sneaky:latest', remote_host: 'https://ollama.com:443' });
    expect((await provider('sneaky').status(true)).state).toBe('cloud_model');
  });

  it('refuses a model that is not a decision model', async () => {
    expect((await provider('llama3').status(true)).state).toBe('not_decision_model');
  });

  it('refuses a non-local OLLAMA_URL', async () => {
    expect((await provider('laya', 'https://ollama.com').status(true)).state).toBe('remote_host');
    expect((await provider('laya', 'http://example.org:11434').status(true)).state).toBe('remote_host');
  });
});

describe('ollama provider: asking', () => {
  it('POSTs the wire format with keep_alive and validates the answers', async () => {
    const p = provider('laya');
    const qs = buildQuestions();
    const r = await p.ask({ new_message: 'hi' }, qs);
    expect(lastBody).toMatchObject({ model: 'laya', state: { new_message: 'hi' }, keep_alive: '7m' });
    expect(Object.keys(lastBody!.questions as object)).toEqual(Object.keys(qs));
    expect(r.answers.user_emotion).toMatchObject({ choice: 'joy' });
  });

  it('sends OLLAMA_KEEP_ALIVE in a form Ollama accepts (numbers as numbers)', async () => {
    expect(parseKeepAlive(undefined)).toBe('30m');
    expect(parseKeepAlive(' 30m ')).toBe('30m');
    expect(parseKeepAlive('-1m')).toBe('-1m');
    expect(parseKeepAlive('-1')).toBe(-1);
    expect(parseKeepAlive('3600')).toBe(3600);
    expect(loadConfig({ OLLAMA_KEEP_ALIVE: '-1' }).keepAlive).toBe(-1);
    await provider('laya', url, parseKeepAlive('-1')).ask('x', buildQuestions());
    expect(lastBody!.keep_alive).toBe(-1);
  });

  it('only thinks in the background while the model is loaded, without extending its stay', async () => {
    const p = provider('laya');
    await expect(p.ask('x', buildQuestions(), { background: true })).rejects.toMatchObject({ code: 'not_loaded' });
    expect(lastBody).toBeNull(); // nothing was sent, so nothing was loaded
    fake.loaded = [{ name: 'laya:latest', expires_at: new Date(Date.now() + 10 * 60_000).toISOString() }];
    await p.ask('x', buildQuestions(), { background: true });
    expect(lastBody!.keep_alive).toBeGreaterThan(590);
    expect(lastBody!.keep_alive).toBeLessThanOrEqual(600);
    fake.loaded = [{ name: 'laya:latest', expires_at: '2318-03-01T00:00:00Z' }]; // OLLAMA_KEEP_ALIVE=-1
    await p.ask('x', buildQuestions(), { background: true });
    expect(lastBody!.keep_alive).toBe(-1);
    await p.ask('x', buildQuestions()); // a normal entry uses the configured keep_alive
    expect(lastBody!.keep_alive).toBe('7m');
  });

  it('maps a missing model, a context overflow and running out of memory to clear errors', async () => {
    const p = provider('laya');
    await p.status(true);
    fake.systemone = () => ({ status: 404, json: { error: "model 'laya' not found" } });
    await expect(p.ask('x', buildQuestions())).rejects.toMatchObject({ code: 'model_missing' });
    await p.status(true);
    fake.systemone = () => ({ status: 400, json: { error: 'rendered prompt exceeds the loaded context' } });
    await expect(p.ask('x', buildQuestions())).rejects.toMatchObject({ code: 'context_exceeded' });
    await p.status(true);
    fake.systemone = () => ({ status: 500, json: { error: 'llama-server process has terminated: signal: killed' } });
    await expect(p.ask('x', buildQuestions())).rejects.toMatchObject({ code: 'out_of_memory' });
  });

  it('refuses to ask when the model is not ready', async () => {
    await expect(provider('clef:cloud').ask('x', buildQuestions())).rejects.toBeInstanceOf(DecisionError);
  });

  it('switches models live and unloads the previous one', async () => {
    const p = provider('nimble');
    expect((await p.status(true)).state).toBe('model_missing');
    const s = await p.setModel('tev1');
    expect(s.state).toBe('ready');
    expect(p.model).toBe('tev1');
    // The previous model is unloaded to free memory.
    await new Promise((r) => setTimeout(r, 50));
    expect(unloads).toEqual([{ model: 'nimble', keep_alive: 0 }]);
  });

  it('lists installed models with catalog info and cloud flags', async () => {
    const list = await provider('laya').listModels();
    const byName = Object.fromEntries(list.map((m) => [m.name, m]));
    expect(byName['laya:latest']).toMatchObject({ catalogName: 'laya', isDecisionModel: true, isCloud: false, tier: 'lite' });
    expect(byName['llama3:latest'].isDecisionModel).toBe(false);
    expect(byName['clef:cloud'].isCloud).toBe(true);
  });
});

describe('checkLocalUrl', () => {
  it('accepts this computer and the local network only', () => {
    for (const ok of ['http://localhost:11434', 'http://127.0.0.1:11434', 'http://[::1]:11434', 'http://192.168.1.20:11434', 'http://10.0.0.5', 'http://homeserver:11434', 'http://box.local:11434']) {
      expect(checkLocalUrl(ok).ok, ok).toBe(true);
    }
    for (const bad of ['https://ollama.com', 'https://api.ollama.com', 'http://example.org', 'http://8.8.8.8:11434', 'not a url']) {
      expect(checkLocalUrl(bad).ok, bad).toBe(false);
    }
  });
});
