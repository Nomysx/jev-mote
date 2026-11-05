// Setting Mote up: the engine (yours or Mote's own), one-click model downloads, and which model
// to use. Everything the setup screen needs comes from here.

import os from 'node:os';
import type { AppConfig } from '../config';
import type { DecisionProvider } from '../decision/types';
import type { MoteService } from '../service';
import type { EngineManager } from './engine';
import { Puller, recommendModels, type PullJob } from './models';

export class Setup {
  readonly puller = new Puller();

  constructor(
    private engine: EngineManager,
    private provider: DecisionProvider,
    private service: MoteService,
    private config: AppConfig,
    private log: (msg: string) => void = console.log,
  ) {}

  async info(language = 'en') {
    const mock = this.provider.providerId === 'mock';
    const [engine, installed, status] = await Promise.all([
      mock ? null : this.engine.info(),
      this.provider.listModels().catch(() => []),
      this.provider.status(true),
    ]);
    return {
      provider: this.provider.providerId,
      engine,
      installed,
      current: this.provider.model,
      status,
      pulls: this.puller.list(),
      recommended: recommendModels(os.totalmem(), language),
      memoryGb: Math.round(os.totalmem() / 1024 ** 3),
      desktop: this.config.desktop,
    };
  }

  /** Downloads and starts Mote's own engine in the background; the setup screen polls info(). */
  installEngine() {
    void this.engine
      .install()
      .then(() => this.provider.status(true))
      .catch((err) => this.log(`[mote] engine setup failed: ${(err as Error).message}`));
    return { ok: true };
  }

  async startEngine() {
    const e = await this.engine.info();
    if (e.state === 'stopped') await this.engine.start();
    else if (e.systemInstalled) await this.engine.startSystem();
    else throw new Error('No engine to start yet.');
    return { status: await this.provider.status(true) };
  }

  /** Downloads a model; with `use`, switches to it as soon as it's there. */
  pull(model: string, use: boolean): PullJob {
    return this.puller.start(this.config.ollamaUrl, model, (job) => {
      if (job.done && use) {
        void this.service
          .setModel(job.model)
          .then((r) => this.log(`[mote] Downloaded ${job.model}; now using it (${r.status.state}).`))
          .catch(() => undefined);
      }
    });
  }

  cancel(model: string) {
    this.puller.cancel(model);
    return { ok: true };
  }
}
