// Debug panel: every visual parameter as a slider (to tune the mapping without a model),
// previews of every reaction (gesture + sound), fast-forward time, rebirth with a seed, and a live
// readout of the mood engine.

import { EMOTIONS, type Emotion } from '../../../shared/types';
import { VISUAL_KEYS, VISUAL_RANGES, type VisualParams } from '../../../shared/visuals';
import { api, type MoodSummary, type StateResponse, type TickResponse } from '../api';
import type { SoundEngine } from '../audio/SoundEngine';
import type { BlobView } from '../blob/BlobView';
import type { ThoughtLayer } from '../mind/ThoughtLayer';
import { clear, h } from './dom';

export interface DebugDeps {
  view: BlobView;
  sound: SoundEngine;
  layer: ThoughtLayer;
  thinkNow: () => void;
  onTick: (t: TickResponse) => void;
  onRebirth: (s: StateResponse) => void;
  /** Mote's life: dream right now (asks the model), wake it, replay its newest dream. */
  dreamNow: () => void;
  wakeNow: () => void;
  replayDream: () => void;
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

  const btn = (label: string, fn: () => void) => h('button', { class: 'btn', type: 'button', onclick: fn }, label);
  const reactPreview = (e: Emotion, o: { intensity: number; second?: Emotion; mixed?: number; clarity?: number }) => {
    deps.view.react(e, o);
    deps.sound.play(e, o);
  };

  const ff = (hours: number, label: string) =>
    h('button', { class: 'btn', type: 'button', onclick: async () => deps.onTick(await api.fastForward(hours)) }, label);

  el.append(
    h('button', { class: 'close-btn', type: 'button', 'aria-label': 'Close debug panel', onclick: () => toggle(false) }, '×'),
    h('b', {}, 'Debug'),
    h('h3', {}, 'Time'),
    h('div', { class: 'row' }, ff(1, '+1 h'), ff(6, '+6 h'), ff(24, '+1 day'), ff(72, '+3 days'), ff(168, '+7 days')),
    h('p', { class: 'faint' }, 'Mote lives through skipped time: it sleeps, wakes, and shows what it did. Thoughts and dreams only come from the model, so they don’t happen during a jump.'),
    h('h3', {}, "Mote's life"),
    h(
      'div',
      { class: 'row' },
      btn('sleep now', async () => deps.onTick(await api.debugSleep())),
      btn('dream now (asks the model)', () => deps.dreamNow()),
      btn('wake up', () => deps.wakeNow()),
      btn('replay newest dream', () => deps.replayDream()),
    ),
    h('h3', {}, 'Mood engine'),
    moodPre,
    h('h3', {}, 'Reactions (preview only, mood unchanged)'),
    h(
      'div',
      { class: 'row' },
      EMOTIONS.map((e) => btn(e, () => reactPreview(e, { intensity: 0.8 }))),
      btn('mixed: anger + sadness', () => reactPreview('anger', { intensity: 0.7, second: 'sadness', mixed: 0.9, clarity: 0.6 })),
      btn('unsure', () => reactPreview('curiosity', { intensity: 0.4, clarity: 0.1 })),
      btn('surprise', () => {
        deps.view.pulse();
        deps.sound.play('pulse');
      }),
      btn('entry arrives', () => void deps.view.absorb(window.innerWidth / 2, window.innerHeight - 60)),
      btn('soothe', () => {
        deps.view.soothe();
        deps.sound.play('soothe');
      }),
      btn('puzzled', () => {
        deps.view.puzzled();
        deps.sound.play('puzzled', { clarity: 0.3 });
      }),
      btn('wake', () => deps.view.wake(deps.view.getCurrent(), deps.view.getTarget())),
      btn('birth', () => void deps.view.playBirth()),
    ),
    h('h3', {}, "Mote's mind (preview)"),
    h(
      'div',
      { class: 'row' },
      btn('clear thought', () =>
        void deps.layer.play({
          thoughts: [
            { text: 'you did it!', p: 0.71 },
            { text: 'good news!', p: 0.16 },
            { text: "that's warm", p: 0.07 },
            { text: 'mm, okay', p: 0.04 },
          ],
          confidence: 0.72,
          decision: { options: [{ text: 'celebrate', p: 0.74 }, { text: 'come closer', p: 0.18 }, { text: 'play', p: 0.08 }], confidence: 0.6 },
          onSettle: () => reactPreview('joy', { intensity: 0.8 }),
          onDecide: () => deps.view.behave('celebrate'),
        }),
      ),
      btn('undecided', () =>
        void deps.layer.play({
          thoughts: [
            { text: 'that stung', p: 0.31 },
            { text: 'that sounds hard', p: 0.28 },
            { text: 'hmm…', p: 0.22 },
            { text: "that's a lot", p: 0.19 },
          ],
          confidence: 0.06,
          decision: { options: [{ text: 'give space', p: 0.38 }, { text: 'listen', p: 0.34 }, { text: 'hide', p: 0.28 }], confidence: 0.05 },
          onSettle: () => reactPreview('sadness', { intensity: 0.5, second: 'anger', mixed: 0.8, clarity: 0.2 }),
          onDecide: () => deps.view.behave('give_space'),
        }),
      ),
      btn('think now', () => deps.thinkNow()),
      ...(['nap', 'hum', 'sulk', 'wander', 'wait_by_text', 'glow', 'hide', 'come_closer'] as const).map((k) => btn(k.replace(/_/g, ' '), () => deps.view.behave(k))),
    ),
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
