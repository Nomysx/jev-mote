// Setting Mote up, in three plain steps: an engine to run models (yours, or Mote's own, downloaded
// with one click), a small model (one click, with progress), and done. Also the place to switch
// models later.

import type { ProviderStatus } from '../../../shared/types';
import { api, type EngineInfo, type PullJob, type SetupResponse } from '../api';
import { clear, formatBytes, h } from './dom';

export interface SetupDeps {
  onStatus: (s: ProviderStatus) => void;
}

const canonical = (n: string) => (n.includes(':') ? n.toLowerCase() : `${n.toLowerCase()}:latest`);

function bar(done: number, total: number | null) {
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : null;
  return h(
    'div',
    { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct ?? undefined },
    h('span', { style: `width:${pct ?? 30}%`, class: pct === null ? 'indeterminate' : '' }),
  );
}

export function createSetup(el: HTMLElement, deps: SetupDeps) {
  const body = h('div', { class: 'setup-body' });
  el.append(
    h('button', { class: 'close-btn', type: 'button', 'aria-label': 'Close setup', onclick: () => toggle(false) }, '×'),
    h('h2', {}, 'Set up Mote'),
    h('p', { class: 'muted' }, 'Mote runs a small AI model right here on your computer. What you write never leaves it, and after this setup Mote works offline.'),
    body,
  );
  let timer: number | undefined;
  let last: SetupResponse | null = null;
  let busy = false;
  let error: string | null = null;
  let showMore = false;

  async function act(fn: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    error = null;
    try {
      await fn();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
      void load();
    }
  }

  function step(n: number, title: string, done: boolean, ...content: (Node | string | null)[]) {
    return h('section', { class: `setup-step${done ? ' done' : ''}` }, h('div', { class: 'step-num', 'aria-hidden': 'true' }, done ? '✓' : String(n)), h('div', { class: 'step-main' }, h('h3', {}, title), ...content));
  }

  function engineStep(e: EngineInfo | null) {
    if (!e) return step(1, 'Engine', true, h('p', { class: 'muted' }, 'Using the mock provider: random but plausible answers, no model needed.'));
    const ready = e.state === 'running';
    if (ready) {
      return step(
        1,
        'Engine',
        true,
        h('p', {}, e.source === 'managed' ? 'Mote’s own engine is running.' : `Using your Ollama (version ${e.version}).`),
      );
    }
    if (e.state === 'installing' || e.state === 'starting') {
      const j = e.job;
      const text =
        j?.phase === 'downloading'
          ? `Downloading the engine: ${formatBytes(j.received) || '0 MB'}${j.total ? ` of ${formatBytes(j.total)}` : ''}`
          : j?.phase === 'extracting'
            ? 'Unpacking the engine…'
            : 'Starting the engine…';
      return step(1, 'Engine', false, h('p', {}, text), bar(j?.received ?? 0, j?.phase === 'downloading' ? j.total : null), h('p', { class: 'faint' }, 'You can keep using your computer. This only happens once.'));
    }
    const parts: (Node | string | null)[] = [];
    if (e.state === 'stopped') {
      parts.push(h('p', {}, 'Mote’s engine is set up but not running.'), h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => act(api.startEngine) }, 'Start it')));
    } else if (e.systemInstalled) {
      parts.push(
        h('p', {}, 'Ollama is installed on this computer but isn’t running.'),
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => act(api.startEngine) }, 'Start Ollama'),
          e.canInstall ? h('button', { class: 'btn', type: 'button', onclick: () => act(api.installEngine) }, 'Use Mote’s own engine instead') : null,
        ),
      );
    } else {
      parts.push(
        h('p', {}, 'Mote needs an engine to run its model. It can set one up for you: the free, open-source Ollama engine, kept inside Mote’s own folder. Nothing else is installed, and no admin rights are needed.'),
        e.canInstall
          ? h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => act(api.installEngine) }, 'Set it up for me'))
          : null,
        h('p', { class: 'faint' }, `It comes from the Ollama project on GitHub${e.downloadSize ? ` (${e.downloadSize}, once)` : ''}. Already use Ollama? Just start it and Mote finds it.`),
      );
    }
    if (e.error || error) parts.push(h('p', { class: 'error' }, e.error ?? error));
    return step(1, 'Engine', false, ...parts);
  }

  function modelRow(r: SetupResponse['recommended'][number], s: SetupResponse, pull: PullJob | undefined) {
    const installed = s.installed.some((i) => canonical(i.name) === canonical(r.model));
    const active = canonical(s.current) === canonical(r.model) && s.status.state === 'ready';
    const engineReady = s.provider === 'mock' || s.engine?.state === 'running';
    let right: Node;
    if (active) right = h('span', { class: 'chip ok' }, 'In use');
    else if (pull && !pull.done && !pull.error)
      right = h('button', { class: 'btn', type: 'button', onclick: () => act(() => api.cancelPull(r.model)) }, 'Cancel');
    else if (installed) right = h('button', { class: 'btn primary', type: 'button', onclick: () => act(() => api.setModel(r.model).then((x) => deps.onStatus(x.status))) }, 'Use');
    else right = h('button', { class: 'btn primary', type: 'button', disabled: !engineReady || busy, onclick: () => act(() => api.pull(r.model)) }, 'Download');
    return h(
      'div',
      { class: `model-card${r.best ? ' best' : ''}` },
      h(
        'div',
        { class: 'model-info' },
        h('div', { class: 'name' }, r.label, r.best ? h('span', { class: 'chip ok' }, 'Recommended') : null),
        h('div', { class: 'muted' }, r.why),
        h('div', { class: 'faint' }, installed ? 'Downloaded' : `Download size ${r.size}`),
        pull && !pull.done && !pull.error
          ? h('div', {}, bar(pull.completed, pull.total || null), h('div', { class: 'faint' }, pull.total ? `${formatBytes(pull.completed)} of ${formatBytes(pull.total)}` : 'Starting the download…'))
          : null,
        pull?.error && pull.error !== 'cancelled' ? h('p', { class: 'error' }, `Couldn’t download it: ${pull.error}`) : null,
      ),
      right,
    );
  }

  function modelStep(s: SetupResponse) {
    const ready = s.status.state === 'ready';
    const pulls = new Map(s.pulls.map((p) => [canonical(p.model), p]));
    const small = s.recommended.filter((r) => !r.big);
    const big = s.recommended.filter((r) => r.big);
    const known = new Set(s.recommended.map((r) => canonical(r.model)));
    const others = s.installed.filter((i) => !i.isCloud && i.isDecisionModel && !known.has(canonical(i.name)));
    const custom = h('input', { type: 'text', placeholder: 'Model name, e.g. d3:2b', 'aria-label': 'Model name' }) as HTMLInputElement;
    return step(
      2,
      'Mote’s brain',
      ready,
      ready ? h('p', {}, `Using ${s.current}.`) : h('p', {}, 'Pick a small model. All of these run well on any computer.'),
      ...small.map((r) => modelRow(r, s, pulls.get(canonical(r.model)))),
      h(
        'details',
        { class: 'more', open: showMore || undefined, ontoggle: (e: Event) => (showMore = (e.target as HTMLDetailsElement).open) },
        h('summary', {}, 'More models'),
        ...big.map((r) => modelRow(r, s, pulls.get(canonical(r.model)))),
        ...others.map((i) =>
          modelRow({ model: i.name, label: i.name, why: i.languages?.join(', ') ?? 'Already downloaded', size: formatBytes(i.sizeBytes) || '?', best: false, big: true }, s, undefined),
        ),
        h(
          'form',
          {
            class: 'row',
            style: 'margin-top:10px',
            onsubmit: (e: Event) => {
              e.preventDefault();
              const m = custom.value.trim();
              if (m) void act(() => api.pull(m));
            },
          },
          custom,
          h('button', { class: 'btn', type: 'submit' }, 'Download and use'),
        ),
        h('p', { class: 'faint' }, 'Any local decision model works. Cloud models are never used.'),
      ),
    );
  }

  function render(s: SetupResponse) {
    clear(body);
    const ready = s.status.state === 'ready';
    body.append(engineStep(s.engine), modelStep(s));
    body.append(
      step(
        3,
        'Ready',
        ready,
        ready
          ? h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => toggle(false) }, 'Start writing'))
          : h('p', { class: 'muted' }, 'Mote wakes up as soon as its brain is in place.'),
      ),
    );
    if (error && s.engine?.state === 'running') body.append(h('p', { class: 'error' }, error));
  }

  async function load() {
    window.clearTimeout(timer);
    try {
      const s = await api.setup();
      const wasReady = last?.status.state === 'ready';
      last = s;
      render(s);
      deps.onStatus(s.status);
      if (s.status.state === 'ready' && !wasReady && last) document.dispatchEvent(new CustomEvent('mote-ready'));
      const active = s.pulls.some((p) => !p.done && !p.error) || s.engine?.state === 'installing' || s.engine?.state === 'starting';
      if (!el.hidden) timer = window.setTimeout(() => void load(), active ? 1000 : 4000);
    } catch (err) {
      clear(body);
      body.append(h('p', { class: 'error' }, `Couldn’t reach the Mote server: ${(err as Error).message}`));
      if (!el.hidden) timer = window.setTimeout(() => void load(), 4000);
    }
  }

  function toggle(open?: boolean) {
    const show = open ?? el.hidden;
    el.hidden = !show;
    window.clearTimeout(timer);
    if (show) void load();
  }

  return { toggle, isOpen: () => !el.hidden };
}
