import '@fontsource/nunito/400.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/700.css';
import './styles.css';

import { decideIdleAction, decideIntent } from '../../shared/decide';
import { EMOTIONS, type AwayDigest, type Emotion, type IdleAction, type Intent, type LifeEvent, type LifeView, type ProviderStatus, type Situation } from '../../shared/types';
import { api, type BlobInfo, type CharacterBrief, type MessageResponse, type MoodSummary, type StateResponse, type ThinkResponse, type TickResponse, type WellbeingCard } from './api';
import { SoundEngine } from './audio/SoundEngine';
import { voiceFromTemperament, type MoodTone } from './audio/voice';
import { BlobView } from './blob/BlobView';
import { FlatView } from './blob/FlatView';
import { Thumbnailer } from './blob/Thumbnailer';
import { DreamTheater } from './mind/DreamTheater';
import { GREETING_LINES, NIGHTMARE_LINES, REMEMBERED_INTRO_LINES, WOKEN_LINES } from './mind/dreamLines';
import { loadMindPrefs, Mind, saveMindPrefs } from './mind/Mind';
import { IDLE_ACTION_LABELS, IDLE_LINES, INTENT_LABELS, lineFor, pickFrom, PUZZLED_LINES, SITUATION_LINES, SOOTHE_LINES } from './mind/lines';
import { SleepZ } from './mind/SleepZ';
import { ThoughtLayer, type Candidate } from './mind/ThoughtLayer';
import { createAwayCard } from './ui/away';
import { createDebug } from './ui/debug';
import { clear, h } from './ui/dom';
import { createJournal } from './ui/journal';
import { createMindMap } from './ui/mindmap';
import { createSettings } from './ui/settings';
import { createSetup } from './ui/setup';
import { desktop, viewMode } from './desktop';

