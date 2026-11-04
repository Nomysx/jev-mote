// Mote's visible mind. Candidate thoughts float around it, sized by their real probability from the
// decision model; they drift while it "thinks", the strongest one wins, and (after an entry) a ring of
// possible actions appears and one is chosen. Split or flat distributions look undecided.

export interface Anchor {
  x: number;
  y: number;
  /** On-screen radius of the blob in px. */
  r: number;
}

export interface Candidate {
  text: string;
  /** Probability from the model, 0..1. */
  p: number;
  /** Shown on hover. */
  detail?: string;
}

export interface MindPlay {
  thoughts: Candidate[];
  /** The model's confidence for the whole distribution (0..1). Low = undecided. */
  confidence: number;
  /** Possible actions; the most likely one is chosen. */
  decision?: { options: Candidate[]; confidence: number };
  /** A remembered entry, quoted under the winning thought. */
  quote?: string;
  /** Smaller and quieter for background thoughts. */
  quiet?: boolean;
  /** Called when the winning thought settles. */
  onSettle?: () => void;
  /** Called when the action is chosen (index into decision.options). */
  onDecide?: (index: number) => void;
}

interface Item {
  el: HTMLElement;
  angle: number;
  radius: number;
  tAngle: number;
  tRadius: number;
  opacity: number;
  tOpacity: number;
  scale: number;
  tScale: number;
  phase: number;
  jitter: number;
  /** Smoothed nudge that keeps it from overlapping other thoughts. */
  nx: number;
  ny: number;
}

const DEG = Math.PI / 180;

export class ThoughtLayer {
  enabled = true;
  private items: Item[] = [];
  private timers: number[] = [];
  private raf = 0;
  private last = performance.now();
  private live: HTMLElement;
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private finish: (() => void) | null = null;

  constructor(private root: HTMLElement, private anchor: () => Anchor | null) {
    this.live = document.createElement('div');
    this.live.className = 'sr-only';
    this.live.setAttribute('role', 'status');
    document.body.appendChild(this.live);
  }

  get busy() {
    return this.items.length > 0;
  }

  cancel() {
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
    for (const it of this.items) it.el.remove();
    this.items = [];
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.finish?.();
    this.finish = null;
  }

  /** Plays one moment of thinking. Resolves when it has faded out. */
  play(m: MindPlay): Promise<void> {
    this.cancel();
    if (!this.enabled || m.thoughts.length === 0) {
      m.onSettle?.();
      if (m.decision?.options.length) m.onDecide?.(0);
      return Promise.resolve();
    }
    const quiet = !!m.quiet;
    const pMax = Math.max(...m.thoughts.map((t) => t.p), 0.001);
    const unsure = m.confidence < 0.35;
    const n = m.thoughts.length;

    // 1. Candidates appear on an arc above the blob, sized by probability.
    const at = (ms: number, fn: () => void) => this.timers.push(window.setTimeout(fn, this.reduceMotion ? ms * 0.7 : ms));
    const thoughtItems = m.thoughts.map((c, i) => {
      const rel = c.p / pMax;
      const angle = (n === 1 ? 270 : 200 + (140 * i) / (n - 1)) * DEG + (i % 2 ? 0.08 : -0.08);
      const it = this.add(c, 'thought', angle, 1.3 + (i % 2) * 0.18, rel, quiet);
      it.tScale = (quiet ? 0.8 : 0.85) + 0.55 * rel;
      it.jitter = unsure ? 1 : 1 - rel;
      // Thoughts surface one after another, likeliest first.
      at(i * 110, () => (it.tOpacity = (quiet ? 0.25 : 0.35) + 0.6 * rel));
      return it;
    });
    // DOM order: the winner (index 0) on top.
    thoughtItems.slice().reverse().forEach((it) => this.root.appendChild(it.el));
    const settleAt = quiet ? 1300 : 1500;

    // 2. The strongest thought wins and comes forward; the rest fade. Undecided: a rival lingers.
    at(settleAt, () => {
      thoughtItems.forEach((it, i) => {
        if (i === 0) {
          it.tAngle = 270 * DEG;
          it.tRadius = quiet ? 1.25 : 1.32;
          it.tOpacity = unsure ? 0.7 : 1;
          it.tScale = quiet ? 1.05 : 1.3;
          it.jitter = unsure ? 0.9 : 0.05;
          it.el.classList.add('won');
        } else if (i === 1 && unsure) {
          it.tAngle = 222 * DEG;
          it.tRadius = 1.65;
          it.tOpacity = 0.38;
          it.jitter = 1;
        } else {
          it.tOpacity = 0;
          it.tScale *= 0.8;
        }
      });
      if (m.quote) {
        const q = this.add({ text: `“${m.quote}”`, p: 1 }, 'quote', 270 * DEG, quiet ? 1.25 : 1.32, 1, true);
        q.tOpacity = 0.8;
        q.tScale = 1;
        q.jitter = 0.05;
        q.el.dataset.below = '1';
      }
      m.onSettle?.();
    });

    // 3. A ring of possible actions; one is chosen.
    const d = m.decision;
    if (d && d.options.length) {
      const dMax = Math.max(...d.options.map((o) => o.p), 0.001);
      const k = d.options.length;
      let options: Item[] = [];
      at(settleAt + 600, () => {
        options = d.options.map((o, i) => {
          const rel = o.p / dMax;
          const angle = (k === 1 ? 90 : 35 + (110 * i) / (k - 1)) * DEG;
          const it = this.add(o, 'choice', angle, 1.35, rel, quiet);
          it.opacity = 0;
          it.tOpacity = 0.4 + 0.5 * rel;
          it.tScale = 0.85 + 0.3 * rel;
          it.jitter = d.confidence < 0.35 ? 0.8 : 0.2;
          return it;
        });
      });
      at(settleAt + 1400, () => {
        options.forEach((it, i) => {
          if (i === 0) {
            it.el.classList.add('chosen');
            it.tScale = 1.25;
            it.tOpacity = 1;
            it.tAngle = 90 * DEG;
            it.tRadius = 1.3;
            it.jitter = 0;
          } else {
            it.tOpacity = 0;
          }
        });
        m.onDecide?.(0);
      });
    }

    const winner = m.thoughts[0].text;
    const chosen = d?.options[0]?.text;
    this.live.textContent = chosen ? `Mote thought: ${winner}. It decided to ${chosen}.` : `Mote thought: ${winner}.`;

    // 4. Everything fades out.
    const fadeAt = quiet ? 5200 : d ? 5600 : 4800;
    at(fadeAt, () => this.items.forEach((it) => (it.tOpacity = 0)));
    const done = new Promise<void>((resolve) => (this.finish = resolve));
    at(fadeAt + 900, () => this.cancel());

    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    return done;
  }

