// One-click model downloads (through the engine's /api/pull, with progress) and a recommendation
// of which small model fits this computer.

import { isCloudName } from '../decision/catalog';

export interface PullJob {
  model: string;
  status: string;
  completed: number;
  total: number;
  done: boolean;
  error: string | null;
  startedAt: number;
}

type Layers = Map<string, { total: number; completed: number }>;

/** Applies one line of Ollama's streamed /api/pull progress to a job. */
export function applyPullLine(job: PullJob, layers: Layers, line: string) {
  const t = line.trim();
  if (!t) return;
  let j: { status?: string; digest?: string; total?: number; completed?: number; error?: string };
  try {
    j = JSON.parse(t);
  } catch {
    return;
  }
  if (j.error) {
    job.error = j.error;
    return;
  }
  if (j.digest && typeof j.total === 'number') {
    layers.set(j.digest, { total: j.total, completed: Math.min(j.total, j.completed ?? layers.get(j.digest)?.completed ?? 0) });
    job.total = [...layers.values()].reduce((s, l) => s + l.total, 0);
    job.completed = [...layers.values()].reduce((s, l) => s + l.completed, 0);
  }
  if (j.status) {
    job.status = j.status;
    if (j.status === 'success') {
      job.done = true;
      job.completed = job.total;
    }
  }
}

export class Puller {
  readonly jobs = new Map<string, PullJob>();
  private ctrls = new Map<string, AbortController>();

  /** Starts downloading a model (or returns the download already running). */
  start(base: string, model: string, onDone?: (job: PullJob) => void): PullJob {
    const name = model.trim();
    if (!name || name.length > 200) throw new Error('invalid model name');
    if (isCloudName(name)) throw new Error('cloud models aren’t used: pick a local model');
    const running = this.jobs.get(name);
    if (running && !running.done && !running.error) return running;
    const job: PullJob = { model: name, status: 'starting', completed: 0, total: 0, done: false, error: null, startedAt: Date.now() };
    this.jobs.set(name, job);
    const ctrl = new AbortController();
    this.ctrls.set(name, ctrl);
    void this.run(base, job, ctrl.signal)
      .catch((err) => (job.error = ctrl.signal.aborted ? 'cancelled' : (err as Error).message))
      .finally(() => {
        this.ctrls.delete(name);
        if (job.done || job.error) onDone?.(job);
      });
    return job;
  }

  cancel(model: string) {
    this.ctrls.get(model.trim())?.abort();
  }

  list(): PullJob[] {
    return [...this.jobs.values()];
  }

  private async run(base: string, job: PullJob, signal: AbortSignal) {
    const res = await fetch(`${base}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: job.model, stream: true }),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(text ? (JSON.parse(text) as { error?: string }).error ?? text : `download failed (${res.status})`);
    }
    const layers: Layers = new Map();
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        applyPullLine(job, layers, buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    }
    applyPullLine(job, layers, buf);
    if (!job.done && !job.error) job.error = 'the download stopped before it finished';
  }
}

export interface Recommendation {
  model: string;
  label: string;
  why: string;
  size: string;
  /** Shown first and preselected. */
  best: boolean;
  /** Bigger models, behind "more models". */
  big: boolean;
}

/**
 * Small models first (all under 1 GB, fine on any computer). Which one is best depends on the
 * language you write in; bigger, smarter models are offered when there is enough memory.
 */
export function recommendModels(totalMemBytes: number, language = 'en'): Recommendation[] {
  const english = /^en\b/i.test(language);
  const gb = totalMemBytes / 1024 ** 3;
  const small: Recommendation[] = [
    { model: 'tev1:0.8b', label: 'Tev1 small', why: 'Reads your moments best of the small ones. English.', size: '834 MB', best: english, big: false },
    { model: 'laya:322m-multilingual-bf16', label: 'Laya multilingual', why: 'The smallest and fastest. Reads 100+ languages.', size: '658 MB', best: !english, big: false },
    { model: 'laya', label: 'Laya', why: 'Small and quick. English.', size: '845 MB', best: false, big: false },
  ];
  const big: Recommendation[] = [];
  if (gb >= 12) big.push({ model: 'tev1', label: 'Tev1', why: 'More accurate, slower. Needs about 8 GB of free memory.', size: '4.5 GB', best: false, big: true });
  if (gb >= 24) big.push({ model: 'nimble', label: 'Nimble', why: 'The most accurate. Needs a strong computer (or a good graphics card).', size: '9.5 GB', best: false, big: true });
  return [...small.sort((a, b) => Number(b.best) - Number(a.best)), ...big];
}
