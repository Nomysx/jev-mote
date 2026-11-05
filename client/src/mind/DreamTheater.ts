// Replays one of Mote's dreams. The page turns into the dream's place, the candidate happenings
// surface like thoughts and one wins (the model's real probabilities), Mote acts it out in the
// dream's colors while words from your entries drift past, and the dream ends the way the model
// chose: peacefully, with a jolt awake, fading, changing into something else, or finding it.
// If the model was torn between two happenings, the dream shifts from one to the other.

import { secondKey, topKey } from '../../../shared/dream';
import type { DreamPlace, LifeEvent, Temperament } from '../../../shared/types';
import { dreamToVisual } from '../../../shared/visuals';
import type { SoundEngine } from '../audio/SoundEngine';
import type { BlobView } from '../blob/BlobView';
import { dreamFrame, restPose, type BehaviorFrame } from '../blob/gestures';
import { h } from '../ui/dom';
import { DREAM_ENDING_LINES, DREAM_EVENT_LINES, DREAM_INTRO_LINES, DREAM_PLACE_LINES, REMEMBERED_INTRO_LINES } from './dreamLines';
import { clockTime, dreamTitle } from './lifeText';
import { pickFrom } from './lines';
import type { ThoughtLayer } from './ThoughtLayer';

type DreamEvent = LifeEvent & { kind: 'dream' };

/** How the place looks: drifting particles of one kind. */
const PARTICLES: Record<DreamPlace, { anim: 'rise' | 'fall' | 'drift' | 'twinkle'; count: number; size: [number, number] }> = {
  sky: { anim: 'drift', count: 10, size: [80, 220] },
  sea: { anim: 'rise', count: 28, size: [4, 14] },
  forest: { anim: 'fall', count: 24, size: [5, 11] },
  city: { anim: 'twinkle', count: 40, size: [3, 6] },
  home: { anim: 'twinkle', count: 22, size: [3, 7] },
  school: { anim: 'fall', count: 12, size: [10, 18] },
  space: { anim: 'twinkle', count: 70, size: [1.5, 3.5] },
  dark: { anim: 'twinkle', count: 9, size: [2, 4] },
};

export interface TheaterDeps {
  stage: HTMLElement;
  app: HTMLElement;
  view: BlobView;
  sound: SoundEngine;
  layer: ThoughtLayer;
  temperament: () => Temperament;
}

export class DreamTheater {
  private scape: HTMLElement;
  private overlay: HTMLElement;
  private caption: HTMLElement;
  private sub: HTMLElement;
  private timers: number[] = [];
  private finish: (() => void) | null = null;
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  playing = false;

  constructor(private deps: TheaterDeps) {
    this.scape = h('div', { class: 'dreamscape', 'aria-hidden': 'true' });
    deps.stage.prepend(this.scape);
    this.caption = h('div', { class: 'dream-caption', role: 'status', 'aria-live': 'polite' });
    this.sub = h('div', { class: 'dream-sub' });
    this.overlay = h(
      'div',
      { class: 'dream-layer', hidden: true, title: 'Click to leave the dream', onclick: () => this.stop() },
      this.caption,
      this.sub,
      h('div', { class: 'dream-hint' }, 'click or press Esc to wake from the dream'),
    );
    deps.app.appendChild(this.overlay);
    window.addEventListener('keydown', (e) => {
      if (this.playing && e.key === 'Escape') this.stop();
    });
  }

