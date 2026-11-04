// Mote server entry point.

import { serve } from '@hono/node-server';
import { createApp } from './app';
import { Clock } from './clock';
import { loadConfig } from './config';
import { MoteDb } from './db';
import { Catalog } from './decision/catalog';
import { createProvider } from './decision/registry';
import { LifeLoop } from './life/loop';
import { MoteService } from './service';

async function main() {
  const config = loadConfig();
  const log = (msg: string) => console.log(msg);
  const db = new MoteDb(config.dbPath);
  const clock = new Clock(db);
  const catalog = new Catalog();

  const model = db.getSetting(`model:${config.decisionProvider}`) ?? config.decisionModel;
  const provider = await createProvider(config.decisionProvider, { config, catalog, log }, model);
  const service = new MoteService(db, provider, catalog, config, clock, log);
  const app = createApp(service, config);

  const status = await provider.status(true);
  log(
    `[mote] provider=${provider.providerId} model=${provider.model} ollama=${status.serverVersion ?? 'n/a'} ` +
      `url=${provider.providerId === 'ollama' ? config.ollamaUrl : 'n/a'}`,
  );
  log(`[mote] status: ${status.state}: ${status.message}${status.command ? ` (${status.command})` : ''}`);
  if (config.debugTools) log('[mote] debug tools are on (MOTE_DEBUG).');

  serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    log(`[mote] listening on http://${config.host}:${info.port}${config.production ? '' : ' (API; open the Vite URL in dev)'}`);
  });

  // Mote keeps living while the page is closed: its body clock, and (if allowed in settings)
  // thoughts on its own and dreams while nobody is watching.
  const life = new LifeLoop(service, log);
  life.start();
  log(`[mote] Mote's life is running${service.backgroundOn() ? '' : ' (thinking on its own is off in settings)'}.`);

  const shutdown = () => {
    life.stop();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[mote] failed to start:', err);
  process.exit(1);
});
