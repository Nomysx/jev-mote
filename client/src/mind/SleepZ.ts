// Little floating "z"s while Mote sleeps.

import type { Anchor } from './ThoughtLayer';

export class SleepZ {
  private timer: number | undefined;
  private on = false;
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(
    private root: HTMLElement,
    private anchor: () => Anchor | null,
  ) {}

  set(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    window.clearInterval(this.timer);
    if (on) {
      this.timer = window.setInterval(() => this.spawn(), this.reduceMotion ? 5200 : 2600);
      this.spawn();
    }
  }

  private spawn() {
    if (document.visibilityState !== 'visible') return;
    const a = this.anchor();
    if (!a) return;
    const z = document.createElement('span');
    z.className = 'sleep-z';
    z.textContent = Math.random() < 0.3 ? 'Z' : 'z';
    z.style.left = `${a.x + a.r * (0.45 + Math.random() * 0.2)}px`;
    z.style.top = `${a.y - a.r * 0.75}px`;
    z.style.fontSize = `${13 + Math.random() * 11}px`;
    z.addEventListener('animationend', () => z.remove());
    this.root.appendChild(z);
  }
}
