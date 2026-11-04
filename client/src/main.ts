import '@fontsource/nunito/400.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/700.css';
import './styles.css';

import { EMOTIONS, type Emotion, type ProviderStatus } from '../../shared/types';
import { api, type BlobInfo, type MessageResponse, type MoodSummary, type StateResponse, type TickResponse, type WellbeingCard } from './api';
import { SoundEngine } from './audio/SoundEngine';
import { voiceFromTemperament, type MoodTone } from './audio/voice';
import { BlobView } from './blob/BlobView';
import { Thumbnailer } from './blob/Thumbnailer';
import { createDebug } from './ui/debug';
import { clear, h } from './ui/dom';
import { createJournal } from './ui/journal';
import { createSettings } from './ui/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const TICK_READY_MS = 60_000;
const TICK_WAITING_MS = 8_000;

const toneOf = (m: MoodSummary): MoodTone => ({ valence: m.valence, arousal: m.arousal, trust: m.trust, clarity: m.clarity });

async function boot() {
  const stage = $('stage');
  const statusEl = $('status');
  const notice = $('notice');
  const wellbeingEl = $('wellbeing');
  const form = $<HTMLFormElement>('composer');
  const textarea = $<HTMLTextAreaElement>('entry');
  const send = $<HTMLButtonElement>('send');

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
  let pending = false;
  let tickTimer: number | undefined;

  const view = new BlobView(stage, blob.temperament.seed);
  const thumbs = new Thumbnailer();
  const sound = new SoundEngine(voiceFromTemperament(blob.temperament));
  sound.setMood(toneOf(initial.mood));

  // Sounds for moments the blob itself notices: birth, being poked, an entry arriving, waking up.
  view.onEvent = (e) => {
    if (e.type === 'birth-start') sound.play('birth');
    else if (e.type === 'birth-pop') sound.play('pop');
    else if (e.type === 'absorb') sound.play('absorb');
    else if (e.type === 'wake') sound.play('wake', { delay: 0.4 });
    else if (e.type === 'poke') sound.play('poke', { pan: e.pan * 0.6, variant: 0.9 + Math.random() * 0.22 });
  };

  // Sound toggle in the top bar.
  const soundBtn = $<HTMLButtonElement>('btn-sound');
  const showSound = () => {
    soundBtn.textContent = sound.enabled ? 'Sound on' : 'Sound off';
    soundBtn.setAttribute('aria-pressed', String(sound.enabled));
  };
  soundBtn.addEventListener('click', () => sound.setEnabled(!sound.enabled));
  sound.onChange(showSound);
  showSound();

  /** The blob's reaction to an answered entry: a gesture and a sound for its strongest feeling. */
  function react(r: MessageResponse) {
    sound.setMood(toneOf(r.mood));
    const s = r.entry.signals;
    if (r.distress) {
      view.soothe();
      sound.play('soothe');
      return;
    }
    if (!s) {
      if (r.entry.skipped === 'language') {
        view.puzzled();
        sound.play('puzzled', { clarity: 0.3 });
      }
      return;
    }
    const ranked = [...EMOTIONS].sort((a, b) => s.blobReaction[b] - s.blobReaction[a]) as Emotion[];
    const opts = { intensity: s.userIntensity, second: ranked[1], mixed: r.mood.mixedness, clarity: s.blobReactionConfidence };
    view.react(ranked[0], opts);
    sound.play(ranked[0], opts);
    if (r.pulse) {
      window.setTimeout(() => {
        view.pulse();
        sound.play('pulse');
      }, 450);
    }
  }

  // Tint the page glow with the blob's color (throttled).
  let lastGlow = 0;
  view.onFrame = (v) => {
    const now = performance.now();
    if (now - lastGlow < 400) return;
    lastGlow = now;
    const light = document.documentElement.style;
    light.setProperty('--glow', `hsl(${Math.round(v.hueA * 360)} ${Math.round(v.saturation * 70)}% 55% / ${(0.12 + 0.14 * (1 - v.dim)).toFixed(2)})`);
  };

  // ---- Status (Ollama offline, model missing, too old, cloud model) ----
  function applyStatus(s: ProviderStatus) {
    status = s;
    const ready = s.state === 'ready';
    view.setDim(!ready);
    clear(statusEl);
    statusEl.hidden = ready;
    if (!ready) {
      statusEl.append(
        h(
          'div',
          {},
          h('div', { class: 'msg' }, s.message),
          s.command ? h('div', {}, h('code', {}, s.command)) : null,
          h('div', {}, h('button', { class: 'link-btn', type: 'button', onclick: () => void tick(true) }, 'Check again')),
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
    debug.showMood(t.mood, clockOffset);
    // Only after time jumps (debug fast-forward): a periodic refresh would reset the journal's scroll.
    if (refreshJournal) journal.refresh();
  }

  async function tick(force: boolean) {
    try {
      onTick(await api.tick(force || status.state !== 'ready'));
    } catch {
      applyStatus({ ...status, state: 'error', message: 'Lost connection to the Mote server.', command: undefined, checkedAt: Date.now() });
    }
  }

  // ---- Wellbeing card ----
  function showWellbeing(card: WellbeingCard) {
    clear(wellbeingEl);
    wellbeingEl.append(
      h('button', { class: 'close-btn', type: 'button', 'aria-label': 'Close', onclick: () => (wellbeingEl.hidden = true) }, '×'),
      h('h2', {}, card.title),
      h('p', {}, card.body),
      h('ul', {}, card.lines.map((l) => h('li', {}, h('b', {}, `${l.label}: `), l.text))),
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
  const journal = createJournal($('journal'), { thumbs, temperament: () => blob.temperament, serverNow: () => Date.now() + serverOffset });
  const settings = createSettings($('settings'), { blob: () => blob, wellbeing: () => wellbeing, onStatus: applyStatus, sound });
  const debug = createDebug($('debug'), {
    view,
    sound,
    onTick: (t) => onTick(t, true),
    onRebirth: (s) => {
      blob = s.blob;
      sound.setVoice(voiceFromTemperament(s.blob.temperament));
      sound.setMood(toneOf(s.mood));
      view.setTarget(s.visual, { immediate: true });
      void view.playBirth();
      onTick(s, true);
      void settings.refresh();
    },
  });
  $('btn-journal').addEventListener('click', () => journal.toggle());
  $('btn-settings').addEventListener('click', () => settings.toggle());
  const debugBtn = $('btn-debug');
  debugBtn.hidden = !initial.debugTools;
  debugBtn.addEventListener('click', () => debug.toggle());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      journal.toggle(false);
      settings.toggle(false);
    }
  });

  // ---- Composer ----
  const autosize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  textarea.addEventListener('input', () => {
    autosize();
    view.notifyTyping();
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
    send.disabled = true;
    showNotice(null);
    // The entry flows from the text box into the blob as light; it listens while the model reads.
    const box = textarea.getBoundingClientRect();
    const arrived = view.absorb(box.left + box.width / 2, box.top + box.height / 2);
    void arrived.then(() => pending && view.setListening(true));
    try {
      const r = await api.message(text);
      textarea.value = '';
      autosize();
      await arrived;
      view.setTarget(r.visual);
      react(r);
      if (r.distress && r.wellbeing) showWellbeing(r.wellbeing);
      showNotice(r.notice, r.hint);
      applyStatus(r.status);
      debug.showMood(r.mood, clockOffset);
      journal.refresh();
    } catch (err) {
      showNotice(`Couldn’t save that: ${(err as Error).message}. Your text is still here.`);
    } finally {
      pending = false;
      send.disabled = false;
      view.setListening(false);
      textarea.focus();
    }
  });

  // ---- First frame: birth, waking up, or straight to the current look ----
  if (initial.newborn) {
    view.setTarget(initial.visual, { immediate: true });
    void view.playBirth();
  } else if (initial.wake) {
    view.wake(initial.wake.before, initial.visual);
  } else {
    view.setTarget(initial.visual, { immediate: true });
  }
  applyStatus(initial.status);
  debug.showMood(initial.mood, initial.clockOffsetMs);
  if (new URLSearchParams(location.search).has('debug') && initial.debugTools) debug.toggle(true);
  textarea.focus();
}

void boot();
