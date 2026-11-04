// Journal view, in three tabs: your entries (weekly mood strip, filters, timeline with thumbnails),
// Mote's dreams (replayable), and its inner life (everything it thought, slept and dreamed).

import { decideIntent } from '../../../shared/decide';
import { topKey } from '../../../shared/dream';
import { EMOTIONS, LIFE_AREAS, type Intent, type JournalEntry, type LifeEvent, type Situation, type Temperament } from '../../../shared/types';
import { dreamToVisual, feelingToVisual } from '../../../shared/visuals';
import { buildWeek } from '../../../shared/week';
import { api } from '../api';
import type { Thumbnailer } from '../blob/Thumbnailer';
import { clockTime, describeEvent, DREAM_EFFECT_WORDS, dreamTitle } from '../mind/lifeText';
import { INTENT_LABELS, lineFor, SITUATION_LINES } from '../mind/lines';
import { clear, h, pct } from './dom';

type DreamEvent = LifeEvent & { kind: 'dream' };

export interface JournalDeps {
  thumbs: Thumbnailer;
  temperament: () => Temperament;
  serverNow: () => number;
  onWatchDream: (ev: DreamEvent) => void;
}

const PAGE = 30;
const CORE = 3;

const SKIPPED: Record<string, string> = {
  language: 'Not read: the model only reads English',
  offline: 'Not read: Ollama was not running',
  model_missing: 'Not read: model not downloaded',
  outdated: 'Not read: Ollama needed an update',
  endpoint_missing: 'Not read: Ollama needed an update',
  cloud_model: 'Not read: cloud models are not used',
  not_decision_model: 'Not read: not a decision model',
  context_exceeded: 'Not read: too long for the model',
  too_large: 'Not read: too long to send',
  timeout: 'Not read: the model took too long',
  out_of_memory: 'Not read: the model ran out of memory',
};

type Tab = 'entries' | 'dreams' | 'life';

