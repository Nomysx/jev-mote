// "Growth": a living map of who Mote is becoming. Mote sits in the middle; its character traits sit
// around it, sized by how strong they are; your entries are memories, pulled toward the traits they
// shaped; dreams hang off the memories they grew from; core memories (the ones it keeps coming
// back to) are tied to Mote itself. Scrub or play the timeline to watch the character grow from
// birth to now. Everything is computed from your own journal on this computer.

import { TRAITS, type CharacterReport, type Emotion, type IdleThought, type Trait, type Traits } from '../../../shared/types';
import { VISUAL_TUNING } from '../../../shared/visuals';
import { api } from '../api';
import { DREAM_TITLES, PLACE_WORDS } from '../mind/dreamLines';
import { DREAM_EFFECT_WORDS } from '../mind/lifeText';
import { clear, h } from './dom';

const TRAIT_LABEL: Record<Trait, string> = {
  warmth: 'Warmth',
  trust: 'Trust',
  courage: 'Courage',
  wariness: 'Wariness',
  curiosity: 'Curiosity',
  playfulness: 'Playfulness',
  dreaminess: 'Dreaminess',
};

const TRAIT_HELP: Record<Trait, string> = {
  warmth: 'Grows with kindness and with the things you share with it.',
  trust: 'How much it trusts you (from the mood engine).',
  courage: 'Grows when it sleeps on hard days and lets go of hurts; nightmares shake it.',
  wariness: 'Grows when it is hurt or brushed off; kindness and letting go ease it.',
  curiosity: 'Grows with your questions, big changes and its curious thoughts.',
  playfulness: 'Grows with joy, good news and wins.',
  dreaminess: 'Grows with every dream and daydream.',
};

const TRAIT_HUE: Record<Trait, number> = { warmth: 24, trust: 45, courage: 4, wariness: 265, curiosity: 140, playfulness: 320, dreaminess: 228 };

const THOUGHT_WORDS: Record<IdleThought, string> = {
  remember_good: 'happy memories',
  remember_hard: 'hard memories',
  miss_writer: 'missing you',
  wonder_day: 'your day',
  worried: 'worrying about you',
  grateful: 'being glad you’re here',
  still_hurt: 'old hurts',
  forgiving: 'letting go',
  sleepy: 'being sleepy',
  bored: 'being bored',
  content: 'just being content',
  curious: 'new things',
  daydream: 'daydreams',
};

const emotionHue = (e: Emotion | 'none') => (e === 'none' ? 0 : VISUAL_TUNING.emotionHue[e] * 360);
const pctPts = (d: number) => `${d > 0 ? '+' : '−'}${Math.abs(Math.round(d * 100))}`;
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

interface GNode {
  kind: 'mote' | 'trait' | 'memory' | 'dream';
  at: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  r: number;
  hue: number;
  shown: number;
  trait?: Trait;
  memory?: CharacterReport['memories'][number];
  dream?: CharacterReport['dreams'][number];
}

export interface MindMapDeps {
  /** Mote's own hue (0..1), for the center node. */
  hue: () => number;
  serverNow: () => number;
}

