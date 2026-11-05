// Settings: Mote's brain (opens setup), your Mote (body, character, temperament), its mind and
// life, the desktop app, sound, and about.

import type { LifeView, ProviderStatus } from '../../../shared/types';
import { api, type BlobInfo, type CharacterBrief, type WellbeingCard } from '../api';
import type { SoundEngine } from '../audio/SoundEngine';
import { desktop, type DesktopPrefs } from '../desktop';
import type { MindPrefs } from '../mind/Mind';
import { clear, h } from './dom';

export interface SettingsDeps {
  blob: () => BlobInfo;
  wellbeing: () => WellbeingCard;
  onStatus: (s: ProviderStatus) => void;
  sound: SoundEngine;
  mind: { get: () => MindPrefs; set: (p: Partial<MindPrefs>) => void };
  /** Mote's body and character right now, and whether it lives on its own (a server setting). */
  life: {
    get: () => LifeView | null;
    character: () => CharacterBrief | null;
    setBackground: (on: boolean) => Promise<void>;
    openGrowth: () => void;
  };
  openSetup: () => void;
}

const STATE_WORDS: Partial<Record<ProviderStatus['state'], string>> = {
  ready: 'Ready',
  offline: 'The engine isn’t running',
  model_missing: 'The model isn’t downloaded yet',
  outdated: 'The engine needs an update',
  endpoint_missing: 'The engine needs an update',
  cloud_model: 'Cloud models aren’t used',
  not_decision_model: 'Not a decision model',
  remote_host: 'The engine must be on this computer',
};

function check(id: string, checked: boolean, text: string, onChange: (on: boolean) => void) {
  return h(
    'label',
    { class: 'check', for: id },
    h('input', { type: 'checkbox', id, checked, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }),
    h('span', {}, text),
  );
}

