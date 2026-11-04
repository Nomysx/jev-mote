// Mote's inner-life events in words, for the "while you were away" card and the journal.

import { topKey } from '../../../shared/dream';
import type { Archetype, Dream, LifeEvent } from '../../../shared/types';
import { DREAM_TITLES, PLACE_WORDS } from './dreamLines';
import { IDLE_ACTION_LABELS, IDLE_LINES, lineFor } from './lines';

const quote = (text: string, n = 70) => {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

export function dreamTitle(d: Dream): string {
  return `${DREAM_TITLES[topKey(d.event)]} ${PLACE_WORDS[topKey(d.place)]}`;
}

export const DREAM_EFFECT_WORDS: Record<Dream['effect'], string> = {
  processed: 'it slept on a hard day',
  nightmare: 'a nightmare',
  sweet: 'a sweet dream',
  none: '',
};

const WAKE_WORDS: Record<string, string> = {
  morning: 'woke up with the morning',
  rested: 'woke up rested',
  message: 'woke up when you wrote',
  poke: 'woke up when you poked it',
  nightmare: 'woke up from a bad dream',
};

export interface EventText {
  /** One short line. */
  text: string;
  /** An entry it was thinking or dreaming about. */
  quote?: string;
  kind: LifeEvent['kind'];
}

export function describeEvent(e: LifeEvent, archetype: Archetype): EventText {
  switch (e.kind) {
    case 'thought': {
      const line = lineFor(IDLE_LINES[topKey(e.thought)], archetype, e.seed);
      return { kind: e.kind, text: `“${line}” → ${IDLE_ACTION_LABELS[e.chosen]}`, quote: e.memory ? quote(e.memory.text) : undefined };
    }
    case 'sleep':
      return { kind: e.kind, text: e.cause === 'nap' ? 'dozed off for a nap' : e.cause === 'night' ? 'fell asleep for the night' : 'fell asleep, tired' };
    case 'wake': {
      const h = e.sleptMs / 3_600_000;
      const slept = h >= 1 ? ` after ${h.toFixed(h < 10 ? 1 : 0)} h` : '';
      return { kind: e.kind, text: `${WAKE_WORDS[e.cause] ?? 'woke up'}${slept}` };
    }
    case 'dream': {
      const effect = DREAM_EFFECT_WORDS[e.dream.effect];
      return {
        kind: e.kind,
        text: `${e.dream.remembered ? 'remembered a dream' : 'dreamed'}: ${dreamTitle(e.dream).toLowerCase()}${effect ? ` (${effect})` : ''}`,
        quote: e.dream.memories[0] ? quote(e.dream.memories[0].text) : undefined,
      };
    }
  }
}

export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function awayLength(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = ms / 3_600_000;
  if (h < 48) return `${h < 10 ? h.toFixed(1).replace(/\.0$/, '') : Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}
