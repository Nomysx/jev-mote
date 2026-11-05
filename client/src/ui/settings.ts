// Settings: Mote's brain (opens setup), your Mote (body, character, temperament), its mind and
// life, the desktop app, sound, and about.

import type { LifeView, ProviderStatus, SensesView } from '../../../shared/types';
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

/** "1:30 AM" or "01:30", in this computer's style, to the nearest quarter hour. */
const clock = (hours: number) => {
  const m = (Math.round(hours * 4) * 15) % (24 * 60);
  return new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

/** "3 h 20 min", "45 min". */
const duration = (minutes: number) => {
  const m = Math.round(minutes);
  const hrs = Math.floor(m / 60);
  return hrs ? `${hrs} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
};

function rhythmWords(s: SensesView): string {
  const r = s.rhythm;
  if (r.days === 0) return s.presence ? 'It starts learning your rhythm after your first full day.' : 'Turn this on and Mote starts learning your rhythm.';
  if (!r.night) {
    return r.confidence === 0 && r.days < 3
      ? `It has noticed you on ${r.days} full ${r.days === 1 ? 'day' : 'days'} so far. Your rhythm takes a few days to show.`
      : 'No clear night yet: your days look much the same around the clock, so Mote keeps its own nights.';
  }
  const shift = Math.round(r.shiftHours * 4) / 4;
  const by = duration(Math.abs(shift) * 60);
  const moved = Math.abs(shift) < 0.25 ? 'about when it would by nature' : `${by} ${shift > 0 ? 'later' : 'earlier'} than by nature`;
  const learned = r.confidence < 1 ? `, and it is still getting used to you (${Math.round(r.confidence * 100)}%)` : '';
  return `Your quiet hours: about ${clock(r.night.from)} to ${clock(r.night.to)}. Mote now sleeps about ${clock(s.sleep.from)} to ${clock(s.sleep.to)}, ${moved}${learned}. Learned from the last ${r.days} ${r.days === 1 ? 'day' : 'days'}.`;
}

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
  let senses: SensesView | null = null;

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

  function noticeSection() {
    const s = senses;
    if (!s?.available) return [];
    const r = s.rhythm;
    const setPresence = (on: boolean) =>
      void api
        .setPresence(on)
        .then((v) => (senses = v))
        .catch(() => undefined)
        .finally(render);
    const forget = () => {
      if (!window.confirm('Forget your daily rhythm? Mote goes back to its own nights.')) return;
      void api
        .forgetRhythm()
        .then((v) => (senses = v))
        .catch(() => undefined)
        .finally(render);
    };
    const inSleep = (hour: number) => {
      const { from, to } = s.sleep;
      const mid = hour + 0.5;
      return from < to ? mid >= from && mid < to : mid >= from || mid < to;
    };
    const peak = Math.max(0.05, ...r.hours);
    const known = r.days > 0;
    return [
      h('h3', {}, 'What Mote notices'),
      check('s-presence', s.presence, 'Notice when I’m at the computer', setPresence),
      h(
        'p',
        { class: 'faint' },
        'Mote only checks how long ago the keyboard or mouse was used, and whether the screen is locked: never what you type, which apps you use or what’s on screen. With that it knows you’re nearby (it misses you less, and an open Mote only counts as watched while you’re here), and it learns your daily rhythm: over about two weeks, it moves its nights toward yours. It all stays on this computer.',
      ),
      s.presence
        ? h(
            'p',
            { class: 'muted' },
            s.nearby ? 'Right now you’re at the computer' : 'Right now you’re away from the computer',
            s.todayMinutes > 0 ? `, ${duration(s.todayMinutes)} so far today.` : '.',
          )
        : null,
      known
        ? h(
            'div',
            { class: 'rhythm-box' },
            h(
              'div',
              { class: 'rhythm', role: 'img', 'aria-label': 'How much you are at the computer in each hour of the day' },
              r.hours.map((v, hour) =>
                h('span', {
                  class: inSleep(hour) ? 'sleep' : '',
                  style: `height:${Math.max(4, Math.round((v / peak) * 100))}%`,
                  title: `${clock(hour)}: ${Math.round(v * 60)} min at the computer on a usual day${inSleep(hour) ? ' · Mote sleeps' : ''}`,
                }),
              ),
            ),
            h('div', { class: 'rhythm-axis faint' }, [0, 6, 12, 18, 24].map((x) => h('span', {}, clock(x % 24)))),
          )
        : null,
      known ? h('p', { class: 'faint' }, 'Bars: how much you’re at the computer in each hour on a usual day. Dim bars: when Mote sleeps now.') : null,
      h('p', { class: 'muted' }, rhythmWords(s)),
      known || s.todayMinutes > 0 ? h('div', { class: 'actions' }, h('button', { class: 'link-btn', type: 'button', onclick: forget }, 'Forget my rhythm')) : null,
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
      h('div', {}, noticeSection()),
      h('div', {}, desktopSection()),
      h('div', {}, soundSection()),
      h('div', {}, aboutSection()),
    );
  }

  async function load() {
    render();
    try {
      const [m, p, s] = await Promise.all([api.models(), desktop ? desktop.getPrefs() : Promise.resolve(null), api.senses().catch(() => null)]);
      status = m.status;
      prefs = p;
      senses = s;
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