export function createMindMap(el: HTMLElement, deps: MindMapDeps) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = h('canvas', { class: 'mm-canvas', 'aria-label': 'Map of Mote’s character, memories and dreams' });
  const tip = h('div', { class: 'mm-tip', hidden: true });
  const who = h('p', { class: 'mm-who' });
  const born = h('p', { class: 'faint' });
  const traitsEl = h('div', { class: 'mm-traits' });
  const milestonesEl = h('div', { class: 'mm-milestones', role: 'list' });
  const mindEl = h('p', { class: 'muted' });
  const slider = h('input', { type: 'range', min: 0, max: 1000, step: 1, value: 1000, 'aria-label': 'Time in Mote’s life' }) as HTMLInputElement;
  const dateEl = h('span', { class: 'mm-date' });
  const ticks = h('div', { class: 'mm-ticks', 'aria-hidden': 'true' });
  const playBtn = h('button', { class: 'btn', type: 'button', 'aria-label': 'Play its life' }, '▶ Play its life');
  const empty = h('p', { class: 'mm-empty', hidden: true }, 'Mote is brand new. Write to it, let it sleep and dream, and you will see its character grow here.');

  el.append(
    h('button', { class: 'close-btn', type: 'button', 'aria-label': 'Close', onclick: () => toggle(false) }, '×'),
    h('header', { class: 'mm-head' }, h('h2', {}, 'How Mote is growing'), who, born),
    h(
      'div',
      { class: 'mm-body' },
      h('div', { class: 'mm-graph' }, canvas, tip, empty, h(
          'div',
          { class: 'mm-legend' },
          h('span', {}, h('i', { class: 'lg memory' }), 'Memories: your entries, colored by feeling'),
          h('span', {}, h('i', { class: 'lg dream' }), 'Dreams'),
          h('span', {}, h('i', { class: 'lg core' }), 'Core memories'),
          h('span', {}, h('i', { class: 'lg line' }), 'What shaped each trait'),
        )),
      h('div', { class: 'mm-side' }, h('h3', {}, 'Character'), traitsEl, h('h3', {}, 'Milestones'), milestonesEl, h('h3', {}, 'What it thinks about on its own'), mindEl),
    ),
    h('div', { class: 'mm-timeline' }, playBtn, h('div', { class: 'mm-track' }, ticks, slider), dateEl),
  );

  let report: CharacterReport | null = null;
  let nodes: GNode[] = [];
  let traitNodes: Partial<Record<Trait, GNode>> = {};
  let mote: GNode | null = null;
  let T = 0; // the time being shown
  let raf = 0;
  let playing: { from: number; start: number; dur: number } | null = null;
  let hover: GNode | null = null;
  let pinned: GNode | null = null;
  let W = 0;
  let H = 0;
  let last = performance.now();
  const span = () => (report ? Math.max(1, Math.max(report.timeline[report.timeline.length - 1].at, deps.serverNow()) - report.bornAt) : 1);
  const end = () => (report ? report.bornAt + span() : 0);

  /** Trait values at time t (interpolated along the timeline). */
  function traitsAt(t: number): Traits {
    const tl = report!.timeline;
    if (t <= tl[0].at) return tl[0].traits;
    for (let i = 1; i < tl.length; i++) {
      if (tl[i].at >= t) {
        const a = tl[i - 1];
        const b = tl[i];
        const k = b.at === a.at ? 1 : (t - a.at) / (b.at - a.at);
        const out = {} as Traits;
        for (const tr of TRAITS) out[tr] = a.traits[tr] + (b.traits[tr] - a.traits[tr]) * k;
        return out;
      }
    }
    return tl[tl.length - 1].traits;
  }

  function layout() {
    const rect = canvas.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!report) return;
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) * 0.36;
    if (mote) Object.assign(mote, { x: cx, y: cy, ax: cx, ay: cy });
    TRAITS.forEach((tr, k) => {
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / TRAITS.length;
      const n = traitNodes[tr]!;
      n.x = n.ax = cx + Math.cos(a) * R;
      n.y = n.ay = cy + Math.sin(a) * R;
    });
    const golden = 2.39996;
    const anchorOf = (impact: Partial<Traits>, id: number) => {
      let sx = 0;
      let sy = 0;
      let sw = 0;
      for (const [tr, d] of Object.entries(impact) as [Trait, number][]) {
        const n = traitNodes[tr]!;
        const w = Math.abs(d);
        sx += n.ax * w;
        sy += n.ay * w;
        sw += w;
      }
      const ang = id * golden;
      if (sw === 0) return { x: cx + Math.cos(ang) * R * 0.42, y: cy + Math.sin(ang) * R * 0.42 };
      const px = cx + (sx / sw - cx) * 0.72;
      const py = cy + (sy / sw - cy) * 0.72;
      return { x: px + Math.cos(ang) * 16, y: py + Math.sin(ang) * 16 };
    };
    const memPos = new Map<number, { x: number; y: number }>();
    for (const n of nodes) {
      if (n.memory) {
        const p = anchorOf(n.memory.impact, n.memory.id);
        n.ax = p.x;
        n.ay = p.y;
        memPos.set(n.memory.id, p);
      }
    }
    const dreamy = traitNodes.dreaminess!;
    for (const n of nodes) {
      if (!n.dream) continue;
      const ms = n.dream.memoryIds.map((id) => memPos.get(id)).filter(Boolean) as { x: number; y: number }[];
      const bx = ms.length ? ms.reduce((s, p) => s + p.x, 0) / ms.length : cx;
      const by = ms.length ? ms.reduce((s, p) => s + p.y, 0) / ms.length : cy;
      const ang = n.dream.id * golden;
      n.ax = bx + (dreamy.ax - bx) * 0.45 + Math.cos(ang) * 14;
      n.ay = by + (dreamy.ay - by) * 0.45 + Math.sin(ang) * 14;
    }
    for (const n of nodes) {
      if (n.kind === 'memory' || n.kind === 'dream') {
        n.x = n.ax;
        n.y = n.ay;
      }
    }
    for (let i = 0; i < 220; i++) step(1);
  }

  function build(r: CharacterReport) {
    report = r;
    nodes = [];
    traitNodes = {};
    mote = { kind: 'mote', at: r.bornAt, x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, r: 24, hue: deps.hue() * 360, shown: 1 };
    nodes.push(mote);
    for (const tr of TRAITS) {
      const n: GNode = { kind: 'trait', at: r.bornAt, x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, r: 14, hue: TRAIT_HUE[tr], shown: 1, trait: tr };
      traitNodes[tr] = n;
      nodes.push(n);
    }
    for (const m of r.memories) {
      nodes.push({ kind: 'memory', at: m.at, x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, r: 2.5 + 4 * m.intensity + (m.core ? 2.5 : 0), hue: emotionHue(m.emotion), shown: 0, memory: m });
    }
    for (const d of r.dreams) {
      nodes.push({ kind: 'dream', at: d.at, x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, r: 6, hue: VISUAL_TUNING.emotionHue[d.feeling] * 360, shown: 0, dream: d });
    }
    who.textContent = r.description.charAt(0).toUpperCase() + r.description.slice(1);
    const days = Math.max(0, Math.floor((deps.serverNow() - r.bornAt) / 86_400_000));
    born.textContent = `Born a ${r.archetype} blob ${days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}. At birth: ${r.natureDescription}.`;
    empty.hidden = r.memories.length + r.dreams.length > 0;
    renderMilestones();
    renderMind();
    renderTicks();
    setT(end(), false);
    layout();
  }

  /** One step of the gentle force layout: each node is pulled to its anchor and kept from overlapping. */
  function step(k: number) {
    const movable = nodes.filter((n) => n.kind === 'memory' || n.kind === 'dream');
    for (const n of movable) {
      n.vx += (n.ax - n.x) * 0.02 * k;
      n.vy += (n.ay - n.y) * 0.02 * k;
    }
    for (let i = 0; i < movable.length; i++) {
      const a = movable[i];
      for (let j = i + 1; j < movable.length; j++) {
        const b = movable[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.r + b.r + 5;
        const d2 = dx * dx + dy * dy;
        if (d2 < min * min && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / d) * 0.25 * k;
          a.vx -= dx * push;
          a.vy -= dy * push;
          b.vx += dx * push;
          b.vy += dy * push;
        }
      }
      for (const f of [mote!, ...Object.values(traitNodes)]) {
        if (!f) continue;
        const dx = a.x - f.x;
        const dy = a.y - f.y;
        const min = f.r + 26 + a.r;
        const d2 = dx * dx + dy * dy;
        if (d2 < min * min && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / d) * 0.2 * k;
          a.vx += dx * push;
          a.vy += dy * push;
        }
      }
    }
    for (const n of movable) {
      n.vx *= 0.8;
      n.vy *= 0.8;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  const visible = (n: GNode) => n.kind === 'mote' || n.kind === 'trait' || n.at <= T;

  function draw(now: number) {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    if (!report || !mote) return;
    const tr = traitsAt(T);
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const ink = dark ? '255,255,255' : '40,30,60';
    const focus = pinned ?? hover;
    const byMemory = new Map<number, GNode>();
    for (const n of nodes) if (n.memory) byMemory.set(n.memory.id, n);

    // Spokes: Mote to each trait, thicker as the trait grows.
    for (const t of TRAITS) {
      const n = traitNodes[t]!;
      const v = tr[t];
      ctx.strokeStyle = `hsla(${n.hue}, 70%, 60%, ${0.15 + 0.45 * v})`;
      ctx.lineWidth = 1 + 7 * v;
      ctx.beginPath();
      ctx.moveTo(mote.x, mote.y);
      ctx.lineTo(n.x, n.y);
      ctx.stroke();
    }
    // What shaped each trait: memory -> trait lines (brighter for the focused node).
    for (const n of nodes) {
      if (!n.memory || !visible(n) || n.shown < 0.05) continue;
      for (const [t, d] of Object.entries(n.memory.impact) as [Trait, number][]) {
        if (Math.abs(d) < 0.008) continue;
        const target = traitNodes[t]!;
        const on = focus === n || focus === target;
        ctx.strokeStyle = `hsla(${target.hue}, 70%, 60%, ${(on ? 0.75 : 0.1) * n.shown})`;
        ctx.lineWidth = on ? 1.6 : 0.7;
        ctx.setLineDash(d < 0 ? [3, 3] : []);
        ctx.beginPath();
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    // Core memories: tied to Mote, thicker the more often it comes back to them.
    for (const n of nodes) {
      if (!n.memory?.core || !visible(n)) continue;
      ctx.strokeStyle = `rgba(255, 205, 120, ${0.35 * n.shown})`;
      ctx.lineWidth = 0.6 + Math.min(4, n.memory.recalls * 0.45);
      ctx.beginPath();
      ctx.moveTo(n.x, n.y);
      ctx.quadraticCurveTo((n.x + mote.x) / 2 + 20, (n.y + mote.y) / 2 - 20, mote.x, mote.y);
      ctx.stroke();
    }
    // Dreams grew out of memories.
    ctx.setLineDash([2, 4]);
    for (const n of nodes) {
      if (!n.dream || !visible(n)) continue;
      for (const id of n.dream.memoryIds) {
        const m = byMemory.get(id);
        if (!m || !visible(m)) continue;
        ctx.strokeStyle = `hsla(${n.hue}, 60%, 70%, ${(focus === n || focus === m ? 0.9 : 0.35) * n.shown})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(m.x, m.y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // Memories.
    for (const n of nodes) {
      if (!n.memory || !visible(n) || n.shown <= 0) continue;
      const r = n.r * (0.4 + 0.6 * n.shown);
      const sat = n.memory.emotion === 'none' ? 0 : 60;
      ctx.fillStyle = `hsla(${n.hue}, ${sat}%, ${dark ? 64 : 52}%, ${0.85 * n.shown})`;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (n.memory.core) {
        ctx.strokeStyle = `rgba(255, 205, 120, ${0.9 * n.shown})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (focus === n) ring(ctx, n.x, n.y, r + 6, ink);
    }
    // Dreams: little four-pointed stars that twinkle.
    for (const n of nodes) {
      if (!n.dream || !visible(n) || n.shown <= 0) continue;
      const tw = reduceMotion ? 1 : 0.75 + 0.25 * Math.sin(now / 420 + n.dream.id);
      star(ctx, n.x, n.y, n.r * (0.5 + 0.5 * n.shown) * tw, `hsla(${n.hue}, 70%, ${dark ? 75 : 55}%, ${n.shown})`);
      if (focus === n) ring(ctx, n.x, n.y, n.r + 7, ink);
    }
    // Traits.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of TRAITS) {
      const n = traitNodes[t]!;
      const v = tr[t];
      n.r = 8 + 20 * v;
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
      g.addColorStop(0, `hsla(${n.hue}, 80%, ${dark ? 70 : 62}%, 0.95)`);
      g.addColorStop(1, `hsla(${n.hue}, 70%, ${dark ? 48 : 50}%, 0.75)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
      // Its nature (at birth) as a faint ring, so growth is visible.
      ctx.strokeStyle = `rgba(${ink}, 0.35)`;
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 8 + 20 * report.nature[t], 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (focus === n) ring(ctx, n.x, n.y, n.r + 5, ink);
      ctx.fillStyle = `rgba(${ink}, 0.9)`;
      ctx.font = '600 12px Nunito, system-ui, sans-serif';
      ctx.fillText(TRAIT_LABEL[t], n.x, n.y + n.r + 5);
      ctx.fillStyle = `rgba(${ink}, 0.55)`;
      ctx.font = '11px Nunito, system-ui, sans-serif';
      ctx.fillText(`${Math.round(v * 100)}`, n.x, n.y + n.r + 20);
    }
    // Mote.
    const breathe = reduceMotion ? 0 : Math.sin(now / 900) * 2;
    const mr = mote.r + breathe;
    const g = ctx.createRadialGradient(mote.x - mr * 0.3, mote.y - mr * 0.3, 1, mote.x, mote.y, mr);
    g.addColorStop(0, `hsla(${mote.hue}, 70%, 80%, 1)`);
    g.addColorStop(1, `hsla(${mote.hue}, 60%, 52%, 1)`);
    ctx.shadowColor = `hsla(${mote.hue}, 80%, 65%, 0.8)`;
    ctx.shadowBlur = 24;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mote.x, mote.y, mr, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (focus === mote) ring(ctx, mote.x, mote.y, mr + 6, ink);
  }

  function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ink: string) {
    ctx.strokeStyle = `rgba(${ink}, 0.85)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const rr = i % 2 === 0 ? r * 1.6 : r * 0.45;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      const k = Math.min(1, (now - playing.start) / playing.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      setT(playing.from + (end() - playing.from) * e, false);
      if (k >= 1) stopPlaying();
    }
    for (const n of nodes) {
      const target = visible(n) ? 1 : 0;
      n.shown += (target - n.shown) * (target > n.shown ? 1 - Math.exp(-dt / 0.18) : 1);
    }
    if (!reduceMotion) step(0.25);
    draw(now);
  }

  function setT(t: number, fromSlider: boolean) {
    if (!report) return;
    T = Math.max(report.bornAt, Math.min(end(), t));
    if (!fromSlider) slider.value = String(Math.round(((T - report.bornAt) / span()) * 1000));
    const d = Math.floor((T - report.bornAt) / 86_400_000);
    dateEl.textContent = T >= end() - 60_000 ? 'Now' : `Day ${d + 1}, ${day(T)}`;
    updateSide();
  }

  function updateSide() {
    if (!report) return;
    const tr = traitsAt(T);
    clear(traitsEl);
    for (const t of TRAITS) {
      const v = tr[t];
      const delta = v - report.nature[t];
      const spark = h('canvas', { class: 'mm-spark', width: 120, height: 26, 'aria-hidden': 'true' }) as HTMLCanvasElement;
      drawSpark(spark, t);
      traitsEl.append(
        h(
          'div',
          { class: 'mm-trait', title: TRAIT_HELP[t] },
          h('span', { class: 'mm-dot', style: `background:hsl(${TRAIT_HUE[t]} 70% 58%)` }),
          h('span', { class: 'name' }, TRAIT_LABEL[t]),
          spark,
          h('span', { class: 'val' }, `${Math.round(v * 100)}`),
          h('span', { class: `delta ${delta >= 0 ? 'up' : 'down'}` }, Math.abs(delta) >= 0.005 ? pctPts(delta) : ''),
        ),
      );
    }
    milestonesEl.querySelectorAll('.ms').forEach((li) => li.classList.toggle('future', Number((li as HTMLElement).dataset.at) > T));
  }

  function drawSpark(c: HTMLCanvasElement, t: Trait) {
    const ctx = c.getContext('2d')!;
    const tl = report!.timeline;
    const s = span();
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = `hsl(${TRAIT_HUE[t]} 70% 60%)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    tl.forEach((p, i) => {
      const x = ((p.at - report!.bornAt) / s) * (c.width - 2) + 1;
      const y = c.height - 2 - p.traits[t] * (c.height - 4);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    const mx = ((T - report!.bornAt) / s) * (c.width - 2) + 1;
    ctx.fillStyle = 'rgba(160,150,180,0.6)';
    ctx.fillRect(mx, 0, 1, c.height);
  }

  function renderMilestones() {
    clear(milestonesEl);
    for (const m of report!.milestones) {
      milestonesEl.append(
        h(
          'div',
          { class: 'ms', role: 'listitem', 'data-at': m.at, tabindex: 0, title: 'Show Mote at this moment', onclick: () => jump(m.at), onkeydown: (e: Event) => (e as KeyboardEvent).key === 'Enter' && jump(m.at) },
          h('span', { class: 'when' }, day(m.at)),
          h('b', {}, m.label),
          m.detail ? h('span', { class: 'muted' }, ` ${m.detail}`) : null,
        ),
      );
    }
  }

  function renderTicks() {
    clear(ticks);
    const s = span();
    for (const m of report!.milestones) {
      const tick = h('span', { title: m.label });
      tick.style.left = `${((m.at - report!.bornAt) / s) * 100}%`;
      ticks.append(tick);
    }
  }

  function renderMind() {
    const counts = Object.entries(report!.thoughtCounts) as [IdleThought, number][];
    if (!counts.length) {
      mindEl.textContent = 'Nothing yet. It thinks on its own while you’re away.';
      return;
    }
    mindEl.textContent = counts
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, n]) => `${THOUGHT_WORDS[k]} ×${n}`)
      .join(', ');
  }

  function jump(t: number) {
    stopPlaying();
    setT(t, false);
  }

  function stopPlaying() {
    playing = null;
    playBtn.textContent = '▶ Play its life';
  }

  playBtn.addEventListener('click', () => {
    if (!report) return;
    if (playing) return stopPlaying();
    const from = T >= end() - 60_000 ? report.bornAt : T;
    setT(from, false);
    playing = { from, start: performance.now(), dur: Math.max(8000, Math.min(20000, (report.memories.length + report.dreams.length) * 150)) };
    playBtn.textContent = '❚❚ Pause';
  });
  slider.addEventListener('input', () => {
    stopPlaying();
    if (report) setT(report.bornAt + (Number(slider.value) / 1000) * span(), true);
  });

  function pick(x: number, y: number): GNode | null {
    let best: GNode | null = null;
    let bestD = Infinity;
    for (const n of nodes) {
      if (!visible(n) || n.shown < 0.3) continue;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d <= n.r + 6 && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  function showTip(n: GNode | null, x: number, y: number) {
    if (!n || !report) {
      tip.hidden = true;
      return;
    }
    clear(tip);
    if (n.kind === 'mote') {
      tip.append(h('b', {}, 'Mote'), h('div', {}, report.description), h('div', { class: 'faint' }, `born a ${report.archetype} blob`));
    } else if (n.trait) {
      const v = traitsAt(T)[n.trait];
      tip.append(
        h('b', {}, `${TRAIT_LABEL[n.trait]} ${Math.round(v * 100)}`),
        h('div', { class: 'faint' }, `At birth ${Math.round(report.nature[n.trait] * 100)}, ${pctPts(v - report.nature[n.trait])} since`),
        h('div', {}, TRAIT_HELP[n.trait]),
      );
    } else if (n.memory) {
      const m = n.memory;
      const changes = (Object.entries(m.impact) as [Trait, number][])
        .filter(([, d]) => Math.abs(d) >= 0.005)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .map(([t, d]) => `${TRAIT_LABEL[t].toLowerCase()} ${pctPts(d)}`)
        .join(', ');
      tip.append(h('div', { class: 'faint' }, when(m.at)), h('div', { class: 'mm-quote' }, `“${m.text}”`));
      if (changes) tip.append(h('div', {}, `shaped: ${changes}`));
      if (m.recalls) tip.append(h('div', { class: 'faint' }, `remembered ${m.recalls} time${m.recalls === 1 ? '' : 's'}${m.core ? ', a core memory' : ''}`));
    } else if (n.dream) {
      const d = n.dream;
      const effect = DREAM_EFFECT_WORDS[d.effect];
      tip.append(
        h('div', { class: 'faint' }, when(d.at)),
        h('b', {}, `${DREAM_TITLES[d.event]} ${PLACE_WORDS[d.place]}`),
        h('div', {}, `Felt like ${d.feeling}${effect ? `, ${effect}` : ''}`),
      );
    }
    tip.hidden = false;
    const box = canvas.getBoundingClientRect();
    tip.style.left = `${Math.min(box.width - 250, Math.max(8, x + 14))}px`;
    tip.style.top = `${Math.min(box.height - tip.offsetHeight - 8, Math.max(8, y + 14))}px`;
  }

  canvas.addEventListener('pointermove', (e) => {
    if (pinned) return;
    const b = canvas.getBoundingClientRect();
    hover = pick(e.clientX - b.left, e.clientY - b.top);
    canvas.style.cursor = hover ? 'pointer' : '';
    showTip(hover, e.clientX - b.left, e.clientY - b.top);
  });
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    if (!pinned) tip.hidden = true;
  });
  canvas.addEventListener('click', (e) => {
    const b = canvas.getBoundingClientRect();
    const n = pick(e.clientX - b.left, e.clientY - b.top);
    pinned = n && n !== pinned ? n : null;
    showTip(pinned ?? n, e.clientX - b.left, e.clientY - b.top);
  });

  new ResizeObserver(() => {
    if (!el.hidden) layout();
  }).observe(canvas);

  async function load() {
    try {
      build(await api.character());
    } catch (err) {
      who.textContent = `Couldn’t load Mote’s story: ${(err as Error).message}`;
    }
  }

  function toggle(open?: boolean) {
    const show = open ?? el.hidden;
    el.hidden = !show;
    document.getElementById('btn-growth')?.setAttribute('aria-pressed', String(show));
    cancelAnimationFrame(raf);
    stopPlaying();
    if (show) {
      last = performance.now();
      void load().then(() => {
        layout();
        raf = requestAnimationFrame(frame);
      });
    } else {
      pinned = null;
      tip.hidden = true;
    }
  }

  return { toggle, isOpen: () => !el.hidden };
}
