// Who Mote becomes. Its temperament (nature) is fixed at birth; its character grows from its life:
// how the writer treats it, what it thinks about on its own, and what it dreams. Character is not
// stored: it is replayed from the journal and the inner-life log, so it is always explainable (every
// change points at the entry, thought or dream that caused it) and works for entries written before
// this existed. Deterministic, like the mood engine.

import { clamp } from '../../shared/math';
import { topKey } from '../../shared/dream';
import {
  TRAITS,
  type CharacterReport,
  type Dream,
  type Emotion,
  type IdleThought,
  type LifeEvent,
  type Milestone,
  type Signals,
  type Temperament,
  type Trait,
  type Traits,
} from '../../shared/types';
import { initialTrust } from '../mood/engine';
import { TUNING } from '../mood/tuning';

const C = TUNING.character;

/** The minimum the replay needs from an entry. */
export interface CharacterEntry {
  id: number;
  createdAt: number;
  text: string;
  signals: Signals | null;
  distress: boolean;
  /** Trust right after this entry (from the mood engine). */
  trustAfter: number | null;
  recalls: number;
  userEmotion: Emotion | 'none' | null;
}

/** Character at birth, from the temperament. */
export function natureOf(t: Temperament): Traits {
  const a = t.archetype;
  const n: Traits = {
    warmth: 0.25 + 0.3 * t.baselineValence + (a === 'cheerful' ? 0.08 : 0),
    trust: initialTrust(t),
    courage: 0.55 - 0.35 * t.volatility + 0.15 * t.recoverySpeed - (a === 'anxious' ? 0.08 : 0),
    wariness: 0.15 + 0.35 * t.grudgeMemory + (a === 'anxious' ? 0.08 : 0),
    curiosity: 0.3 + (a === 'curious' ? 0.28 : 0) + 0.05 * t.volatility,
    playfulness: 0.22 + (a === 'cheerful' ? 0.28 : 0) + 0.1 * t.volatility,
    dreaminess: 0.15 + (a === 'moody' ? 0.15 : 0),
  };
  for (const k of TRAITS) n[k] = clamp(n[k], 0.05, 0.95);
  return n;
}

const grow = (tr: Traits, k: Trait, amount: number) => {
  if (amount > 0) tr[k] = clamp(tr[k] + clamp(amount) * (1 - tr[k]));
};
const shrink = (tr: Traits, k: Trait, amount: number) => {
  if (amount > 0) tr[k] = clamp(tr[k] - clamp(amount) * tr[k]);
};

function drift(tr: Traits, nature: Traits, dtMs: number) {
  if (!(dtMs > 0)) return;
  const k = 1 - Math.pow(0.5, dtMs / C.driftHalfLifeMs);
  for (const t of TRAITS) tr[t] += (nature[t] - tr[t]) * k;
}

const HARD_MOMENTS = ['loss', 'loneliness', 'worry', 'stress', 'self_criticism', 'conflict'] as const;

/** One entry: kindness warms it, hurt makes it wary, questions make it curious, joy makes it playful. */
export function applyEntryToCharacter(tr: Traits, s: Signals) {
  const E = C.entry;
  const kind = s.tone.kind;
  const hurt = clamp(s.tone.hostile + 0.5 * s.tone.dismissive);
  const sit = s.situation ?? ({} as Record<string, number>);
  const p = (k: string) => (sit as Record<string, number>)[k] ?? 0;
  // Sharing something hard with it (not being hurt by it) builds closeness, and a little courage.
  const shared = clamp(HARD_MOMENTS.reduce((sum, k) => sum + p(k), 0)) * (1 - hurt);
  grow(tr, 'warmth', E.warmthKind * kind + E.warmthShared * shared);
  shrink(tr, 'warmth', E.warmthHurt * hurt);
  grow(tr, 'wariness', E.warinessHurt * hurt);
  shrink(tr, 'wariness', E.warinessKind * kind);
  grow(tr, 'curiosity', E.curiosity * clamp(p('question') + (s.userEmotion.curiosity ?? 0) + 0.5 * p('change') + 0.5 * s.blobReaction.curiosity));
  grow(tr, 'playfulness', E.play * clamp(s.blobReaction.joy + p('win') + p('good_news') + 0.5 * p('greeting')));
  shrink(tr, 'playfulness', E.playHurt * hurt);
  grow(tr, 'courage', E.courageShared * shared);
  shrink(tr, 'courage', E.courageFear * s.blobReaction.fear);
}

