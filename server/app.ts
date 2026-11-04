// HTTP routes. Bound to 127.0.0.1 by default; the app makes no outbound calls except to the local Ollama.

import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { ROOT_DIR, type AppConfig } from './config';
import type { MoteService } from './service';

export function createApp(service: MoteService, config: AppConfig): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    const msg = err instanceof Error ? err.message : String(err);
    const clientError = /empty message|invalid model name|invalid json/i.test(msg);
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

  app.get('/api/state', async (c) => c.json(await service.state()));
  app.get('/api/tick', async (c) => c.json(await service.tick(c.req.query('force') === '1')));

  app.post('/api/message', async (c) => {
    const b = await body(c);
    return c.json(await service.message(typeof b.text === 'string' ? b.text : ''));
  });

  app.get('/api/journal', (c) => {
    const q = c.req.query();
    const n = (v: string | undefined) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
    return c.json({
      entries: service.journal({
        lifeArea: q.area || undefined,
        emotion: q.emotion || undefined,
        before: n(q.before),
        since: n(q.since),
        limit: n(q.limit),
      }),
    });
  });

  app.get('/api/models', async (c) => c.json(await service.models()));
  app.post('/api/settings/model', async (c) => {
    const b = await body(c);
    return c.json(await service.setModel(typeof b.model === 'string' ? b.model : ''));
  });

  if (config.debugTools) {
    app.post('/api/debug/fast-forward', async (c) => {
      const b = await body(c);
      return c.json(await service.fastForward(Number(b.hours)));
    });
    app.post('/api/debug/rebirth', async (c) => {
      const b = await body(c);
      return c.json(await service.rebirth(b.seed === undefined || b.seed === '' ? undefined : Number(b.seed)));
    });
  }

  // Production: serve the built client (fonts, Three.js, everything) from disk.
  const dist = path.join(ROOT_DIR, 'dist', 'client');
  if (existsSync(dist)) {
    const root = path.relative(process.cwd(), dist) || '.';
    app.use('/*', serveStatic({ root }));
    app.get('*', serveStatic({ root, path: 'index.html' }));
  }

  return app;
}
