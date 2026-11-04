// Ollama provider (default). Calls POST {OLLAMA_URL}/v1/systemone with plain fetch.
//
// Startup / health checks, in order:
//   1. OLLAMA_URL must be local, and the model must not be a cloud tag.
//   2. GET /api/version: Ollama running? Version >= 0.35 (or the model's higher minimum)?
//   3. GET /api/tags: is the model pulled? Is it a cloud (remote) model?
//   4. POST /api/show: decision capability, remote host, and the package's own `requires` version.
//   5. Probe /v1/systemone: a 404 means Ollama is too old for decision models.

import type { InstalledModel, ModelProfile, ProviderStatus } from '../../../shared/types';
import { checkLocalUrl } from '../../config';
import { canonicalName, isCloudName } from '../catalog';
import { askSystemOne, httpJson } from '../systemoneHttp';
import { DecisionError, type AskOptions, type DecisionProvider, type ProviderContext, type ProviderFactory, type Questions, type SystemOneState } from '../types';
import { compareVersions, maxVersion } from '../version';

const API_MINIMUM = '0.35.0';
const CHECK_TIMEOUT_MS = 4000;
const STATUS_CACHE_MS = 5000;

interface TagEntry {
  name: string;
  model?: string;
  size?: number;
  remote_host?: string;
  remote_model?: string;
  capabilities?: string[];
}

interface ShowInfo {
  capabilities?: string[];
  requires?: string;
  remote_host?: string;
  remote_model?: string;
  parameters?: string;
}

class OllamaProvider implements DecisionProvider {
  readonly providerId = 'ollama';
  model: string;
  private cached: ProviderStatus | null = null;
  private inflight: Promise<ProviderStatus> | null = null;
  private contextTokens: number | undefined;
  private reportedRequires: string | undefined;

  constructor(private ctx: ProviderContext, model: string) {
    this.model = model;
  }

  private get base() {
    return this.ctx.config.ollamaUrl;
  }

  profile(): ModelProfile {
    return this.ctx.catalog.profileFor(this.model, { contextTokens: this.contextTokens, minOllama: this.reportedRequires });
  }

  private make(state: ProviderStatus['state'], message: string, extra: Partial<ProviderStatus> = {}): ProviderStatus {
    return { state, message, provider: this.providerId, model: this.model, checkedAt: Date.now(), ...extra };
  }

  async status(force = false): Promise<ProviderStatus> {
    if (!force && this.cached && Date.now() - this.cached.checkedAt < STATUS_CACHE_MS) return this.cached;
    if (this.inflight) return this.inflight;
    this.inflight = this.check().finally(() => (this.inflight = null));
    this.cached = await this.inflight;
    return this.cached;
  }

  private async check(): Promise<ProviderStatus> {
    const model = this.model;
    const local = checkLocalUrl(this.base);
    if (!local.ok) return this.make('remote_host', local.reason);
    if (isCloudName(model)) return this.cloudStatus(model);

    // 2. Running? Version?
    let version: string;
    try {
      const r = await httpJson(`${this.base}/api/version`, { timeoutMs: CHECK_TIMEOUT_MS });
      version = String((r.json as { version?: unknown })?.version ?? '');
      if (r.status !== 200 || !version) throw new Error(`unexpected answer (${r.status})`);
    } catch {
      return this.make('offline', 'Start Ollama to wake me up', { command: 'ollama serve' });
    }
    const profile = this.ctx.catalog.find(model);
    const required = maxVersion(API_MINIMUM, profile?.minOllama);
    if (compareVersions(version, required) < 0) return this.outdated(version, required);

    // 3. Pulled? Cloud?
    let tags: TagEntry[] = [];
    try {
      const r = await httpJson(`${this.base}/api/tags`, { timeoutMs: CHECK_TIMEOUT_MS });
      tags = ((r.json as { models?: TagEntry[] })?.models ?? []).filter((m) => typeof m?.name === 'string');
    } catch {
      return this.make('offline', 'Start Ollama to wake me up', { command: 'ollama serve', serverVersion: version });
    }
    const wanted = canonicalName(model);
    const entry = tags.find((t) => canonicalName(t.name) === wanted || canonicalName(t.model ?? '') === wanted);
    if (!entry) {
      return this.make('model_missing', `The model "${model}" isn't downloaded yet.`, { command: `ollama pull ${model}`, serverVersion: version });
    }
    if (entry.remote_host || entry.remote_model) return this.cloudStatus(model, version);

    // 4. Decision capability, remote host, package requirements.
    let show: ShowInfo = {};
    try {
      const r = await httpJson(`${this.base}/api/show`, { method: 'POST', body: { model }, timeoutMs: CHECK_TIMEOUT_MS });
      if (r.status === 200 && r.json) show = r.json as ShowInfo;
    } catch {
      /* /api/show is informative only; fall through */
    }
    if (show.remote_host || show.remote_model) return this.cloudStatus(model, version);
    const caps = show.capabilities ?? entry.capabilities;
    if (Array.isArray(caps) && caps.length > 0 && !caps.includes('decision')) {
      return this.make('not_decision_model', `"${model}" isn't a decision model. Pick one in settings, or pull one from the catalog.`, {
        serverVersion: version,
      });
    }
    this.reportedRequires = show.requires;
    if (show.requires && compareVersions(version, show.requires) < 0) return this.outdated(version, maxVersion(required, show.requires));
    const ctxMatch = /(?:^|\n)\s*num_ctx\s+(\d+)/.exec(show.parameters ?? '');
    this.contextTokens = ctxMatch ? Number(ctxMatch[1]) : undefined;

    // 5. Does this Ollama serve /v1/systemone at all? An empty request is rejected with 400 if it does.
    try {
      const r = await httpJson(`${this.base}/v1/systemone`, { method: 'POST', body: {}, timeoutMs: CHECK_TIMEOUT_MS });
      if (r.status === 404) {
        return this.make('endpoint_missing', 'Please update Ollama: this version cannot run decision models.', {
          serverVersion: version,
          requiredVersion: required,
          command: 'Download the latest Ollama from ollama.com/download',
        });
      }
    } catch {
      return this.make('offline', 'Start Ollama to wake me up', { command: 'ollama serve', serverVersion: version });
    }

    return this.make('ready', `Listening with ${model}`, { serverVersion: version, requiredVersion: maxVersion(required, show.requires) });
  }

