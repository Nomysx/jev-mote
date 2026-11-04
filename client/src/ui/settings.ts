// Settings: model presets, installed-model picker (live switching), the blob's temperament, about.

import type { ProviderStatus } from '../../../shared/types';
import { api, type BlobInfo, type ModelsResponse, type WellbeingCard } from '../api';
import type { SoundEngine } from '../audio/SoundEngine';
import { clear, formatBytes, h } from './dom';

export interface SettingsDeps {
  blob: () => BlobInfo;
  wellbeing: () => WellbeingCard;
  onStatus: (s: ProviderStatus) => void;
  sound: SoundEngine;
}

const canonical = (n: string) => (n.includes(':') ? n.toLowerCase() : `${n.toLowerCase()}:latest`);

export function statusView(s: ProviderStatus) {
  const ok = s.state === 'ready';
  return h(
    'div',
    { class: 'status-line' },
    h('div', { class: 'row' }, h('span', { class: `chip ${ok ? 'ok' : 'warn'}` }, ok ? 'ready' : s.state.replace(/_/g, ' ')), h('b', {}, `${s.provider} / ${s.model}`)),
    h('div', { class: 'muted' }, s.message),
    s.command ? h('code', {}, s.command) : null,
    s.serverVersion ? h('div', { class: 'faint' }, `Ollama ${s.serverVersion}${s.requiredVersion ? ` (needs ${s.requiredVersion}+)` : ''}`) : null,
  );
}