  private add(c: Candidate, kind: 'thought' | 'choice' | 'quote', angle: number, radius: number, rel: number, quiet: boolean): Item {
    const el = document.createElement('div');
    el.className = `mind-${kind}${quiet ? ' quiet' : ''}`;
    el.textContent = c.text;
    if (c.detail) el.title = c.detail;
    el.style.opacity = '0';
    this.root.appendChild(el);
    const it: Item = {
      el,
      angle,
      radius: radius * 0.75,
      tAngle: angle,
      tRadius: radius,
      opacity: 0,
      tOpacity: 0,
      scale: 0.6,
      tScale: 0.85 + 0.4 * rel,
      phase: Math.random() * Math.PI * 2,
      jitter: 0.3,
      nx: 0,
      ny: 0,
    };
    this.items.push(it);
    return it;
  }

  private frame = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const a = this.anchor();
    if (a) {
      const k = 1 - Math.exp(-dt / 0.28);
      const kFade = 1 - Math.exp(-dt / 0.35);
      const W = window.innerWidth;
      const H = window.innerHeight;
      // 1. Where each thought wants to be.
      const pos: { it: Item; x: number; y: number; w: number; h: number }[] = [];
      for (const it of this.items) {
        it.angle += (it.tAngle - it.angle) * k;
        it.radius += (it.tRadius - it.radius) * k;
        it.opacity += (it.tOpacity - it.opacity) * kFade;
        it.scale += (it.tScale - it.scale) * k;
        it.phase += dt * (0.8 + 2.2 * it.jitter);
        const drift = this.reduceMotion ? 0.2 : 1;
        const wobble = (0.05 + 0.12 * it.jitter) * drift;
        const ang = it.angle + Math.sin(it.phase) * wobble;
        const rr = it.radius * a.r + Math.sin(it.phase * 1.3) * 4 * drift;
        const x = a.x + Math.cos(ang) * rr * 1.15;
        let y = a.y + Math.sin(ang) * rr;
        if (it.el.dataset.below) y += 28 + 12 * it.scale;
        pos.push({ it, x, y, w: it.el.offsetWidth * it.scale + 14, h: it.el.offsetHeight * it.scale + 6 });
      }
      // 2. Visible thoughts push each other apart (eased, so nothing jumps).
      const want = pos.map(() => ({ x: 0, y: 0 }));
      for (let i = 0; i < pos.length; i++) {
        for (let j = i + 1; j < pos.length; j++) {
          const A = pos[i];
          const B = pos[j];
          if (A.it.tOpacity < 0.05 || B.it.tOpacity < 0.05) continue;
          const ox = (A.w + B.w) / 2 - Math.abs(A.x + A.it.nx - (B.x + B.it.nx));
          const oy = (A.h + B.h) / 2 - Math.abs(A.y + A.it.ny - (B.y + B.it.ny));
          if (ox > 0 && oy > 0) {
            // Separate along the smaller overlap; the less likely thought moves more.
            const dirY = A.y + A.it.ny <= B.y + B.it.ny ? -1 : 1;
            const dirX = A.x + A.it.nx <= B.x + B.it.nx ? -1 : 1;
            if (oy < ox) {
              want[i].y += dirY * oy * 0.35;
              want[j].y -= dirY * oy * 0.65;
            } else {
              want[i].x += dirX * ox * 0.35;
              want[j].x -= dirX * ox * 0.65;
            }
          }
        }
      }
      // 3. Apply, keeping everything on screen and clear of the top bar and text box.
      const kn = 1 - Math.exp(-dt / 0.2);
      pos.forEach((p, i) => {
        const it = p.it;
        it.nx += (it.nx + want[i].x - it.nx) * kn;
        it.ny += (it.ny + want[i].y - it.ny) * kn;
        const halfW = p.w / 2 + 6;
        const x = Math.min(W - halfW, Math.max(halfW, p.x + it.nx));
        const y = Math.min(H - 150, Math.max(70, p.y + it.ny));
        const flicker = 1 - 0.25 * it.jitter * (0.5 + 0.5 * Math.sin(it.phase * 2.7));
        it.el.style.opacity = String(Math.max(0, Math.min(1, it.opacity * flicker)));
        it.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${it.scale.toFixed(3)})`;
        it.el.style.filter = it.jitter > 0.6 ? `blur(${(0.8 * it.jitter).toFixed(2)}px)` : '';
      });
    }
    this.raf = requestAnimationFrame(this.frame);
  };
}
