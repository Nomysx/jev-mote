// Starts everything: the journal database, the decision provider (and Mote's own engine if it has
// one), the HTTP server and Mote's life. Used by the command line (index.ts) and the desktop app.

import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { createApp } from './app';
import { Clock } from './clock';
import { loadConfig, type AppConfig } from './config';
import { MoteDb } from './db';
import { Catalog } from './decision/catalog';
import { createProvider } from './decision/registry';
import { LifeLoop } from './life/loop';
import { MoteService } from './service';
import { EngineManager } from './setup/engine';
import { Setup } from './setup';

export interface StartOptions {
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
  /** If the port is taken, try up to this many next ones (the desktop app). */
  portTries?: number;
}

export interface RunningMote {
  port: number;
  url: string;
  config: AppConfig;
  service: MoteService;
  close(): Promise<void>;
}

function listen(app: ReturnType<typeof createApp>, host: string, port: number): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => resolve({ server: server as Server, port: info.port })) as Server;
    server.once('error', reject);
  });
}

export async function startMote(opts: StartOptions = {}): Promise<RunningMote> {
  const config = loadConfig(opts.env ?? process.env);
  const log = opts.log ?? ((msg: string) => console.log(msg));
  const db = new MoteDb(config.dbPath);
  const clock = new Clock(db);
  const catalog = new Catalog();
  const engine = new EngineManager(config, db, log);

  const model = db.getSetting(`model:${config.decisionProvider}`) ?? config.decisionModel;
  const provider = await createProvider(config.decisionProvider, { config, catalog, log }, model);
  const service = new MoteService(db, provider, catalog, config, clock, log);
  const setup = new Setup(engine, provider, service, config, log);
  const app = createApp(service, config, setup);

  let bound: { server: Server; port: number } | null = null;
  for (let i = 0; !bound; i++) {
    try {
      bound = await listen(app, config.host, config.port + i);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || i >= (opts.portTries ?? 0)) throw err;
    }
  }
  log(`[mote] listening on http://${config.host}:${bound.port}${config.production ? '' : ' (API; open the Vite URL in dev)'}`);

  // Mote's own engine (if it has one) starts in the background; the page shows it starting.
  if (config.decisionProvider === 'ollama') {
    void engine.boot().then(async () => {
      const status = await provider.status(true);
      log(`[mote] provider=${provider.providerId} model=${provider.model} ollama=${status.serverVersion ?? 'n/a'} url=${config.ollamaUrl}`);
      log(`[mote] status: ${status.state}: ${status.message}${status.command ? ` (${status.command})` : ''}`);
    });
  } else {
    log(`[mote] provider=${provider.providerId} model=${provider.model}`);
  }
  if (config.debugTools) log('[mote] debug tools are on (MOTE_DEBUG).');

  // Mote keeps living while the page is closed: its body clock, and (if allowed in settings)
  // thoughts on its own and dreams while nobody is watching.
  const life = new LifeLoop(service, log);
  life.start();
  log(`[mote] Mote's life is running${service.backgroundOn() ? '' : ' (living on its own is off in settings)'}.`);

  const server = bound.server;
  return {
    port: bound.port,
    url: `http://${config.host}:${bound.port}`,
    config,
    service,
    close: async () => {
      life.stop();
      engine.stop();
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
    },
  };
}
