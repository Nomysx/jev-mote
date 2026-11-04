// Journal view: weekly mood strip, filters, and a timeline of entries with blob thumbnails.

import { decideIntent } from '../../../shared/decide';
import { EMOTIONS, LIFE_AREAS, type Intent, type JournalEntry, type Situation, type Temperament } from '../../../shared/types';
import { feelingToVisual } from '../../../shared/visuals';
import { buildWeek } from '../../../shared/week';
import { api } from '../api';
import type { Thumbnailer } from '../blob/Thumbnailer';
import { INTENT_LABELS, lineFor, SITUATION_LINES } from '../mind/lines';
import { clear, h, pct } from './dom';

export interface JournalDeps {
  thumbs: Thumbnailer;
  temperament: () => Temperament;
  serverNow: () => number;
}

const PAGE = 30;

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

export function createJournal(el: HTMLElement, deps: JournalDeps) {
  let area = '';
  let emotion = '';
  let entries: JournalEntry[] = [];
  let more = false;

  const weekEl = h('div', { class: 'week', role: 'list', 'aria-label': 'This week' });
  const listEl = h('div', { class: 'entries' });
  const moreBtn = h('button', { class: 'btn', type: 'button', onclick: () => load(true) }, 'Load more');

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

  el.append(
    h('button', { class: 'close-btn', type: 'button', 'aria-label': 'Close journal', onclick: () => toggle(false) }, '×'),
    h('h2', {}, 'Journal'),
    h('h3', {}, 'Your week'),
    weekEl,
    h('p', { class: 'faint' }, 'One blob per day, shaped by how your entries felt.'),
    h('h3', {}, 'Entries'),
    h('div', { class: 'filters' }, areaSel, emoSel),
    listEl,
    h('div', { class: 'row' }, moreBtn),
  );

  function entryView(e: JournalEntry) {
    const img = h('img', { alt: '', width: 64, height: 64, loading: 'lazy' });
    img.src = deps.thumbs.render(`e${e.id}`, e.visual, deps.temperament().seed, e.id * 0.73);
    const when = new Date(e.createdAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const chips: (HTMLElement | null)[] = [];
    // What Mote thought and decided at the time (same line it showed: chosen by the entry id).
    if (e.signals?.situation) {
      const sit = (Object.entries(e.signals.situation) as [Situation, number][]).sort((a, b) => b[1] - a[1])[0][0];
      const decided = e.signals.intent ? decideIntent(e.signals.intent, e.signals.situation, deps.temperament().archetype) : null;
      const intent = decided ? (Object.entries(decided) as [Intent, number][]).sort((a, b) => b[1] - a[1])[0][0] : null;
      const thought = lineFor(SITUATION_LINES[sit], deps.temperament().archetype, e.id);
      chips.push(h('span', { class: 'chip thought', title: 'What Mote thought, and what it decided to do' }, `“${thought}”${intent ? ` → ${INTENT_LABELS[intent]}` : ''}`));
    }
    if (e.signals && e.userEmotion) {
      const p = e.signals.userEmotion[e.userEmotion] ?? 0;
      chips.push(h('span', { class: 'chip' }, `${e.userEmotion} ${pct(p)}`));
    }
    if (e.lifeArea) chips.push(h('span', { class: 'chip' }, e.lifeArea));
    if (e.skipped) chips.push(h('span', { class: 'chip warn' }, SKIPPED[e.skipped] ?? 'Not read'));
    if (e.model) chips.push(h('span', { class: 'chip', title: `Read by ${e.provider}/${e.model}` }, `${e.provider}/${e.model}`));
    return h('article', { class: 'entry' }, img, h('div', {}, h('div', { class: 'when' }, when), h('div', { class: 'text' }, e.text), h('div', { class: 'chips' }, chips)));
  }

  async function load(append: boolean) {
    const before = append && entries.length ? entries[entries.length - 1].createdAt : undefined;
    const res = await api.journal({ area, emotion, before, limit: PAGE });
    entries = append ? entries.concat(res.entries) : res.entries;
    more = res.entries.length === PAGE;
    if (!append) clear(listEl);
    for (const e of res.entries) listEl.appendChild(entryView(e));
    if (!entries.length) listEl.appendChild(h('p', { class: 'muted' }, area || emotion ? 'No entries match these filters.' : 'No entries yet. Write something below.'));
    moreBtn.hidden = !more;
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
    const show = open ?? el.hidden;
    el.hidden = !show;
    document.getElementById('btn-journal')?.setAttribute('aria-pressed', String(show));
    if (show) refresh();
  }

  function refresh() {
    if (el.hidden) return;
    void load(false).catch(() => undefined);
    void loadWeek().catch(() => undefined);
  }

  return { toggle, refresh };
}
