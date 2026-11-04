// How Mote decides what to do. The decision model suggests an action (with probabilities); code
// weighs that against what fits the moment (the "situation" answer, which every model tested reads
// reliably) and the blob's temperament. Small models sometimes suggest odd actions (e.g. "play"
// after an insult); this keeps the decision sensible while still letting the model choose among
// actions that fit, and makes temperament visible: an anxious Mote hides where a stoic one listens.

import { normalize } from './math';
import { IDLE_ACTIONS, INTENTS, type Archetype, type IdleAction, type IdleThought, type Intent, type Situation } from './types';

const FIT: Record<Situation, Partial<Record<Intent, number>>> = {
  greeting: { come_closer: 1, play: 0.8, listen: 0.6, celebrate: 0.4 },
  goodnight: { rest: 1, comfort: 0.5, listen: 0.3 },
  win: { celebrate: 1, play: 0.7, come_closer: 0.6 },
  good_news: { celebrate: 1, come_closer: 0.6, play: 0.6 },
  gratitude: { come_closer: 1, comfort: 0.6, celebrate: 0.5 },
  kindness: { come_closer: 1, play: 0.6, celebrate: 0.4 },
  apology: { listen: 1, come_closer: 0.7, give_space: 0.5 },
  insult: { give_space: 1, hide: 0.8, listen: 0.3 },
  loss: { comfort: 1, come_closer: 0.7, listen: 0.6 },
  loneliness: { come_closer: 1, comfort: 0.9, listen: 0.5 },
  conflict: { listen: 1, comfort: 0.7, give_space: 0.5 },
  worry: { comfort: 1, listen: 0.8, come_closer: 0.5 },
  stress: { listen: 1, comfort: 0.8, give_space: 0.4 },
  tired: { rest: 1, comfort: 0.7, listen: 0.4 },
  self_criticism: { comfort: 1, come_closer: 0.7, listen: 0.6 },
  confusion: { listen: 1, come_closer: 0.5, comfort: 0.5 },
  change: { listen: 1, come_closer: 0.6, celebrate: 0.4 },
  question: { listen: 1, come_closer: 0.6, play: 0.3 },
  ordinary: { listen: 1, play: 0.5, come_closer: 0.5, rest: 0.3 },
  none: { listen: 1, come_closer: 0.3 },
};

const LEAN: Record<Archetype, Partial<Record<Intent, number>>> = {
  anxious: { hide: 1.5, give_space: 1.2, comfort: 1.1 },
  cheerful: { celebrate: 1.3, play: 1.3, come_closer: 1.1 },
  moody: { give_space: 1.2, rest: 1.2, listen: 1.1 },
  stoic: { listen: 1.35, give_space: 1.1, celebrate: 0.8, hide: 0.7 },
  curious: { come_closer: 1.3, play: 1.2, listen: 1.1 },
};

/** The final decision: model suggestion x fit with the moment x temperament. */
export function decideIntent(model: Record<Intent, number>, situation: Record<Situation, number>, archetype: Archetype): Record<Intent, number> {
  const out = {} as Record<Intent, number>;
  for (const i of INTENTS) {
    let fit = 0;
    for (const [s, p] of Object.entries(situation) as [Situation, number][]) fit += p * (FIT[s][i] ?? 0);
    out[i] = (0.15 + (model[i] ?? 0)) * (0.08 + fit) * (LEAN[archetype][i] ?? 1);
  }
  return normalize(out);
}

const IDLE_FIT: Record<IdleThought, Partial<Record<IdleAction, number>>> = {
  remember_good: { glow: 1, hum: 0.8 },
  remember_hard: { wait_by_text: 0.7, look_around: 0.5, sulk: 0.4 },
  miss_writer: { wait_by_text: 1, look_around: 0.6 },
  wonder_day: { look_around: 1, wait_by_text: 0.6, wander: 0.5 },
  worried: { wait_by_text: 1, look_around: 0.6 },
  grateful: { glow: 1, hum: 0.8 },
  still_hurt: { sulk: 1, look_around: 0.3 },
  forgiving: { stretch: 0.8, glow: 0.7, look_around: 0.4 },
  sleepy: { nap: 1, stretch: 0.4 },
  bored: { wander: 1, look_around: 0.8, hum: 0.5 },
  content: { hum: 1, glow: 0.8, look_around: 0.4 },
  curious: { look_around: 1, wander: 0.8 },
  daydream: { wander: 1, hum: 0.6, nap: 0.3 },
};

/** What to do while idle: the model's suggestion x fit with what's on its mind x time of day. */
export function decideIdleAction(model: Record<IdleAction, number>, thought: Record<IdleThought, number>, hour: number): Record<IdleAction, number> {
  const night = hour < 6 || hour >= 23;
  const out = {} as Record<IdleAction, number>;
  for (const a of IDLE_ACTIONS) {
    let fit = 0;
    for (const [k, p] of Object.entries(thought) as [IdleThought, number][]) fit += p * (IDLE_FIT[k][a] ?? 0);
    const time = night ? (a === 'nap' ? 2 : a === 'hum' || a === 'wander' ? 0.6 : 1) : 1;
    out[a] = (0.15 + (model[a] ?? 0)) * (0.08 + fit) * time;
  }
  return normalize(out);
}
