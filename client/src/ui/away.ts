// "While you were away": what Mote did while the page was closed or hidden. It thought, slept,
// dreamed and woke up on its own; this card shows the notable moments with their times.

import type { Archetype, AwayDigest, Greeting, LifeEvent } from '../../../shared/types';
import { awayLength, clockTime, describeEvent } from '../mind/lifeText';
import { clear, h } from './dom';

const GREETING_WORDS: Record<Greeting, string> = {
  joyful: 'It missed you.',
  warm: 'It’s glad you’re here.',
  sulky: 'It’s still a little hurt.',
  sleepy: 'It’s sleepy.',
  asleep: 'It’s asleep right now.',
};

export function createAwayCard(el: HTMLElement, deps: { archetype: () => Archetype; onWatch: (ev: LifeEvent & { kind: 'dream' }) => void }) {
  let timer: number | undefined;

  function hide() {
    window.clearTimeout(timer);
    el.hidden = true;
  }

  function show(d: AwayDigest) {
    if (!d.events.length) return;
    clear(el);
    el.append(
      h('button', { class: 'close-btn', type: 'button', 'aria-label': 'Close', onclick: hide }, '×'),
      h('h2', {}, 'While you were away'),
      h('p', { class: 'faint' }, `${awayLength(d.until - d.since)} · ${GREETING_WORDS[d.greeting]}`),
      h(
        'ul',
        {},
        d.events.map((ev) => {
          const t = describeEvent(ev, deps.archetype());
          return h(
            'li',
            { class: ev.kind },
            h('span', { class: 'when' }, clockTime(ev.at)),
            h(
              'span',
              {},
              t.text,
              t.quote ? h('span', { class: 'quote' }, ` “${t.quote}”`) : null,
              ev.kind === 'dream' ? h('button', { class: 'link-btn', type: 'button', onclick: () => (hide(), deps.onWatch(ev)) }, 'watch') : null,
            ),
          );
        }),
      ),
    );
    el.hidden = false;
    window.clearTimeout(timer);
    timer = window.setTimeout(hide, 75_000);
  }

  return { show, hide };
}