export function createJournal(el: HTMLElement, deps: JournalDeps) {
  let area = '';
  let emotion = '';
  let entries: JournalEntry[] = [];
  let dreams: LifeEvent[] = [];
  let events: LifeEvent[] = [];
  let tab: Tab = 'entries';

  const weekEl = h('div', { class: 'week', role: 'list', 'aria-label': 'This week' });
  const listEl = h('div', { class: 'entries' });
  const moreBtn = h('button', { class: 'btn', type: 'button', onclick: () => load(true) }, 'Load more');
  const dreamsEl = h('div', { class: 'entries' });
  const moreDreams = h('button', { class: 'btn', type: 'button', onclick: () => loadDreams(true) }, 'Load more');
  const lifeEl = h('div', { class: 'life-log' });
  const moreLife = h('button', { class: 'btn', type: 'button', onclick: () => loadLife(true) }, 'Load more');

  const areaSel = h(
    'select',
    { 'aria-label': 'Filter by life area', onchange: (e: Event) => ((area = (e.target as HTMLSelectElement).value), load(false)) },
    h('option', { value: '' }, 'All areas'),
    LIFE_AREAS.map((a) => h('option', { value: a }, a)),
  );
  const emoSel = h(
    'select',
    { 'aria-label': 'Filter by emotion', onchange: (e: Event) => ((emotion = (e.target as HTMLSelectElement).value), load(false)) },
    h('option', { value: '' }, 'All emotions'),
    [...EMOTIONS, 'none'].map((a) => h('option', { value: a }, a)),
  );

  const sections: Record<Tab, HTMLElement> = {
    entries: h(
      'section',
      {},
      h('h3', {}, 'Your week'),
      weekEl,
      h('p', { class: 'faint' }, 'One blob per day, shaped by how your entries felt.'),
      h('h3', {}, 'Entries'),
      h('div', { class: 'filters' }, areaSel, emoSel),
      listEl,
      h('div', { class: 'row' }, moreBtn),
    ),
    dreams: h(
      'section',
      { hidden: true },
      h('p', { class: 'faint' }, 'Mote dreams in its sleep, about the things you wrote. The decision model chooses where each dream goes, what happens and how it ends.'),
      dreamsEl,
      h('div', { class: 'row' }, moreDreams),
    ),
    life: h(
      'section',
      { hidden: true },
      h('p', { class: 'faint' }, 'Everything Mote did on its own: what it thought about, when it slept, and what it dreamed.'),
      lifeEl,
      h('div', { class: 'row' }, moreLife),
    ),
  };
  const tabBtn = (t: Tab, label: string) =>
    h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(t === tab), 'data-tab': t, onclick: () => show(t) }, label);
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, tabBtn('entries', 'Entries'), tabBtn('dreams', 'Dreams'), tabBtn('life', 'Inner life'));

  el.append(
    h('button', { class: 'close-btn', type: 'button', 'aria-label': 'Close journal', onclick: () => toggle(false) }, '×'),
    h('h2', {}, 'Journal'),
    tabs,
    sections.entries,
    sections.dreams,
    sections.life,
  );

  function show(t: Tab) {
    tab = t;
    for (const [k, s] of Object.entries(sections) as [Tab, HTMLElement][]) s.hidden = k !== t;
    tabs.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String((b as HTMLElement).dataset.tab === t)));
    refresh();
  }

  function entryView(e: JournalEntry) {
    const img = h('img', { alt: '', width: 64, height: 64, loading: 'lazy' });
    img.src = deps.thumbs.render(`e${e.id}`, e.visual, deps.temperament().seed, e.id * 0.73);
    const when = new Date(e.createdAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const chips: (HTMLElement | null)[] = [];
    // What Mote thought and decided at the time (same line it showed: chosen by the entry id).
    if (e.signals?.situation) {
      const sit = (Object.entries(e.signals.situation) as [Situation, number][]).sort((a, b) => b[1] - a[1])[0][0];
      const decided = e.decision ?? (e.signals.intent ? decideIntent(e.signals.intent, e.signals.situation, deps.temperament().archetype) : null);
      const intent = decided ? (Object.entries(decided) as [Intent, number][]).sort((a, b) => b[1] - a[1])[0][0] : null;
      const thought = lineFor(SITUATION_LINES[sit], deps.temperament().archetype, e.id);
      chips.push(h('span', { class: 'chip thought', title: 'What Mote thought, and what it decided to do' }, `“${thought}”${intent ? ` → ${INTENT_LABELS[intent]}` : ''}`));
    }
    if ((e.recalls ?? 0) >= CORE) chips.push(h('span', { class: 'chip core', title: `Mote has thought or dreamed about this ${e.recalls} times` }, '✦ core memory'));
    else if (e.recalls) chips.push(h('span', { class: 'chip', title: 'Mote has thought or dreamed about this' }, `remembered ${e.recalls}×`));
    if (e.signals && e.userEmotion) {
      const p = e.signals.userEmotion[e.userEmotion] ?? 0;
      chips.push(h('span', { class: 'chip' }, `${e.userEmotion} ${pct(p)}`));
    }
    if (e.lifeArea) chips.push(h('span', { class: 'chip' }, e.lifeArea));
    if (e.skipped) chips.push(h('span', { class: 'chip warn' }, SKIPPED[e.skipped] ?? 'Not read'));
    if (e.model) chips.push(h('span', { class: 'chip', title: `Read by ${e.provider}/${e.model}` }, `${e.provider}/${e.model}`));
    return h('article', { class: 'entry' }, img, h('div', {}, h('div', { class: 'when' }, when), h('div', { class: 'text' }, e.text), h('div', { class: 'chips' }, chips)));
  }

  function dreamView(ev: DreamEvent) {
    const d = ev.dream;
    const t = deps.temperament();
    const img = h('img', { alt: '', width: 64, height: 64, loading: 'lazy' });
    img.src = deps.thumbs.render(`d${ev.id}`, dreamToVisual(d.feeling, d.vividness, t), t.seed, ev.id * 1.37);
    const when = new Date(ev.at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const effect = DREAM_EFFECT_WORDS[d.effect];
    const chips = [
      h('span', { class: 'chip' }, `felt ${topKey(d.feeling)}`),
      effect ? h('span', { class: `chip ${d.effect === 'nightmare' ? 'warn' : 'ok'}` }, effect) : null,
      h('span', { class: 'chip', title: 'How sure the model was about what happened' }, d.vividness > 0.55 ? 'vivid' : d.vividness < 0.3 ? 'hazy' : 'half-remembered'),
      d.remembered ? h('span', { class: 'chip' }, 'remembered later') : null,
      d.seen ? null : h('span', { class: 'chip core' }, 'new'),
    ];
    return h(
      'article',
      { class: 'entry dream' },
      img,
      h(
        'div',
        {},
        h('div', { class: 'when' }, when),
        h('div', { class: 'text' }, h('b', {}, dreamTitle(d))),
        d.memories.map((m) => h('div', { class: 'quote' }, `about “${m.text.length > 120 ? `${m.text.slice(0, 119).trimEnd()}…` : m.text}”`)),
        h('div', { class: 'chips' }, chips, h('button', { class: 'btn small', type: 'button', onclick: () => deps.onWatchDream(ev) }, '▶ Watch')),
      ),
    );
  }

  function lifeView(list: LifeEvent[]) {
    clear(lifeEl);
    let dayKey = '';
    for (const ev of list) {
      const d = new Date(ev.at);
      const key = d.toDateString();
      if (key !== dayKey) {
        dayKey = key;
        lifeEl.append(h('h4', {}, d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })));
      }
      const txt = describeEvent(ev, deps.temperament().archetype);
      lifeEl.append(
        h(
          'div',
          { class: `life-row ${ev.kind}` },
          h('span', { class: 'when' }, clockTime(ev.at)),
          h(
            'span',
            {},
            txt.text,
            txt.quote ? h('span', { class: 'quote' }, ` “${txt.quote}”`) : null,
            ev.kind === 'dream' ? h('button', { class: 'link-btn', type: 'button', onclick: () => deps.onWatchDream(ev as DreamEvent) }, 'watch') : null,
          ),
        ),
      );
    }
    if (!list.length) lifeEl.append(h('p', { class: 'muted' }, 'Nothing yet. Mote thinks, sleeps and dreams on its own over time.'));
  }

  async function load(append: boolean) {
    const before = append && entries.length ? entries[entries.length - 1].createdAt : undefined;
    const res = await api.journal({ area, emotion, before, limit: PAGE });
    entries = append ? entries.concat(res.entries) : res.entries;
    if (!append) clear(listEl);
    for (const e of res.entries) listEl.appendChild(entryView(e));
    if (!entries.length) listEl.appendChild(h('p', { class: 'muted' }, area || emotion ? 'No entries match these filters.' : 'No entries yet. Write something below.'));
    moreBtn.hidden = res.entries.length !== PAGE;
  }

  async function loadDreams(append: boolean) {
    const before = append && dreams.length ? dreams[dreams.length - 1].at : undefined;
    const res = await api.dreams({ before, limit: PAGE });
    dreams = append ? dreams.concat(res.dreams) : res.dreams;
    if (!append) clear(dreamsEl);
    for (const d of res.dreams) if (d.kind === 'dream') dreamsEl.appendChild(dreamView(d));
    if (!dreams.length) dreamsEl.appendChild(h('p', { class: 'muted' }, 'No dreams yet. Mote dreams when it sleeps, usually at night.'));
    moreDreams.hidden = res.dreams.length !== PAGE;
  }

  async function loadLife(append: boolean) {
    const before = append && events.length ? events[events.length - 1].at : undefined;
    const res = await api.lifeLog({ before, limit: 80 });
    events = append ? events.concat(res.events) : res.events;
    lifeView(events);
    moreLife.hidden = res.events.length !== 80;
  }

  async function loadWeek() {
    const now = deps.serverNow();
    const since = now - 8 * 24 * 3_600_000;
    const res = await api.journal({ since, limit: 500 });
    const days = buildWeek(res.entries, now);
    const t = deps.temperament();
    clear(weekEl);
    for (const d of days) {
      let pic: HTMLElement;
      if (d.read > 0) {
        const img = h('img', { alt: `${d.label}: ${d.count} entr${d.count === 1 ? 'y' : 'ies'}` });
        img.src = deps.thumbs.render(`d${d.start}-${d.read}-${d.valence.toFixed(3)}`, feelingToVisual(d.emotion, d.valence, d.intensity, t), t.seed, d.start / 1e7);
        pic = img;
      } else {
        pic = h('div', { class: 'empty', title: d.count ? 'Entries not read by a model' : 'No entries' });
      }
      weekEl.appendChild(h('div', { class: 'day', role: 'listitem' }, pic, d.label));
    }
  }

  function toggle(open?: boolean) {
    const showIt = open ?? el.hidden;
    el.hidden = !showIt;
    document.getElementById('btn-journal')?.setAttribute('aria-pressed', String(showIt));
    if (showIt) refresh();
  }

  function refresh() {
    if (el.hidden) return;
    if (tab === 'entries') {
      void load(false).catch(() => undefined);
      void loadWeek().catch(() => undefined);
    } else if (tab === 'dreams') void loadDreams(false).catch(() => undefined);
    else void loadLife(false).catch(() => undefined);
  }

  return { toggle, refresh, showTab: (t: Tab) => (toggle(true), show(t)) };
}