export function createSettings(el: HTMLElement, deps: SettingsDeps) {
  const body = h('div');
  el.append(
    h('button', { class: 'close-btn', type: 'button', 'aria-label': 'Close settings', onclick: () => toggle(false) }, '×'),
    h('h2', {}, 'Settings'),
    body,
  );
  let busy = false;

  async function use(model: string) {
    if (busy || !model.trim()) return;
    busy = true;
    render(null, `Switching to ${model}…`);
    try {
      const r = await api.setModel(model);
      deps.onStatus(r.status);
    } catch (err) {
      render(null, (err as Error).message);
    } finally {
      busy = false;
      void load();
    }
  }

  function modelSection(m: ModelsResponse) {
    const installed = new Map(m.installed.map((i) => [canonical(i.name), i]));
    const isInstalled = (name: string) => installed.has(canonical(name));
    const current = canonical(m.current);
    const custom = h('input', { type: 'text', placeholder: 'Model name, e.g. d3:2b', 'aria-label': 'Model name' }) as HTMLInputElement;

    const presets =
      m.provider === 'mock'
        ? [h('p', { class: 'muted' }, 'DECISION_PROVIDER=mock: answers are random but plausible, no model needed. Set DECISION_PROVIDER=ollama in .env to use a real model.')]
        : m.presets.map((p) =>
            h(
              'div',
              { class: 'preset' },
              h('div', { class: 'preset-head' }, h('b', {}, p.label), h('span', { class: 'faint' }, p.hardware)),
              p.models.map((pm) => {
                const prof = m.catalog.find((c) => c.name === pm.model);
                const active = canonical(pm.model) === current;
                return h(
                  'div',
                  { class: 'model-row' },
                  h(
                    'div',
                    {},
                    h('div', { class: 'name' }, pm.model),
                    h('div', { class: 'faint' }, [pm.when, prof?.downloadSize, prof?.languages.join(', ')].filter(Boolean).join(' · ')),
                  ),
                  active
                    ? h('span', { class: 'chip ok' }, 'in use')
                    : isInstalled(pm.model)
                      ? h('button', { class: 'btn', type: 'button', onclick: () => use(pm.model) }, 'Use')
                      : h('code', { title: 'Run this in a terminal, then press Use' }, `ollama pull ${pm.model}`),
                );
              }),
            ),
          );

    const list = m.installed.length
      ? m.installed.map((i) => {
          const active = canonical(i.name) === current;
          const chips = [
            i.isCloud ? h('span', { class: 'chip warn' }, 'cloud: not allowed') : null,
            !i.isCloud && i.isDecisionModel ? h('span', { class: 'chip ok' }, 'decision model') : null,
            !i.isCloud && !i.isDecisionModel ? h('span', { class: 'chip' }, 'not a decision model') : null,
            i.tier ? h('span', { class: 'chip' }, i.tier) : null,
            i.sizeBytes ? h('span', { class: 'chip' }, formatBytes(i.sizeBytes)) : null,
          ];
          return h(
            'div',
            { class: 'model-row' },
            h('div', {}, h('div', { class: 'name' }, i.name), h('div', { class: 'chips row' }, chips), i.languages ? h('div', { class: 'faint' }, i.languages.join(', ')) : null),
            active
              ? h('span', { class: 'chip ok' }, 'in use')
              : h('button', { class: 'btn', type: 'button', disabled: i.isCloud || !i.isDecisionModel, onclick: () => use(i.name) }, 'Use'),
          );
        })
      : [h('p', { class: 'muted' }, m.provider === 'ollama' ? 'No models found. Is Ollama running?' : 'No models listed.')];

    return [
      h('h3', {}, 'Decision model'),
      statusView(m.status),
      h('h3', {}, 'Presets'),
      presets,
      h('h3', {}, 'Installed models'),
      list,
      h(
        'form',
        {
          class: 'row',
          style: 'margin-top:10px',
          onsubmit: (e: Event) => {
            e.preventDefault();
            void use(custom.value);
          },
        },
        custom,
        h('button', { class: 'btn', type: 'submit' }, 'Use'),
      ),
      h('p', { class: 'faint' }, 'Switching takes effect immediately, no restart needed. Only local models are used; cloud tags are refused.'),
    ];
  }

  function blobSection() {
    const b = deps.blob();
    const t = b.temperament;
    const trait = (label: string, v: number) =>
      h('div', { class: 'trait' }, h('span', { class: 'muted' }, label), h('div', { class: 'bar' }, h('span', { style: `width:${Math.round(v * 100)}%` })), h('span', { class: 'faint' }, v.toFixed(2)));
    return [
      h('h3', {}, 'Your Mote'),
      h('p', {}, h('b', {}, b.archetype), ' · ', b.description),
      h('p', { class: 'faint' }, `Born ${new Date(b.bornAt).toLocaleString()} · seed `, h('code', {}, String(b.seed))),
      trait('Baseline mood', t.baselineValence),
      trait('Volatility', t.volatility),
      trait('Trust speed', t.trustSpeed),
      trait('Recovery speed', t.recoverySpeed),
      trait('Grudge memory', t.grudgeMemory),
      trait('Lumpiness', t.lumpiness),
      h('p', { class: 'faint' }, 'Temperament is random and permanent. Two blobs with the same seed have the same temperament.'),
    ];
  }

  function soundSection() {
    const snd = deps.sound;
    const toggle = h('input', {
      type: 'checkbox',
      id: 'snd-on',
      checked: snd.enabled,
      onchange: (e: Event) => snd.setEnabled((e.target as HTMLInputElement).checked),
    }) as HTMLInputElement;
    const vol = h('input', {
      type: 'range',
      min: 0,
      max: 1,
      step: 0.05,
      value: snd.volume,
      'aria-label': 'Volume',
      oninput: (e: Event) => snd.setVolume(Number((e.target as HTMLInputElement).value)),
      onchange: () => snd.play('poke', { variant: 1 }),
    }) as HTMLInputElement;
    return [
      h('h3', {}, 'Sound'),
      h('label', { class: 'row', for: 'snd-on' }, toggle, 'Play sounds when Mote reacts'),
      h('label', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'muted' }, 'Volume'), vol),
      h(
        'p',
        { class: 'faint' },
        'Each Mote has its own voice, made from its temperament, and its mood colors how it sounds. The sounds are synthesized on your computer; there are no audio files. Sound starts after your first click or key press. Tip: you can poke Mote.',
      ),
    ];
  }

  function aboutSection() {
    const w = deps.wellbeing();
    return [
      h('h3', {}, 'About'),
      h(
        'p',
        { class: 'muted' },
        'Mote is an expressive simulation, not a being with feelings. It never writes back: a local decision model answers a few fixed questions about each entry, and Mote turns those answers into shape, color and movement.',
      ),
      h(
        'p',
        { class: 'muted' },
        'Everything stays on this computer. Entries are stored in a local SQLite file, and the only network connection is to your local Ollama.',
      ),
      h('h3', {}, 'Support lines'),
      h('p', { class: 'faint' }, 'Shown gently if an entry sounds like you may be in crisis (edit server/wellbeing.json for your region):'),
      h('ul', {}, w.lines.map((l) => h('li', {}, h('b', {}, `${l.label}: `), l.text))),
    ];
  }

  function render(m: ModelsResponse | null, note?: string) {
    clear(body);
    if (note) body.append(h('p', { class: 'muted' }, note));
    if (m) body.append(h('div', {}, modelSection(m)));
    body.append(h('div', {}, blobSection()), h('div', {}, soundSection()), h('div', {}, aboutSection()));
  }

  async function load() {
    try {
      const m = await api.models();
      deps.onStatus(m.status);
      render(m);
    } catch (err) {
      render(null, `Could not load models: ${(err as Error).message}`);
    }
  }

  function toggle(open?: boolean) {
    const show = open ?? el.hidden;
    el.hidden = !show;
    document.getElementById('btn-settings')?.setAttribute('aria-pressed', String(show));
    if (show) {
      render(null, 'Loading models…');
      void load();
    }
  }

  return { toggle, refresh: () => !el.hidden && load() };
}