/** One thought on its own: what it dwells on shapes it, slowly. */
export function applyThoughtToCharacter(tr: Traits, th: Record<IdleThought, number>, chosen: string) {
  const T = C.thought;
  grow(tr, 'warmth', T.warmth * (th.remember_good + th.grateful + 0.5 * th.miss_writer));
  grow(tr, 'curiosity', T.curiosity * (th.curious + th.wonder_day));
  grow(tr, 'dreaminess', T.dreaminess * th.daydream);
  shrink(tr, 'wariness', T.letGo * th.forgiving);
  grow(tr, 'courage', T.letGoCourage * th.forgiving);
  grow(tr, 'wariness', T.dwell * th.still_hurt);
  shrink(tr, 'courage', T.worry * th.worried);
  if (chosen === 'hum' || chosen === 'wander' || chosen === 'glow') grow(tr, 'playfulness', T.play);
}

/** One dream: every dream makes it more of a dreamer; sleeping on a hard day makes it braver. */
export function applyDreamToCharacter(tr: Traits, d: Dream) {
  const D = C.dream;
  grow(tr, 'dreaminess', D.dreaminess + D.vivid * d.vividness);
  if (d.effect === 'processed') {
    grow(tr, 'courage', D.processedCourage);
    shrink(tr, 'wariness', D.processedWariness);
  } else if (d.effect === 'nightmare') {
    shrink(tr, 'courage', D.nightmareCourage);
    grow(tr, 'wariness', D.nightmareWariness);
  } else if (d.effect === 'sweet') {
    grow(tr, 'warmth', D.sweetWarmth);
    grow(tr, 'playfulness', D.sweetPlay);
  }
  grow(tr, 'warmth', D.reunionWarmth * (d.event.reunion ?? 0));
  grow(tr, 'courage', D.flyingCourage * (d.event.flying ?? 0));
}

/** "a warm, playful dreamer who trusts you". */
export function describeCharacter(tr: Traits): string {
  const adj: [number, string][] = [];
  const noun = tr.dreaminess >= 0.55 ? 'dreamer' : tr.curiosity >= 0.62 ? 'explorer' : 'little one';
  if (tr.warmth >= 0.6) adj.push([tr.warmth, 'warm']);
  else if (tr.warmth <= 0.25) adj.push([1 - tr.warmth, 'reserved']);
  if (tr.courage >= 0.62) adj.push([tr.courage, 'brave']);
  else if (tr.courage <= 0.28) adj.push([1 - tr.courage, 'timid']);
  if (tr.wariness >= 0.55) adj.push([tr.wariness, 'wary']);
  if (tr.playfulness >= 0.6) adj.push([tr.playfulness, 'playful']);
  if (tr.curiosity >= 0.6 && noun !== 'explorer') adj.push([tr.curiosity, 'curious']);
  const words = adj
    .sort((a, b) => b[0] - a[0])
    .slice(0, 2)
    .map(([, w]) => w);
  const clause = tr.trust >= 0.65 ? 'who trusts you' : tr.trust >= 0.4 ? 'getting to know you' : 'still unsure of you';
  const phrase = [words.join(', '), noun].filter(Boolean).join(' ');
  return `${/^[aeiou]/.test(phrase) ? 'an' : 'a'} ${phrase} ${clause}`;
}

const BECAME: Partial<Record<Trait, string>> = {
  warmth: 'Grew warm',
  courage: 'Grew brave',
  wariness: 'Grew wary',
  curiosity: 'Grew curious',
  playfulness: 'Grew playful',
  dreaminess: 'Became a dreamer',
};
const TRUST_LABELS = ['Began to trust you', 'Trusts you', 'Trusts you completely'];
const PLACE_WORDS: Record<string, string> = {
  sky: 'in the sky',
  sea: 'in the sea',
  forest: 'in a forest',
  city: 'in a city',
  home: 'at home',
  school: 'at school',
  space: 'in space',
  dark: 'in the dark',
};

