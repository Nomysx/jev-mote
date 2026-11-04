// Debug panel: every visual parameter as a slider (to tune the mapping without a model),
// fast-forward time, rebirth with a seed, and a live readout of the mood engine.

import { VISUAL_KEYS, VISUAL_RANGES, type VisualParams } from '../../../shared/visuals';
import { api, type MoodSummary, type StateResponse, type TickResponse } from '../api';
import type { BlobView } from '../blob/BlobView';
import { clear, h } from './dom';

export interface DebugDeps {
  view: BlobView;
  onTick: (t: TickResponse) => void;
  onRebirth: (s: StateResponse) => void;
}

export function createDebug(el: HTMLElement, deps: DebugDeps) {
  let override = false;
  const values: VisualParams = deps.view.getTarget();
  const inputs = new Map<keyof VisualParams, { input: HTMLInputElement; out: HTMLElement }>();
  const moodPre = h('pre');
  const seedInput = h('input', { type: 'number', placeholder: 'seed (optional)', style: 'width:130px' }) as HTMLInputElement;

  const overrideBox = h('input', {
    type: 'checkbox',
    id: 'dbg-override',
    onchange: (e: Event) => {
      override = (e.target as HTMLInputElement).checked;
      if (override) {
        Object.assign(values, deps.view.getTarget());
        syncInputs();
        deps.view.setOverride(values);
      } else deps.view.setOverride(null);
    },
  }) as HTMLInputElement;

  const sliders = VISUAL_KEYS.map((key) => {
    const [min, max] = VISUAL_RANGES[key];
    const out = h('span', { class: 'faint' });
    const input = h('input', {
      type: 'range',
      min,
      max,
      step: (max - min) / 200,
      'aria-label': key,
      oninput: () => {
        values[key] = Number(input.value);
        out.textContent = values[key].toFixed(2);
        if (!override) {
          override = true;
          overrideBox.checked = true;
        }
        deps.view.setOverride(values);
      },
    }) as HTMLInputElement;
    inputs.set(key, { input, out });
    return h('label', { class: 'slider' }, h('span', {}, key), input, out);
  });

  function syncInputs() {
    for (const [key, { input, out }] of inputs) {
      input.value = String(values[key]);
      out.textContent = values[key].toFixed(2);
    }
  }

  const ff = (hours: number, label: string) =>
    h('button', { class: 'btn', type: 'button', onclick: async () => deps.onTick(await api.fastForward(hours)) }, label);

  el.append(
    h('button', { class: 'close-btn', type: 'button', 'aria-label': 'Close debug panel', onclick: () => toggle(false) }, '×'),
    h('b', {}, 'Debug'),
    h('h3', {}, 'Time'),
    h('div', { class: 'row' }, ff(1, '+1 h'), ff(6, '+6 h'), ff(24, '+1 day'), ff(72, '+3 days'), ff(168, '+7 days')),
    h('h3', {}, 'Mood engine'),
    moodPre,
    h('h3', {}, 'Blob'),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => deps.view.pulse() }, 'Pulse'),
      seedInput,
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: async () => {
            if (!confirm('Replace this blob with a newborn? Journal entries are kept.')) return;
            const seed = seedInput.value ? Number(seedInput.value) : undefined;
            deps.onRebirth(await api.rebirth(seed));
          },
        },
        'Rebirth',
      ),
    ),
    h('h3', {}, 'Visual parameters'),
    h('label', { class: 'row', for: 'dbg-override' }, overrideBox, 'Drive the blob from these sliders'),
    h(
      'div',
      { class: 'row', style: 'margin:6px 0' },
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: () => {
            Object.assign(values, deps.view.getTarget());
            syncInputs();
          },
        },
        'Load current mood',
      ),
    ),
    ...sliders,
  );
  syncInputs();

  function showMood(m: MoodSummary, offsetMs: number) {
    const e = Object.entries(m.emotions)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
      .join(', ');
    const grudges = m.grudges.length ? m.grudges.map((g) => `  ${g.words} (w ${g.weight.toFixed(2)})`).join('\n') : '  none';
    clear(moodPre);
    moodPre.append(
      `${m.words}\nclarity ${m.clarity.toFixed(2)} · mixed ${m.mixedness.toFixed(2)} · soothe ${m.soothe.toFixed(2)}\n${e}\ngrudges:\n${grudges}\nclock offset: +${(offsetMs / 3_600_000).toFixed(1)} h`,
    );
  }

  function toggle(open?: boolean) {
    const show = open ?? el.hidden;
    el.hidden = !show;
    document.getElementById('btn-debug')?.setAttribute('aria-pressed', String(show));
    if (!show && override) {
      override = false;
      overrideBox.checked = false;
      deps.view.setOverride(null);
    }
  }

  return { toggle, showMood };
}
