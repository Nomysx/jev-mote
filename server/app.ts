// HTTP routes. Bound to 127.0.0.1 by default; the app makes no outbound calls except to the local Ollama.

import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { ROOT_DIR, type AppConfig } from './config';
import type { MoteService } from './service';
import type { Setup } from './setup';

export function createApp(service: MoteService, config: AppConfig, setup?: Setup): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    const msg = err instanceof Error ? err.message : String(err);
    const clientError = /empty message|invalid model name|invalid json|dream not found|cloud models|no engine|isn’t installed|isn’t set up/i.test(msg);
    if (!clientError) console.error('[mote] request failed:', err);
    return c.json({ error: msg }, clientError ? 400 : 500);
  });

  const body = async (c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> => {
    try {
      const b = await c.req.json();
      return typeof b === 'object' && b !== null ? (b as Record<string, unknown>) : {};
    } catch {
      throw new Error('invalid JSON body');
    }
  };

  const num = (v: string | undefined) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

  app.get('/api/state', async (c) => c.json(await service.state(false, { idleMs: num(c.req.query('idle')) ?? 0 })));
  // seen=0: the page is open but hidden (Mote is on its own, and will tell you what it did).
  app.get('/api/tick', async (c) =>
    c.json(await service.tick(c.req.query('force') === '1', c.req.query('seen') === '0' ? null : { idleMs: num(c.req.query('idle')) ?? 0 })),
  );

  app.post('/api/message', async (c) => {
    const b = await body(c);
    return c.json(await service.message(typeof b.text === 'string' ? b.text : ''));
  });

  app.get('/api/journal', (c) => {
    const q = c.req.query();
    return c.json({
      entries: service.journal({
        lifeArea: q.area || undefined,
        emotion: q.emotion || undefined,
        before: num(q.before),
        since: num(q.since),
        limit: num(q.limit),
      }),
    });
  });

  // Mote's inner life. Thinking on its own is cancelled (with the model request) if the browser drops the request.
  app.post('/api/think', async (c) => c.json(await service.think(c.req.raw.signal)));
  app.post('/api/wake', async (c) => c.json(await service.wake('poke')));
  app.get('/api/dreams', (c) => c.json(service.dreams({ before: num(c.req.query('before')), limit: num(c.req.query('limit')) })));
  app.post('/api/dreams/:id/seen', async (c) => c.json(await service.markDreamSeen(Number(c.req.param('id')))));
  app.get('/api/character', async (c) => c.json(await service.character()));
  app.get('/api/life', (c) => c.json(service.lifeLog({ before: num(c.req.query('before')), limit: num(c.req.query('limit')) })));
  app.post('/api/settings/life', async (c) => {
    const b = await body(c);
    return c.json(service.setBackground(b.background !== false));
  });

  app.get('/api/models', async (c) => c.json(await service.models()));

  // Setup: the engine (yours or Mote's own) and one-click model downloads.
  if (setup) {
    app.get('/api/setup', async (c) => c.json(await setup.info(c.req.query('lang') || 'en')));
    app.post('/api/setup/engine', async (c) => {
      const b = await body(c);
      return c.json(b.action === 'start' ? await setup.startEngine() : setup.installEngine());
    });
    app.post('/api/setup/pull', async (c) => {
      const b = await body(c);
      return c.json(setup.pull(typeof b.model === 'string' ? b.model : '', b.use !== false));
    });
    app.post('/api/setup/pull/cancel', async (c) => {
      const b = await body(c);
      return c.json(setup.cancel(typeof b.model === 'string' ? b.model : ''));
    });
  }
  app.post('/api/settings/model', async (c) => {
    const b = await body(c);
    return c.json(await service.setModel(typeof b.model === 'string' ? b.model : ''));
  });

  if (config.debugTools) {
    app.post('/api/debug/fast-forward', async (c) => {
      const b = await body(c);
      return c.json(await service.fastForward(Number(b.hours)));
    });
    app.post('/api/debug/sleep', async (c) => c.json(await service.sleepNow()));
    app.post('/api/debug/dream', async (c) => c.json(await service.dreamNow()));
    app.post('/api/debug/rebirth', async (c) => {
      const b = await body(c);
      return c.json(await service.rebirth(b.seed === undefined || b.seed === '' ? undefined : Number(b.seed)));
    });
  }

  // Production: serve the built client (fonts, Three.js, everything) from disk.
  const dist = path.join(ROOT_DIR, 'dist', 'client');
  if (existsSync(dist)) {
    app.use('/*', serveStatic({ root: dist }));
    app.get('*', serveStatic({ root: dist, path: 'index.html' }));
  }

  return app;
}