export function createSettings(el: HTMLElement, deps: SettingsDeps) {
  const body = h('div');
  el.append(
    h('button', { class: 'close-btn', type: 'button', 'aria-label': 'Close settings', onclick: () => toggle(false) }, '×'),
    h('h2', {}, 'Settings'),
    body,
  );
  let status: ProviderStatus | null = null;
  let prefs: DesktopPrefs | null = null;

  function brainSection() {
    const s = status;
    const ready = s?.state === 'ready';
    return [
      h('h3', {}, 'Mote’s brain'),
      s
        ? h(
            'div',
            { class: 'brain' },
            h('span', { class: `chip ${ready ? 'ok' : 'warn'}` }, STATE_WORDS[s.state] ?? s.state.replace(/_/g, ' ')),
            h('div', {}, h('b', {}, s.provider === 'mock' ? 'Mock provider (no model)' : s.model), s.serverVersion ? h('div', { class: 'faint' }, `Engine version ${s.serverVersion}`) : null),
          )
        : h('p', { class: 'muted' }, 'Checking…'),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => deps.openSetup() }, ready ? 'Change or download models' : 'Set up Mote')),
    ];
  }

  function blobSection() {
    const b = deps.blob();
    const t = b.temperament;
    const trait = (label: string, v: number) =>
      h('div', { class: 'trait' }, h('span', { class: 'muted' }, label), h('div', { class: 'bar' }, h('span', { style: `width:${Math.round(v * 100)}%` })), h('span', { class: 'faint' }, `${Math.round(v * 100)}`));
    const life = deps.life.get();
    const character = deps.life.character();
    return [
      h('h3', {}, 'Your Mote'),
      h('p', {}, 'Born ', h('b', {}, `a ${b.archetype} blob`), `: ${b.description}.`),
      character
        ? h(
            'p',
            {},
            'Who it is becoming: ',
            h('b', {}, character.description),
            '. ',
            h('button', { class: 'link-btn', type: 'button', onclick: () => deps.life.openGrowth() }, 'See how it grew'),
          )
        : null,
      life ? h('p', { class: 'muted' }, `Right now it is ${life.words}.`) : null,
      life ? trait('Energy', life.energy) : null,
      life ? trait('Missing you', life.longing) : null,
      life ? trait('Restless', life.boredom) : null,
      h('details', { class: 'more' }, h('summary', {}, 'Its temperament'), [
        trait('Baseline mood', t.baselineValence),
        trait('Volatility', t.volatility),
        trait('Trust speed', t.trustSpeed),
        trait('Recovery speed', t.recoverySpeed),
        trait('Grudge memory', t.grudgeMemory),
        trait('Lumpiness', t.lumpiness),
        h('p', { class: 'faint' }, `Temperament is its nature: random and permanent. Born ${new Date(b.bornAt).toLocaleString()}, seed ${b.seed}.`),
      ]),
    ];
  }

  function mindSection() {
    const m = deps.mind.get();
    const life = deps.life.get();
    return [
      h('h3', {}, 'Mind and life'),
      check('mind-thoughts', m.thoughts, 'Show its thoughts and decisions', (on) => deps.mind.set({ thoughts: on })),
      check('mind-bg', life?.background ?? true, 'Let it live on its own: think, sleep and dream, even when Mote is closed', (on) => void deps.life.setBackground(on)),
      h(
        'p',
        { class: 'faint' },
        'Floating thoughts are the model’s real choices, sized by probability; the words are written in advance. Living on its own, Mote asks your model now and then (only while it is already loaded) and dreams at most twice a night. It never gets worse while you’re away, it’s just glad when you’re back.',
      ),
    ];
  }

  function desktopSection() {
    if (!desktop || !prefs) return [];
    const set = <K extends keyof DesktopPrefs>(k: K, v: DesktopPrefs[K]) => void desktop!.setPref(k, v).then((p) => (prefs = p));
    return [
      h('h3', {}, 'Desktop'),
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => desktop!.openWidget() }, 'Show Mote as a desktop widget')),
      check('d-top', prefs.onTop, 'Keep the widget above other windows', (on) => set('onTop', on)),
      check('d-widget', prefs.widgetFirst, 'Open as the widget', (on) => set('widgetFirst', on)),
      check('d-auto', prefs.autostart, 'Start Mote when I log in', (on) => set('autostart', on)),
      h('p', { class: 'faint' }, 'Closing the window keeps Mote living in the tray. Quit it from the tray icon.'),
    ];
  }

  function soundSection() {
    const snd = deps.sound;
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
      check('snd-on', snd.enabled, 'Play sounds when Mote reacts', (on) => snd.setEnabled(on)),
      h('label', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'muted' }, 'Volume'), vol),
      h('p', { class: 'faint' }, 'Each Mote has its own voice, made on your computer from its temperament. Tip: you can poke Mote.'),
    ];
  }

  function aboutSection() {
    const w = deps.wellbeing();
    return [
      h('h3', {}, 'About'),
      h(
        'p',
        { class: 'muted' },
        'Mote is an expressive simulation, not a being with feelings. It never writes back: a local model answers a few fixed questions about each entry, and Mote turns the answers into shape, color, movement, sound and short thoughts.',
      ),
      h('p', { class: 'muted' }, 'Everything stays on this computer. The only downloads are the engine and models you choose in setup.'),
      h('h3', {}, 'Support lines'),
      h('p', { class: 'faint' }, 'Shown gently if an entry sounds like you may be in crisis:'),
      h('div', { class: 'lines' }, w.lines.map((l) => h('p', {}, h('b', {}, `${l.label}: `), l.text))),
    ];
  }

  function render() {
    clear(body);
    body.append(
      h('div', {}, brainSection()),
      h('div', {}, blobSection()),
      h('div', {}, mindSection()),
      h('div', {}, desktopSection()),
      h('div', {}, soundSection()),
      h('div', {}, aboutSection()),
    );
  }

  async function load() {
    render();
    try {
      const [m, p] = await Promise.all([api.models(), desktop ? desktop.getPrefs() : Promise.resolve(null)]);
      status = m.status;
      prefs = p;
      deps.onStatus(m.status);
    } catch {
      /* the brain section says "Checking…" */
    }
    render();
  }

  function toggle(open?: boolean) {
    const show = open ?? el.hidden;
    el.hidden = !show;
    document.getElementById('btn-settings')?.setAttribute('aria-pressed', String(show));
    if (show) void load();
  }

  return { toggle, refresh: () => !el.hidden && load() };
}