const snippet = (text: string, n = 60) => {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

function diff(after: Traits, before: Traits): Partial<Traits> {
  const out: Partial<Traits> = {};
  for (const k of TRAITS) {
    const d = after[k] - before[k];
    if (Math.abs(d) >= 0.002) out[k] = Math.round(d * 1000) / 1000;
  }
  return out;
}

const impactSize = (i: Partial<Traits>) => Object.values(i).reduce((s, v) => s + Math.abs(v ?? 0), 0);

function downsample<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(xs[Math.round((i * (xs.length - 1)) / (max - 1))]);
  return out;
}

export interface CharacterInput {
  temperament: Temperament;
  bornAt: number;
  /** Oldest first. */
  entries: CharacterEntry[];
  /** Oldest first. */
  events: LifeEvent[];
  now: number;
}

/** Replays Mote's life and reports who it became, how, and when. */
export function buildCharacter(i: CharacterInput): CharacterReport {
  const nature = natureOf(i.temperament);
  const tr: Traits = { ...nature };
  type Item = { at: number; entry?: CharacterEntry; event?: LifeEvent };
  const items: Item[] = [...i.entries.map((entry) => ({ at: entry.createdAt, entry })), ...i.events.map((event) => ({ at: event.at, event }))].sort(
    (a, b) => a.at - b.at,
  );
  const timeline: CharacterReport['timeline'] = [{ at: i.bornAt, traits: { ...nature } }];
  const milestones: Milestone[] = [{ at: i.bornAt, kind: 'born', label: `Born a ${i.temperament.archetype} blob` }];
  const once = new Set<string>();
  const mark = (key: string, m: Omit<Milestone, 'kind'>) => {
    if (once.has(key)) return;
    once.add(key);
    milestones.push({ kind: key, ...m });
  };
  const recalls = new Map<number, number>();
  const textOf = new Map(i.entries.map((e) => [e.id, e.text]));
  let cores = 0;
  const recall = (id: number, at: number) => {
    const n = (recalls.get(id) ?? 0) + 1;
    recalls.set(id, n);
    if (n === TUNING.coreMemoryRecalls && cores < 8 && textOf.has(id)) {
      cores++;
      mark(`core:${id}`, { at, label: 'A core memory formed', detail: `“${snippet(textOf.get(id)!)}”`, ref: { type: 'entry', id } });
    }
  };
  const entryImpact = new Map<number, Partial<Traits>>();
  const dreamImpact = new Map<number, Partial<Traits>>();
  const thoughtCounts: CharacterReport['thoughtCounts'] = {};
  let hurtSeen = false;
  let last = i.bornAt;

  for (const it of items) {
    drift(tr, nature, it.at - last);
    last = Math.max(last, it.at);
    const before = { ...tr };
    if (it.entry) {
      const e = it.entry;
      if (e.signals) applyEntryToCharacter(tr, e.signals);
      if (e.trustAfter !== null) tr.trust = clamp(e.trustAfter);
      entryImpact.set(e.id, diff(tr, before));
      mark('first_words', { at: e.createdAt, label: 'First words from you', detail: `“${snippet(e.text)}”`, ref: { type: 'entry', id: e.id } });
      if (e.signals && e.signals.tone.kind > 0.5) mark('first_kindness', { at: e.createdAt, label: 'First kindness', detail: `“${snippet(e.text)}”`, ref: { type: 'entry', id: e.id } });
      if (e.signals && e.signals.tone.hostile + 0.5 * e.signals.tone.dismissive > 0.4) {
        hurtSeen = true;
        mark('first_hurt', { at: e.createdAt, label: 'First time it got hurt', detail: `“${snippet(e.text)}”`, ref: { type: 'entry', id: e.id } });
      }
    } else if (it.event) {
      const ev = it.event;
      if (ev.kind === 'thought') {
        applyThoughtToCharacter(tr, ev.thought, ev.chosen);
        const top = topKey(ev.thought);
        thoughtCounts[top] = (thoughtCounts[top] ?? 0) + 1;
        if (ev.memory) recall(ev.memory.id, ev.at);
        if (hurtSeen && ev.thought.forgiving >= 0.4) mark('forgave', { at: ev.at, label: 'Let go of a hurt', ref: { type: 'event', id: ev.id } });
      } else if (ev.kind === 'dream') {
        applyDreamToCharacter(tr, ev.dream);
        dreamImpact.set(ev.id, diff(tr, before));
        for (const m of ev.dream.memories) recall(m.id, ev.at);
        const what = `${topKey(ev.dream.event)} ${PLACE_WORDS[topKey(ev.dream.place)] ?? ''}`.trim();
        mark('first_dream', { at: ev.at, label: 'First dream', detail: what, ref: { type: 'event', id: ev.id } });
        if (ev.dream.effect === 'nightmare') mark('first_nightmare', { at: ev.at, label: 'First nightmare', detail: what, ref: { type: 'event', id: ev.id } });
        if (ev.dream.effect === 'processed') mark('slept_on_it', { at: ev.at, label: 'Slept on a hard day', detail: what, ref: { type: 'event', id: ev.id } });
      } else if (ev.kind === 'sleep' && ev.cause === 'night') {
        mark('first_night', { at: ev.at, label: 'First night’s sleep', ref: { type: 'event', id: ev.id } });
      }
    }
    C.trustSteps.forEach((step, k) => {
      if (before.trust < step && tr.trust >= step) mark(`trust:${step}`, { at: it.at, label: TRUST_LABELS[k] });
    });
    for (const k of TRAITS) {
      const label = BECAME[k];
      if (label && before[k] < C.strong && tr[k] >= C.strong) mark(`became:${k}`, { at: it.at, label });
    }
    timeline.push({ at: it.at, traits: { ...tr } });
  }
  drift(tr, nature, i.now - last);
  timeline.push({ at: Math.max(i.now, last), traits: { ...tr } });

  // Memory nodes: never distress entries. If there are many, keep core memories, the ones that
  // changed it most, and the most recent.
  let memories = i.entries
    .filter((e) => e.signals && !e.distress && e.text.trim())
    .map((e) => ({
      id: e.id,
      at: e.createdAt,
      text: snippet(e.text, 160),
      emotion: (e.userEmotion ?? 'none') as Emotion | 'none',
      valence: e.signals!.userValence,
      intensity: e.signals!.userIntensity,
      recalls: Math.max(e.recalls, recalls.get(e.id) ?? 0),
      core: Math.max(e.recalls, recalls.get(e.id) ?? 0) >= TUNING.coreMemoryRecalls,
      impact: entryImpact.get(e.id) ?? {},
    }));
  if (memories.length > C.maxMemoryNodes) {
    const keep = new Set<number>();
    memories.filter((m) => m.core).forEach((m) => keep.add(m.id));
    memories.slice(-40).forEach((m) => keep.add(m.id));
    [...memories].sort((a, b) => impactSize(b.impact) - impactSize(a.impact)).forEach((m) => keep.size < C.maxMemoryNodes && keep.add(m.id));
    memories = memories.filter((m) => keep.has(m.id));
  }
  const memoryIds = new Set(memories.map((m) => m.id));
  const dreams = i.events.flatMap((ev) =>
    ev.kind === 'dream'
      ? [
          {
            id: ev.id,
            at: ev.at,
            event: topKey(ev.dream.event),
            place: topKey(ev.dream.place),
            feeling: topKey(ev.dream.feeling),
            effect: ev.dream.effect,
            memoryIds: ev.dream.memories.map((m) => m.id).filter((id) => memoryIds.has(id)),
            impact: dreamImpact.get(ev.id) ?? {},
          },
        ]
      : [],
  );

  return {
    bornAt: i.bornAt,
    archetype: i.temperament.archetype,
    nature,
    traits: { ...tr },
    description: describeCharacter(tr),
    natureDescription: describeCharacter(nature),
    timeline: downsample(timeline, 240),
    milestones: milestones.sort((a, b) => a.at - b.at),
    memories,
    dreams: dreams.slice(-80),
    thoughtCounts,
  };
}