  private outdated(version: string, required: string): ProviderStatus {
    return this.make('outdated', `Please update Ollama. Mote needs version ${required} or newer for "${this.model}" (you have ${version}).`, {
      serverVersion: version,
      requiredVersion: required,
      command: 'Download the latest Ollama from ollama.com/download',
    });
  }

  private cloudStatus(model: string, version?: string): ProviderStatus {
    const local = model.split(':')[0];
    return this.make('cloud_model', `"${model}" runs in Ollama's cloud. Mote only uses models that run on your computer.`, {
      command: `ollama pull ${local}`,
      serverVersion: version,
    });
  }

  async ask(state: SystemOneState, questions: Questions, opts: AskOptions = {}) {
    const st = await this.status();
    if (st.state !== 'ready') {
      throw new DecisionError(st.state === 'error' || st.state === 'checking' ? 'http_error' : st.state, st.message);
    }
    const keepAlive = opts.background ? await this.backgroundKeepAlive() : this.ctx.config.keepAlive;
    try {
      return await askSystemOne(
        this.base,
        { model: this.model, state, questions, keep_alive: keepAlive },
        questions,
        { timeoutMs: this.ctx.config.decisionTimeoutMs, signal: opts.signal },
      );
    } catch (err) {
      this.cached = null; // re-check on the next call
      throw err;
    }
  }

  /**
   * Background thinking never loads a model and never keeps one loaded longer than it would have
   * been: it only runs while the model is already in memory, and passes on the time it has left.
   */
  private async backgroundKeepAlive(): Promise<number> {
    let models: { name?: string; model?: string; expires_at?: string }[] = [];
    try {
      const r = await httpJson(`${this.base}/api/ps`, { timeoutMs: CHECK_TIMEOUT_MS });
      models = (r.json as { models?: typeof models })?.models ?? [];
    } catch {
      throw new DecisionError('not_loaded', 'Could not check whether the model is loaded.');
    }
    const wanted = canonicalName(this.model);
    const m = models.find((x) => canonicalName(x.name ?? '') === wanted || canonicalName(x.model ?? '') === wanted);
    if (!m) throw new DecisionError('not_loaded', `"${this.model}" isn't loaded, so Mote won't load it just to think.`);
    const left = m.expires_at ? Date.parse(m.expires_at) - Date.now() : NaN;
    if (!Number.isFinite(left)) return -1;
    if (left > 365 * 24 * 3_600_000) return -1; // loaded "forever" (OLLAMA_KEEP_ALIVE=-1)
    return Math.max(1, Math.round(left / 1000));
  }

  async setModel(model: string): Promise<ProviderStatus> {
    const previous = this.model;
    if (canonicalName(previous) !== canonicalName(model) && checkLocalUrl(this.base).ok && !isCloudName(previous)) {
      // Free the old model's memory right away (what `ollama stop` does), so switching to a big model
      // on a small machine doesn't run out of memory. Best effort: errors are ignored.
      void httpJson(`${this.base}/api/generate`, { method: 'POST', body: { model: previous, keep_alive: 0 }, timeoutMs: CHECK_TIMEOUT_MS }).catch(() => undefined);
    }
    this.model = model.trim();
    this.cached = null;
    this.contextTokens = undefined;
    this.reportedRequires = undefined;
    return this.status(true);
  }

  async listModels(): Promise<InstalledModel[]> {
    if (!checkLocalUrl(this.base).ok) return [];
    let tags: TagEntry[] = [];
    try {
      const r = await httpJson(`${this.base}/api/tags`, { timeoutMs: CHECK_TIMEOUT_MS });
      tags = ((r.json as { models?: TagEntry[] })?.models ?? []).filter((m) => typeof m?.name === 'string');
    } catch {
      return [];
    }
    return tags.map((t) => {
      const profile = this.ctx.catalog.find(t.name);
      const isCloud = !!(t.remote_host || t.remote_model) || isCloudName(t.name);
      const caps = t.capabilities;
      return {
        name: t.name,
        sizeBytes: typeof t.size === 'number' && t.size > 0 ? t.size : undefined,
        catalogName: profile?.name,
        isDecisionModel: Array.isArray(caps) && caps.length > 0 ? caps.includes('decision') : !!profile,
        isCloud,
        tier: profile?.tier,
        languages: profile?.languages,
      };
    });
  }
}

const factory: ProviderFactory = {
  id: 'ollama',
  create: (ctx, model) => new OllamaProvider(ctx, model),
};

export default factory;