  /** Plays a dream. Resolves when it is over (or skipped). */
  play(ev: DreamEvent): Promise<void> {
    if (this.playing) this.cleanup();
    const d = ev.dream;
    const { view, sound, layer } = this.deps;
    this.playing = true;
    const speed = this.reduceMotion ? 0.85 : 1;
    const at = (ms: number, fn: () => void) => this.timers.push(window.setTimeout(fn, ms * speed));
    const seed = ev.id;

    const first = topKey(d.event);
    const [second, p2] = secondKey(d.event);
    const shifts = p2 >= 0.22; // the model was torn: the dream shifts from one happening to the other
    const place = topKey(d.place);
    const ending = topKey(d.ending);
    const beatA = { kind: first, start: 3.6, dur: shifts ? 6.6 : 7.4 };
    const beatB = shifts ? { kind: second, start: 9.4, dur: 6.4 } : null;
    const endAt = (shifts ? 15.4 : 10.6) * 1000;

    // 1. Into the dream: the place, the dream's colors, a slow chord.
    this.scape.className = `dreamscape place-${place}`;
    this.scape.replaceChildren(...this.particles(place));
    requestAnimationFrame(() => this.scape.classList.add('on'));
    this.deps.app.classList.add('in-dream');
    this.overlay.hidden = false;
    view.cancelBehavior();
    view.setOverride(dreamToVisual(d.feeling, d.vividness, this.deps.temperament()));
    sound.play('dream');

    const start = performance.now();
    const amount = 0.6 + 0.4 * d.vividness;
    view.setDreamMotion(() => {
      const t = (performance.now() - start) / 1000 / speed;
      const sum: BehaviorFrame = { pose: restPose(), brightness: 0, speed: 0, grey: 0, sleepy: 0, halo: 0 };
      for (const b of [beatA, beatB]) {
        if (!b) continue;
        const f = dreamFrame(b.kind, t - b.start, b.dur);
        for (const k of Object.keys(sum.pose) as (keyof typeof sum.pose)[]) sum.pose[k] += f.pose[k] * amount;
        sum.brightness += f.brightness;
        sum.speed += f.speed;
        sum.grey += f.grey;
        sum.halo += f.halo;
      }
      return sum;
    });

    // 2. "I had a dream…", when, and what about.
    at(700, () => {
      this.say(pickFrom(d.remembered ? REMEMBERED_INTRO_LINES : DREAM_INTRO_LINES, seed));
      const about = d.memories[0] ? `, about “${d.memories[0].text.length > 70 ? `${d.memories[0].text.slice(0, 69).trimEnd()}…` : d.memories[0].text}”` : '';
      this.sub.textContent = `${d.remembered ? 'remembered' : 'dreamed'} at ${clockTime(ev.at)}${about}`;
    });

    // 3. What happens: the candidates surface and one wins.
    at(2100, () => {
      const options = (Object.entries(d.event) as [typeof first, number][]).sort((a, b) => b[1] - a[1]).slice(0, 3);
      void layer.play({
        quiet: true,
        thoughts: options.map(([k, p], i) => ({ text: pickFrom(DREAM_EVENT_LINES[k], seed + i), p, detail: `${k}, ${Math.round(p * 100)}%` })),
        confidence: d.vividness,
      });
    });

    // 4. The dream itself.
    at(beatA.start * 1000, () => {
      this.say(pickFrom(DREAM_EVENT_LINES[first], seed + 1));
      this.sub.textContent = pickFrom(DREAM_PLACE_LINES[place], seed);
      this.drift(d.fragments, endAt - beatA.start * 1000);
    });
    if (beatB) {
      at(beatB.start * 1000 + 500, () => {
        this.say(`then… ${pickFrom(DREAM_EVENT_LINES[second], seed + 2)}`);
        this.sub.textContent = '';
      });
    }

    // 5. How it ends.
    const woke = ending === 'woke_suddenly';
    at(endAt, () => {
      this.say(pickFrom(DREAM_ENDING_LINES[ending], seed));
      if (woke) {
        view.pulse();
        sound.play('pulse');
        this.scape.classList.add('flash');
      } else if (ending === 'peaceful') {
        sound.play('calm', { intensity: 0.3 });
      } else if (ending === 'found') {
        view.behave('glow', 4);
        sound.play('joy', { intensity: 0.35 });
      } else if (ending === 'transformed') {
        const v = dreamToVisual(d.feeling, d.vividness, this.deps.temperament());
        view.setOverride({ ...v, hueA: (v.hueA + 0.33) % 1, hueB: (v.hueB + 0.5) % 1, split: 0.6 });
        sound.play('curiosity', { intensity: 0.4 });
      } else {
        this.scape.classList.add('fading');
      }
    });

    const done = new Promise<void>((resolve) => (this.finish = resolve));
    at(endAt + (woke ? 1500 : 3400), () => this.stop());
    // Screen readers get the whole dream at once.
    this.caption.setAttribute('aria-label', `Mote's dream: ${dreamTitle(d).toLowerCase()}.`);
    return done;
  }

  /** Leaves the dream (fades out). */
  stop() {
    if (!this.playing) return;
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
    this.scape.classList.remove('on');
    this.overlay.classList.add('leaving');
    this.timers.push(window.setTimeout(() => this.cleanup(), 900));
  }

  private cleanup() {
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
    this.deps.layer.cancel();
    this.deps.view.setDreamMotion(null);
    this.deps.view.setOverride(null);
    this.deps.app.classList.remove('in-dream');
    this.overlay.hidden = true;
    this.overlay.classList.remove('leaving');
    this.overlay.querySelectorAll('.dream-word').forEach((w) => w.remove());
    this.scape.className = 'dreamscape';
    this.scape.replaceChildren();
    this.caption.textContent = '';
    this.sub.textContent = '';
    this.playing = false;
    this.finish?.();
    this.finish = null;
  }

  private say(text: string) {
    this.caption.classList.remove('show');
    window.setTimeout(() => {
      this.caption.textContent = text;
      this.caption.classList.add('show');
    }, 220);
  }

  /** Words from the writer's entries drift through the dream. */
  private drift(words: string[], forMs: number) {
    if (!words.length) return;
    const every = Math.max(900, Math.min(1600, forMs / (words.length * 1.5)));
    let i = 0;
    for (let t = 0; t < forMs - 2500; t += every) {
      const word = words[i++ % words.length];
      this.timers.push(
        window.setTimeout(() => {
          const ltr = Math.random() < 0.5;
          const el = h('span', { class: 'dream-word' }, word);
          el.style.top = `${18 + Math.random() * 58}%`;
          el.style.fontSize = `${14 + Math.random() * 12}px`;
          el.style.setProperty('--from', ltr ? '-15vw' : '105vw');
          el.style.setProperty('--to', ltr ? '105vw' : '-15vw');
          el.style.animationDuration = `${(this.reduceMotion ? 11 : 8) + Math.random() * 3}s`;
          el.addEventListener('animationend', () => el.remove());
          this.overlay.appendChild(el);
        }, t),
      );
    }
  }

  private particles(place: DreamPlace): HTMLElement[] {
    const spec = PARTICLES[place];
    const n = this.reduceMotion ? Math.ceil(spec.count / 2) : spec.count;
    return Array.from({ length: n }, () => {
      const s = spec.size[0] + Math.random() * (spec.size[1] - spec.size[0]);
      const el = h('span', { class: `p ${spec.anim}` });
      el.style.setProperty('--x', `${Math.random() * 100}%`);
      el.style.setProperty('--y', `${spec.anim === 'rise' ? 100 + Math.random() * 10 : spec.anim === 'fall' ? -10 : Math.random() * 100}%`);
      el.style.setProperty('--s', `${s.toFixed(1)}px`);
      el.style.setProperty('--d', `${(-Math.random() * 12).toFixed(2)}s`);
      el.style.setProperty('--dur', `${(spec.anim === 'twinkle' ? 2 + Math.random() * 4 : 9 + Math.random() * 10).toFixed(2)}s`);
      return el;
    });
  }
}