type DreamEvent = LifeEvent & { kind: 'dream' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const TICK_READY_MS = 60_000;
const WELCOME_KEY = 'mote.welcomed';

/** What a not-ready status means, in plain words, and what the button does. */
const STATUS_HELP: Partial<Record<ProviderStatus['state'], { msg: string; action: string }>> = {
  offline: { msg: 'Mote is asleep until its engine is running.', action: 'Set up Mote' },
  model_missing: { msg: 'Mote needs a small model to wake up.', action: 'Choose a model' },
  outdated: { msg: 'Mote’s engine needs an update.', action: 'Fix it' },
  endpoint_missing: { msg: 'Mote’s engine needs an update.', action: 'Fix it' },
  cloud_model: { msg: 'That model runs in the cloud. Mote only uses models on this computer.', action: 'Choose a model' },
  not_decision_model: { msg: 'That model can’t be Mote’s brain.', action: 'Choose a model' },
  remote_host: { msg: 'Mote’s engine has to run on this computer.', action: 'Set up Mote' },
};
const TICK_WAITING_MS = 8_000;
const POKES_TO_WAKE = 3;

const toneOf = (m: MoodSummary): MoodTone => ({ valence: m.valence, arousal: m.arousal, trust: m.trust, clarity: m.clarity });

/** The most likely keys of a distribution, above a floor, most likely first. */
function top<K extends string>(dist: Record<K, number>, n: number, floor: number): [K, number][] {
  return (Object.entries(dist) as [K, number][])
    .filter(([, p]) => p >= floor)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const label = (k: string) => k.replace(/_/g, ' ');

async function boot() {
  const app = $('app');
  const stage = $('stage');
  const statusEl = $('status');
  const notice = $('notice');
  const wellbeingEl = $('wellbeing');
  const form = $<HTMLFormElement>('composer');
  const textarea = $<HTMLTextAreaElement>('entry');
  const dreamOffer = $<HTMLButtonElement>('dream-offer');
  document.body.classList.add(`mode-${viewMode}`);
  if (desktop) document.body.classList.add('desktop');

  let initial: StateResponse;
  try {
    initial = await api.state();
  } catch (err) {
    statusEl.hidden = false;
    statusEl.append(h('div', { class: 'msg' }, 'The Mote server isn’t running.'), h('div', {}, 'Start it with'), h('code', {}, 'npm run dev'));
    return;
  }

  let blob: BlobInfo = initial.blob;
  let wellbeing: WellbeingCard = initial.wellbeing;
  let serverOffset = initial.now - Date.now();
  let status: ProviderStatus = initial.status;
  let clockOffset = initial.clockOffsetMs;
  let life: LifeView = initial.life;
  let character: CharacterBrief | null = initial.character;
  let pending = false;
  let tickTimer: number | undefined;
  let lastInput = performance.now();
  const idleMs = () => performance.now() - lastInput;
  const noteInput = () => (lastInput = performance.now());
  window.addEventListener('pointerdown', noteInput, { capture: true });
  window.addEventListener('keydown', noteInput, { capture: true });

  // 3D when the computer allows it; a simple 2D Mote when WebGL can't start (e.g. a blocked GPU driver).
  let view: BlobView;
  try {
    view = new BlobView(stage, blob.temperament.seed);
  } catch (err) {
    console.warn('3D is unavailable, using the 2D Mote:', (err as Error).message);
    stage.querySelectorAll('canvas').forEach((c) => c.remove());
    view = new FlatView(stage, blob.temperament.seed) as unknown as BlobView;
  }
  const thumbs = new Thumbnailer();
  const sound = new SoundEngine(voiceFromTemperament(blob.temperament));
  sound.setMood(toneOf(initial.mood));

  // ---- Mote's mind: thoughts (the model's real probabilities), decisions, and its inner life ----
  const mindPrefs = loadMindPrefs();
  const layer = new ThoughtLayer($('mind'), () => view.getScreenAnchor());
  layer.enabled = mindPrefs.thoughts;
  const theater = new DreamTheater({ stage, app, view, sound, layer, temperament: () => blob.temperament });
  const zs = new SleepZ($('mind'), () => view.getScreenAnchor());

  // Pokes: awake, a squish; asleep, it stirs, and a few pokes in a row wake it up.
  let sleepPokes: number[] = [];
  view.onEvent = (e) => {
    if (e.type === 'birth-start') sound.play('birth');
    else if (e.type === 'birth-pop') sound.play('pop');
    else if (e.type === 'absorb') sound.play('absorb');
    else if (e.type === 'wake') sound.play('wake', { delay: 0.4 });
    else if (e.type === 'twitch') {
      if (Math.random() < 0.35) sound.play('murmur', { variant: Math.random() });
    } else if (e.type === 'poke') {
      if (!e.asleep) {
        sound.play('poke', { pan: e.pan * 0.6, variant: 0.9 + Math.random() * 0.22 });
        return;
      }
      sound.play('murmur', { pan: e.pan * 0.5, variant: Math.random() });
      const now = performance.now();
      sleepPokes = [...sleepPokes.filter((t) => now - t < 6000), now];
      if (sleepPokes.length >= POKES_TO_WAKE) {
        sleepPokes = [];
        void wakeUp();
      }
    }
  };

  // Sound toggle in the top bar.
  const soundBtn = $<HTMLButtonElement>('btn-sound');
  const showSound = () => {
    soundBtn.querySelector('.label')!.textContent = sound.enabled ? 'Sound on' : 'Sound off';
    soundBtn.classList.toggle('off', !sound.enabled);
    soundBtn.setAttribute('aria-pressed', String(sound.enabled));
  };
  soundBtn.addEventListener('click', () => sound.setEnabled(!sound.enabled));
  sound.onChange(showSound);
  showSound();

  /** Sounds that go with a behavior Mote decided on. */
  function behaviorSound(kind: Intent | IdleAction) {
    if (kind === 'hum') sound.play('hum', { variant: Math.random() });
    else if (kind === 'nap' || kind === 'rest') {
      sound.play('snore', { delay: 1.5 });
      if (kind === 'nap') sound.play('snore', { delay: 14 });
    } else if (kind === 'sulk') sound.play('hmph', { delay: 0.3 });
    else if (kind === 'stretch') sound.play('wake', { delay: 0.2 });
  }

  /** A single quiet thought (waking up, greeting, remembering a dream). */
  const murmurThought = (text: string, confidence = 0.8) => void layer.play({ quiet: true, thoughts: [{ text, p: 1 }], confidence });

  /**
   * The reaction to an answered entry. Candidate thoughts surface sized by their probability, the
   * strongest wins (and Mote feels it: gesture + sound), then it decides what to do and does it.
   */
  async function react(r: MessageResponse) {
    sound.setMood(toneOf(r.mood));
    view.cancelBehavior();
    const s = r.entry.signals;
    const archetype = blob.temperament.archetype;
    const seed = r.entry.id;
    if (r.distress) {
      // The safeguard stays gentle: one soft thought, slow breathing, staying close.
      view.soothe();
      sound.play('soothe');
      view.behave('comfort', 24);
      await layer.play({ thoughts: [{ text: pickFrom(SOOTHE_LINES, seed), p: 1 }], confidence: 1 });
      return;
    }
    if (!s) {
      if (r.entry.skipped === 'language') {
        view.puzzled();
        sound.play('puzzled', { clarity: 0.3 });
        await layer.play({ thoughts: [{ text: pickFrom(PUZZLED_LINES, seed), p: 1 }], confidence: 0.25 });
      }
      return;
    }
    const ranked = [...EMOTIONS].sort((a, b) => s.blobReaction[b] - s.blobReaction[a]) as Emotion[];
    const opts = { intensity: s.userIntensity, second: ranked[1], mixed: r.mood.mixedness, clarity: s.blobReactionConfidence };
    const feel = () => {
      view.react(ranked[0], opts);
      sound.play(ranked[0], opts);
      if (r.pulse) {
        window.setTimeout(() => {
          view.pulse();
          sound.play('pulse');
        }, 450);
      }
    };
    const thoughts: Candidate[] = s.situation
      ? top(s.situation, 4, 0.03).map(([k, p], i) => ({
          text: lineFor(SITUATION_LINES[k as Situation], archetype, i === 0 ? seed : seed + 1009 * i),
          p,
          detail: `${label(k)}, ${pct(p)}`,
        }))
      : [];
    // The model suggests an action; Mote weighs it against the moment, its temperament and who it has become.
    const decided = r.entry.decision ?? (s.intent && s.situation ? decideIntent(s.intent, s.situation, archetype) : null);
    const intents = decided ? top(decided, 3, 0.04) : [];
    const chosen = intents[0]?.[0];
    if (!layer.enabled || thoughts.length === 0) {
      feel();
      if (chosen) {
        view.behave(chosen);
        behaviorSound(chosen);
      }
      return;
    }
    sound.play('thought');
    view.gesture('curiosity', 0.35); // a small "thinking" tilt while the thoughts surface
    await layer.play({
      thoughts,
      confidence: s.situationConfidence ?? 0.5,
      decision: intents.length
        ? { options: intents.map(([k, p]) => ({ text: INTENT_LABELS[k], p, detail: `${label(k)}, ${pct(p)}` })), confidence: s.intentConfidence ?? 0.5 }
        : undefined,
      onSettle: feel,
      onDecide: () => {
        if (!chosen) return;
        sound.play('decide');
        view.behave(chosen);
        behaviorSound(chosen);
      },
    });
  }

  /** A thought on its own: what's on its mind (maybe one of your past entries), then what it does. */
  async function muse(r: ThinkResponse) {
    if (!r.thought || !r.action) return;
    const archetype = blob.temperament.archetype;
    const seed = r.seed || Math.floor(Math.random() * 1e6);
    const ts = top(r.thought.probabilities, 3, 0.05);
    if (ts.length === 0) return;
    const remembering = ts[0][0].startsWith('remember') && r.memory;
    const decision = r.decision?.probabilities ?? decideIdleAction(r.action.probabilities, r.thought.probabilities, new Date().getHours());
    const actions = top(decision, 3, 0.05);
    const action = r.decision?.chosen ?? actions[0]?.[0];
    await layer.play({
      quiet: true,
      thoughts: ts.map(([k, p], i) => ({ text: lineFor(IDLE_LINES[k], archetype, i === 0 ? seed : seed + 131 * i), p, detail: `${label(k)}, ${pct(p)}` })),
      confidence: r.thought.confidence,
      quote: remembering && r.memory ? (r.memory.text.length > 90 ? `${r.memory.text.slice(0, 89).trimEnd()}…` : r.memory.text) : undefined,
      decision: actions.length
        ? { options: actions.map(([k, p]) => ({ text: IDLE_ACTION_LABELS[k], p, detail: `${label(k)}, ${pct(p)}` })), confidence: r.action.confidence }
        : undefined,
      onSettle: () => {
        sound.play('thought', { intensity: 0.3 });
        // What it thinks about moves it a little.
        if (r.visual && !pending) view.setTarget(r.visual, { tau: 2.5, holdMs: 6000 });
      },
      onDecide: () => {
        if (!action) return;
        view.behave(action);
        behaviorSound(action);
      },
    });
    if (r.life) applyLife(r.life);
  }

  /** One moment of inner life, from the page's own thinking. */
  async function live(r: ThinkResponse) {
    if (r.kind === 'thought') return muse(r);
    if (r.kind === 'dream') {
      if (r.wokeUp) {
        // A nightmare woke it.
        view.setSleep(false);
        view.pulse();
        sound.play('pulse');
        murmurThought(pickFrom(NIGHTMARE_LINES, r.seed), 0.5);
      } else if (r.life?.asleep) {
        // Dreaming right in front of you: a few twitches, a murmur.
        view.gesture('twitch', 1);
        window.setTimeout(() => view.gesture('twitch', 0.7), 900);
        sound.play('murmur', { variant: Math.random() });
      } else {
        murmurThought(pickFrom(REMEMBERED_INTRO_LINES, r.seed));
      }
      if (r.visual && !pending) view.setTarget(r.visual, { tau: 2.5, holdMs: 6000 });
      if (r.life) applyLife(r.life, { quiet: true });
      return;
    }
    if (r.life) applyLife(r.life);
  }

  const mind = new Mind({
    think: (signal) => api.think(signal),
    enabled: () => life.background,
    canThink: () => status.state === 'ready' && !pending && !layer.busy && !view.behaving && !theater.playing,
    onThought: (r) => live(r),
  });
  mind.start();

  // ---- Sleep, waking up, dreams ----
  let snoreTimer: number | undefined;
  function applyLife(l: LifeView, opts: { quiet?: boolean } = {}) {
    const was = life;
    life = l;
    view.setSleep(l.asleep, l.dreaming);
    zs.set(l.asleep && !theater.playing);
    document.body.classList.toggle('mote-asleep', l.asleep);
    textarea.placeholder = l.asleep ? 'Mote is asleep… writing will wake it' : 'Write to Mote…';
    window.clearInterval(snoreTimer);
    if (l.asleep) snoreTimer = window.setInterval(() => document.visibilityState === 'visible' && !theater.playing && sound.play('snore'), 19_000);
    if (!opts.quiet && was) {
      if (!was.asleep && l.asleep) {
        // Fell asleep while you watched.
        view.behave('nap', 8);
        sound.play('snore', { delay: 1.2 });
      } else if (was.asleep && !l.asleep && !pending) {
        // Woke up by itself (morning, or rested).
        view.wake(view.getCurrent(), view.getTarget());
        murmurThought(pickFrom(WOKEN_LINES, Math.floor(Math.random() * 1e6)));
      }
    }
    dreamOffer.hidden = !(l.unseenDream && !l.asleep && !theater.playing);
  }

  async function wakeUp() {
    try {
      const r = await api.wake();
      if (r.woke) {
        view.wake(view.getCurrent(), r.visual);
        murmurThought(pickFrom(WOKEN_LINES, Math.floor(Math.random() * 1e6)), r.woke.groggy ? 0.3 : 0.8);
      }
      applyLife(r.life, { quiet: true });
    } catch {
      /* offline: it just keeps sleeping */
    }
  }

  async function watchDream(ev: DreamEvent) {
    journal.toggle(false);
    growth.toggle(false);
    settings.toggle(false);
    away.hide();
    dreamOffer.hidden = true;
    zs.set(false);
    mind.notifyActivity();
    await theater.play(ev);
    if (!ev.dream.seen) await api.dreamSeen(ev.id).catch(() => undefined);
    void tick(false);
  }

  dreamOffer.addEventListener('click', async () => {
    const id = life.unseenDream?.id;
    const d = (await api.dreams({ limit: 5 })).dreams.find((e) => e.id === id) ?? (await api.dreams({ limit: 1 })).dreams[0];
    if (d?.kind === 'dream') void watchDream(d);
  });

  /** How it greets you when you come back. */
  function greet(d: AwayDigest) {
    const seed = Math.floor(Math.random() * 1e6);
    const archetype = blob.temperament.archetype;
    window.setTimeout(() => {
      if (pending || theater.playing || life.asleep) return;
      if (d.greeting === 'joyful') {
        view.react('joy', { intensity: 0.4 + 0.5 * d.longing });
        sound.play('joy', { intensity: 0.5 });
        view.behave('come_closer', 9);
        murmurThought(lineFor(SITUATION_LINES.greeting, archetype, seed));
      } else if (d.greeting === 'warm') {
        view.gesture('curiosity', 0.5);
        murmurThought(lineFor(SITUATION_LINES.greeting, archetype, seed));
      } else if (d.greeting === 'sulky') {
        view.behave('sulk', 7);
        sound.play('hmph', { delay: 0.3 });
        murmurThought(pickFrom(GREETING_LINES.sulky!, seed), 0.5);
      } else if (d.greeting === 'sleepy') {
        view.gesture('wake', 0.7);
        sound.play('wake');
        murmurThought(pickFrom(GREETING_LINES.sleepy!, seed), 0.5);
      }
    }, 2400);
  }

  function welcomeBack(d: AwayDigest | null) {
    if (!d) return;
    if (wellbeingEl.hidden) away.show(d);
    greet(d);
  }

  // Tint the page glow with the blob's color (throttled).
  let lastGlow = 0;
  view.onFrame = (v) => {
    const now = performance.now();
    if (now - lastGlow < 400) return;
    lastGlow = now;
    const light = document.documentElement.style;
    light.setProperty('--glow', `hsl(${Math.round(v.hueA * 360)} ${Math.round(v.saturation * 70)}% 55% / ${(0.12 + 0.14 * (1 - v.dim)).toFixed(2)})`);
    // Thoughts glow in the blob's color on dark backgrounds.
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      light.setProperty('--thought-glow', `hsl(${Math.round(v.hueA * 360)} 80% 70% / 0.55)`);
    }
  };

  // ---- Status (Ollama offline, model missing, too old, cloud model) ----
  function applyStatus(s: ProviderStatus) {
    status = s;
    const ready = s.state === 'ready';
    view.setDim(!ready);
    clear(statusEl);
    statusEl.hidden = ready;
    if (!ready) {
      const help = STATUS_HELP[s.state] ?? { msg: s.message, action: 'Set up Mote' };
      statusEl.append(
        h(
          'div',
          {},
          h('div', { class: 'msg' }, help.msg),
          h(
            'div',
            { class: 'actions center' },
            h('button', { class: 'btn primary', type: 'button', onclick: () => openSetup() }, help.action),
            h('button', { class: 'btn', type: 'button', onclick: () => void tick(true) }, 'Check again'),
          ),
        ),
      );
    }
    scheduleTick();
  }

  function scheduleTick() {
    window.clearTimeout(tickTimer);
    tickTimer = window.setTimeout(() => void tick(false), status.state === 'ready' ? TICK_READY_MS : TICK_WAITING_MS);
  }

  function onTick(t: TickResponse, refreshJournal = false) {
    serverOffset = t.now - Date.now();
    clockOffset = t.clockOffsetMs;
    if (!pending) view.setTarget(t.visual);
    sound.setMood(toneOf(t.mood));
    applyStatus(t.status);
    if (t.life) applyLife(t.life);
    welcomeBack(t.away);
    debug.showMood(t.mood, clockOffset);
    // Only after time jumps (debug fast-forward): a periodic refresh would reset the journal's scroll.
    if (refreshJournal) journal.refresh();
  }

  async function tick(force: boolean) {
    try {
      onTick(await api.tick(force || status.state !== 'ready', { seen: document.visibilityState === 'visible', idleMs: idleMs() }));
    } catch {
      applyStatus({ ...status, state: 'error', message: 'Lost connection to the Mote server.', command: undefined, checkedAt: Date.now() });
    }
  }

  // Coming back to the tab: catch up at once (and see what it did meanwhile).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void tick(false);
  });

  // ---- Wellbeing card ----
  function showWellbeing(card: WellbeingCard) {
    away.hide();
    clear(wellbeingEl);
    wellbeingEl.append(
      h('button', { class: 'close-btn', type: 'button', 'aria-label': 'Close', onclick: () => (wellbeingEl.hidden = true) }, '×'),
      h('h2', {}, card.title),
      h('p', {}, card.body),
      h('div', { class: 'lines' }, card.lines.map((l) => h('p', {}, h('b', {}, `${l.label}: `), l.text))),
      h('p', { class: 'note' }, card.note),
    );
    wellbeingEl.hidden = false;
  }

  // ---- Notices ----
  let noticeTimer: number | undefined;
  function showNotice(text: string | null, hint: string | null = null) {
    window.clearTimeout(noticeTimer);
    clear(notice);
    if (text) notice.append(text);
    if (hint) notice.append(h('span', { class: 'hint' }, hint));
    if ((text || hint) && !hint) noticeTimer = window.setTimeout(() => clear(notice), 9000);
  }

  // ---- Panels ----
  const setup = createSetup($('setup'), { onStatus: (st) => applyStatus(st) });
  function openSetup() {
    if (viewMode === 'widget' && desktop) return desktop.openApp();
    journal.toggle(false);
    settings.toggle(false);
    growth.toggle(false);
    setup.toggle(true);
  }
  document.addEventListener('mote-ready', () => void tick(false));
  const away = createAwayCard($('away'), { archetype: () => blob.temperament.archetype, onWatch: (ev) => void watchDream(ev) });
  const journal = createJournal($('journal'), {
    thumbs,
    temperament: () => blob.temperament,
    serverNow: () => Date.now() + serverOffset,
    onWatchDream: (ev) => void watchDream(ev),
  });
  const growth = createMindMap($('growth'), { hue: () => view.getCurrent().hueA, serverNow: () => Date.now() + serverOffset });
  const settings = createSettings($('settings'), {
    blob: () => blob,
    wellbeing: () => wellbeing,
    onStatus: applyStatus,
    sound,
    mind: {
      get: () => ({ ...mindPrefs }),
      set: (p) => {
        Object.assign(mindPrefs, p);
        saveMindPrefs(mindPrefs);
        layer.enabled = mindPrefs.thoughts;
        if (!mindPrefs.thoughts) layer.cancel();
      },
    },
    life: {
      get: () => life,
      character: () => character,
      setBackground: async (on) => {
        await api.setLifeBackground(on);
        life = { ...life, background: on };
        if (!on) mind.notifyActivity();
      },
      openGrowth: () => {
        settings.toggle(false);
        growth.toggle(true);
      },
    },
    openSetup: () => openSetup(),
  });
  const debug = createDebug($('debug'), {
    view,
    sound,
    layer,
    thinkNow: () => mind.thinkNow(),
    onTick: (t) => onTick(t, true),
    onRebirth: (s) => {
      blob = s.blob;
      character = s.character;
      sound.setVoice(voiceFromTemperament(s.blob.temperament));
      sound.setMood(toneOf(s.mood));
      view.setTarget(s.visual, { immediate: true });
      void view.playBirth();
      onTick(s, true);
      void settings.refresh();
    },
    dreamNow: async () => {
      showNotice('Mote is dreaming…');
      const r = await api.debugDream().catch((err: Error) => ({ skipped: err.message, event: null }) as unknown as ThinkResponse);
      if (r.event?.kind === 'dream') {
        showNotice(null);
        if (r.life) applyLife(r.life, { quiet: true });
        await watchDream(r.event);
      } else showNotice(`Couldn’t dream: ${r.skipped ?? 'no answer'}`);
    },
    wakeNow: () => void wakeUp(),
    replayDream: async () => {
      const d = (await api.dreams({ limit: 1 })).dreams[0];
      if (d?.kind === 'dream') void watchDream(d);
      else showNotice('No dreams yet. Try “dream now”.');
    },
  });
  $('btn-journal').addEventListener('click', () => journal.toggle());
  $('btn-settings').addEventListener('click', () => settings.toggle());
  $('btn-growth').addEventListener('click', () => growth.toggle());
  const debugBtn = $('btn-debug');
  debugBtn.hidden = !initial.debugTools;
  debugBtn.addEventListener('click', () => debug.toggle());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !theater.playing) {
      journal.toggle(false);
      settings.toggle(false);
      growth.toggle(false);
      setup.toggle(false);
    }
  });

  // ---- The desktop widget's own controls ----
  $('w-open').addEventListener('click', () => (desktop ? desktop.openApp() : (location.search = '')));
  $('w-hide').addEventListener('click', () => desktop?.hide());
  $('w-hide').hidden = !desktop;

  // ---- First run: a short hello, then setup if Mote can't think yet ----
  function welcome() {
    const el = $('welcome');
    const needsSetup = status.state !== 'ready' && status.provider !== 'mock';
    clear(el);
    el.append(
      h('h2', {}, 'Hi, I’m Mote.'),
      h('p', {}, 'Write to me about anything: your day, a worry, a good thing. I can’t talk, but I feel it, and you’ll see it in my shape, colors and sounds.'),
      h('p', {}, 'I have a life of my own. I sleep, I dream about what you tell me, and I grow over time.'),
      h('p', { class: 'muted' }, 'Everything stays on this computer.'),
      h(
        'div',
        { class: 'actions center' },
        h(
          'button',
          {
            class: 'btn primary',
            type: 'button',
            onclick: () => {
              el.hidden = true;
              try {
                localStorage.setItem(WELCOME_KEY, '1');
              } catch {
                /* fine */
              }
              if (needsSetup) openSetup();
              else textarea.focus();
            },
          },
          needsSetup ? 'Set me up (a few minutes)' : 'Let’s start',
        ),
      ),
    );
    el.hidden = false;
  }

  // ---- Composer ----
  const autosize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  textarea.addEventListener('input', () => {
    autosize();
    if (theater.playing) theater.stop();
    if (!life.asleep) view.notifyTyping();
    mind.notifyActivity();
    away.hide();
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text || pending) return;
    pending = true;
    showNotice(null);
    mind.notifyActivity();
    layer.cancel();
    away.hide();
    // The entry flows from the text box into the blob as light; it listens while the model reads.
    const box = textarea.getBoundingClientRect();
    const arrived = view.absorb(box.left + box.width / 2, box.top + box.height / 2);
    void arrived.then(() => pending && view.setListening(true));
    try {
      const r = await api.message(text);
      textarea.value = '';
      autosize();
      await arrived;
      if (r.woke) {
        // You woke it up: a stretch first.
        view.gesture('wake', r.woke.groggy ? 0.7 : 1);
        sound.play('wake');
      }
      character = r.character;
      applyLife(r.life, { quiet: true });
      view.setTarget(r.visual);
      if (r.distress && r.wellbeing) showWellbeing(r.wellbeing);
      void react(r);
      showNotice(r.notice, r.hint);
      applyStatus(r.status);
      debug.showMood(r.mood, clockOffset);
      journal.refresh();
    } catch (err) {
      showNotice(`Couldn’t save that: ${(err as Error).message}. Your text is still here.`);
    } finally {
      pending = false;
      view.setListening(false);
      textarea.focus();
    }
  });

  // ---- First frame: birth, asleep, waking up, or straight to the current look ----
  if (initial.newborn) {
    view.setTarget(initial.visual, { immediate: true });
    void view.playBirth();
  } else if (initial.life.asleep) {
    view.setTarget(initial.visual, { immediate: true });
  } else if (initial.wake) {
    view.wake(initial.wake.before, initial.visual);
  } else {
    view.setTarget(initial.visual, { immediate: true });
  }
  applyLife(initial.life, { quiet: true });
  welcomeBack(initial.away);
  applyStatus(initial.status);
  debug.showMood(initial.mood, initial.clockOffsetMs);
  let welcomed = false;
  try {
    welcomed = localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    /* fine */
  }
  if (viewMode === 'app') {
    if (!welcomed) welcome();
    else if (initial.status.state !== 'ready' && initial.status.provider !== 'mock' && ['offline', 'model_missing'].includes(initial.status.state)) openSetup();
  }
  if (new URLSearchParams(location.search).has('debug') && initial.debugTools) debug.toggle(true);
  textarea.focus();
}

void boot();
