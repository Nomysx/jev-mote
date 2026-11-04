// Mock provider: plausible random answers in the exact `/v1/systemone` response format,
// so the app can be built and tested without any model. Simple keyword cues bias the
// randomness, so a happy entry usually looks happy and an insult usually reads as hostile.

import { concentration, normalize } from '../../../shared/math';
import type { InstalledModel, ModelProfile, ProviderStatus } from '../../../shared/types';
import { NO_KEY, YES_KEY } from '../questions';
import { validateResponse } from '../parse';
import type { Answer, Answers, DecisionProvider, ProviderContext, ProviderFactory, Question, Questions, SystemOneState } from '../types';

const CUES: Record<string, RegExp> = {
  joy: /\b(happy|glad|great|awesome|love[ds]?|excited|wonderful|yay|amazing|proud|fun|delighted|finally|best day|good news)\b|:\)|😊|😀/g,
  sadness: /\b(sad|miss(ing)?|lonely|cr(y|ied)|down|depressed|lost|hurt|alone|grief|disappointed|heartbroken|empty)\b|:\(|😢/g,
  anger: /\b(angry|mad|furious|hate|annoyed|frustrat\w*|unfair|pissed|rage|irritat\w*)\b|😠/g,
  fear: /\b(scared|afraid|worried|anxious|nervous|panic\w*|terrified|fear|stress(ed)?|dread)\b/g,
  calm: /\b(calm|peaceful|relaxed|quiet|content|rest(ed)?|breathe|chill|cozy|slow morning)\b/g,
  curiosity: /\b(wonder(ing)?|curious|interesting|learn(ing|ed)?|why|how come|idea|explore|fascinat\w*)\b|\?/g,
  disgust: /\b(gross|disgust\w*|sick of|nasty|revolting|yuck|ew+)\b/g,
  work: /\b(work|job|boss|office|meeting|deadline|school|exam|class|project|money|career|colleague|study|studying)\b/g,
  relationships: /\b(friend|mom|dad|mother|father|partner|boyfriend|girlfriend|wife|husband|family|sister|brother|date|kids?|son|daughter)s?\b/g,
  health: /\b(sleep|sick|doctor|gym|headache|pain|tired|exhausted|eat(ing)?|therapy|run(ning)?|ill)\b/g,
  self: /\b(myself|goal|hobby|habit|journal(ing)?|who i am|my own)\b/g,
};
const CRISIS = /\b(kill myself|end it all|suicid\w*|self[- ]harm|hurt myself|want to die|don'?t want to (be here|live)|no reason to live)\b/;
const HOSTILE = /\b(you|mote|blob)\b[^.!?]{0,25}\b(stupid|useless|dumb|idiot|suck|ugly|worthless|pathetic)\b|\b(hate|shut up)\b[^.!?]{0,10}\b(you|mote|blob)\b|\bstupid (blob|mote)\b/;
const KIND = /\b(thank(s| you)|love you|good (blob|mote)|you'?re (sweet|cute|lovely|great|the best|kind)|(hi|hello|hey|good morning|good night) (mote|blob|little one|friend))\b/;
const DISMISSIVE = /\b(whatever|don'?t care|who cares|ignore you|not talking to you|go away|boring|you wouldn'?t understand)\b/;

/** Cues for the kind of moment an entry is (the "situation" question). */
const MOMENTS: Record<string, RegExp> = {
  greeting: /\b(hi|hello|hey|good morning)\b/,
  goodnight: /\b(good ?night|night night|going to (bed|sleep)|bedtime)\b/,
  win: /\b(did it|finished|passed|got the (job|promotion)|promotion|won|nailed it)\b/,
  good_news: /\b(good news|great news|engaged|accepted|birthday)\b/,
  gratitude: /\b(thank(s| you)|grateful|appreciate)\b/,
  apology: /\b(sorry|apologi[sz]e)\b/,
  loss: /\b(died|passed away|funeral|lost (my|our)|miss (my|him|her|them))\b/,
  loneliness: /\b(lonely|alone|nobody|no one|left out)\b/,
  conflict: /\b(fight|fought|argued|argument|yelled)\b/,
  worry: /\b(worried|anxious|nervous|scared|afraid|what if)\b/,
  stress: /\b(stressed|overwhelmed|deadline|too much|so busy|pressure)\b/,
  tired: /\b(tired|exhausted|sick|no energy)\b/,
  self_criticism: /\b(i'?m (so )?(stupid|useless|a failure)|my fault|hate myself|i failed)\b/,
  confusion: /\b(don'?t know|not sure|unsure|confused)\b/,
  change: /\b(moving|new job|quit|broke up|breakup|graduat\w*)\b/,
  question: /\?\s*$|\b(do you|are you|can you)\b/,
};

function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

export interface Cues {
  /** The lowercased text the cues were read from (for background thinking: the state). */
  text: string;
  moments: Set<string>;
  scores: Record<string, number>;
  crisis: boolean;
  hostile: boolean;
  kind: boolean;
  dismissive: boolean;
  total: number;
}

export function readCues(text: string): Cues {
  const t = text.toLowerCase();
  const scores: Record<string, number> = {};
  let total = 0;
  for (const [k, re] of Object.entries(CUES)) {
    scores[k] = Math.min(1, count(t, re) / 2);
    if (['joy', 'sadness', 'anger', 'fear', 'calm', 'curiosity', 'disgust'].includes(k)) total += scores[k];
  }
  const hostile = HOSTILE.test(t);
  const kind = KIND.test(t);
  const dismissive = DISMISSIVE.test(t);
  if (hostile) scores.anger = Math.max(scores.anger, 0.6);
  const moments = new Set(Object.keys(MOMENTS).filter((k) => MOMENTS[k].test(t)));
  return { text: t, moments, scores, crisis: CRISIS.test(t), hostile, kind, dismissive, total };
}

function messageOf(state: SystemOneState): string {
  if (typeof state === 'string') return state;
  if (!Array.isArray(state) && typeof state.new_message === 'string') return state.new_message;
  return JSON.stringify(state);
}

function choiceBias(name: string, key: string, c: Cues): number {
  if (name === 'tone_toward_blob') {
    if (key === 'hostile') return c.hostile ? 5 : 0;
    if (key === 'kind') return c.kind ? 4 : 0;
    if (key === 'dismissive') return c.dismissive ? 4 : 0;
    if (key === 'neutral') return c.hostile || c.kind || c.dismissive ? 0 : 4;
  }
  if (name === 'trust_change') {
    if (key === 'increase') return c.kind ? 4 : 0.3;
    if (key === 'decrease') return c.hostile || c.dismissive ? 4 : 0;
    if (key === 'stay') return c.kind || c.hostile ? 0.3 : 3;
  }
  if (name === 'blob_reaction') {
    if (c.hostile) return { sadness: 2.5, anger: 2, fear: 1.5 }[key] ?? 0;
    if (c.kind) return { joy: 3, calm: 1.5 }[key] ?? 0;
    if (c.crisis) return { calm: 2, sadness: 1.5 }[key] ?? 0;
  }
  if (name === 'situation') {
    if (key === 'insult') return c.hostile ? 5 : 0;
    if (key === 'kindness') return c.kind ? 3 : 0;
    if (key === 'ordinary') return c.moments.size === 0 && !c.hostile && !c.kind ? 2.5 : 0;
    if (key === 'none') return 0.1;
    return c.moments.has(key) ? 4 : 0;
  }
  if (name === 'blob_intent') return (intentBias(c)[key] ?? 0) * 1;
  if (name === 'idle_thought') return idleThoughtBias(c)[key] ?? 0;
  if (name === 'idle_action') return idleActionBias(c)[key] ?? 0;
  if (name.startsWith('dream_')) return dreamBias(name, c)[key] ?? 0;
  if (key === 'none' || key === 'other') return c.total === 0 ? 1.5 : 0;
  return (c.scores[key] ?? 0) * 4;
}

function intentBias(c: Cues): Record<string, number> {
  const m = c.moments;
  if (c.hostile) return { give_space: 3, hide: 2.5 };
  if (m.has('win') || m.has('good_news')) return { celebrate: 4, play: 1.5 };
  if (m.has('loss') || m.has('loneliness') || c.crisis) return { comfort: 4, come_closer: 2 };
  if (m.has('goodnight') || m.has('tired')) return { rest: 4 };
  if (c.kind || m.has('greeting')) return { come_closer: 3, play: 2 };
  if (m.has('worry') || m.has('stress')) return { listen: 3, comfort: 2 };
  return { listen: 2.5 };
}

/** Background thinking reads the state itself: mood words, body, time of day, a memory. */
function idleThoughtBias(c: Cues): Record<string, number> {
  const t = c.text;
  const b: Record<string, number> = {};
  if (/night/.test(t)) b.sleepy = 3;
  if (/tired|exhausted/.test(t)) b.sleepy = Math.max(b.sleepy ?? 0, 2.5);
  if (/hurt|grudge/.test(t)) Object.assign(b, { still_hurt: 3, forgiving: 1 });
  if (/happy|calm/.test(t)) Object.assign(b, { content: 1.5, grateful: 1.5 });
  if (/"memory"/.test(t)) Object.assign(b, { remember_good: 2, remember_hard: 1.2 });
  if (/days? ago|misses the writer/.test(t)) b.miss_writer = 2.5;
  if (/restless/.test(t)) b.bored = 2;
  return b;
}

function idleActionBias(c: Cues): Record<string, number> {
  const t = c.text;
  if (/night|exhausted/.test(t)) return { nap: 3 };
  if (/hurt|grudge/.test(t)) return { sulk: 2.5 };
  if (/misses the writer/.test(t)) return { wait_by_text: 2.5, look_around: 1 };
  if (/restless/.test(t)) return { wander: 2.5, stretch: 1 };
  return { look_around: 1, hum: 1, glow: 1, wander: 1, wait_by_text: 1 };
}

/** Dreams follow the memory's feeling: an insult becomes a chase, good news a flight. */
function dreamBias(name: string, c: Cues): Record<string, number> {
  const s = c.scores;
  const bias: Record<string, number> = {};
  const add = (k: string, v: number) => (bias[k] = (bias[k] ?? 0) + v);
  if (name === 'dream_place') {
    if (s.work) add('school', 3 * s.work);
    if (s.relationships) add('home', 3 * s.relationships);
    if (s.joy) add('sky', 2 * s.joy);
    if (s.sadness) add('sea', 2 * s.sadness);
    if (s.fear || c.hostile) add('dark', 2.5);
    if (s.curiosity) add('space', 2);
    if (s.calm) add('forest', 2);
  } else if (name === 'dream_event') {
    if (c.hostile) add('chased', 3.5);
    if (s.joy) add('flying', 3 * s.joy);
    if (s.sadness) (add('lost', 2.5 * s.sadness), add('searching', 1.5));
    if (s.fear) (add('falling', 2.5 * s.fear), add('chased', 1));
    if (s.anger) add('storm', 3 * s.anger);
    if (s.calm) (add('floating', 2.5), add('held', 1.5));
    if (s.relationships) add('reunion', 2);
    if (s.curiosity) add('growing', 1.5);
  } else if (name === 'dream_feeling') {
    for (const k of ['joy', 'sadness', 'anger', 'fear', 'calm', 'curiosity', 'disgust']) add(k, 3 * (s[k] ?? 0));
    if (c.hostile) add('fear', 2);
  } else if (name === 'dream_ending') {
    if (c.hostile || s.fear) add('woke_suddenly', 2.5);
    if (s.joy || s.calm) (add('peaceful', 2), add('found', 1.5));
    if (s.sadness) (add('faded', 1.5), add('transformed', 1));
  }
  return bias;
}

function yesProbability(name: string, c: Cues): number {
  if (name === 'distress_flag') return c.crisis ? 0.8 + Math.random() * 0.15 : Math.random() * 0.05;
  if (name === 'surprising') return Math.min(0.95, Math.random() * 0.45 + (c.hostile || c.crisis ? 0.4 : 0));
  return Math.random();
}

function answer(name: string, q: Question, c: Cues): Answer {
  if (q.type === 'noul') return { type: 'noul', noul: yesProbability(name, c) };

  if (q.type === 'choice') {
    const keys = Object.keys(q.criteria);
    if (keys.length === 2 && keys.includes(YES_KEY) && keys.includes(NO_KEY)) {
      const y = yesProbability(name, c);
      const probabilities = { [YES_KEY]: y, [NO_KEY]: 1 - y };
      return { type: 'choice', choice: y >= 0.5 ? YES_KEY : NO_KEY, probabilities, confidence: concentration(probabilities) };
    }
    const w: Record<string, number> = {};
    for (const k of keys) w[k] = Math.pow(0.15 + Math.random() * 0.6 + choiceBias(name, k, c), 2);
    const probabilities = normalize(w);
    const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
    return { type: 'choice', choice, probabilities, confidence: concentration(probabilities) };
  }

  const n = q.criteria.length;
  const pos = c.scores.joy + c.scores.calm * 0.5 + (c.kind ? 0.5 : 0);
  const neg = c.scores.sadness + c.scores.anger + c.scores.fear + c.scores.disgust + (c.hostile ? 0.6 : 0) + (c.crisis ? 1 : 0);
  let center: number;
  if (/valence/.test(name)) center = (n - 1) / 2 + Math.max(-1, Math.min(1, pos - neg)) * ((n - 1) / 2);
  else if (/intensity/.test(name)) center = Math.min(n - 1, 0.6 + (c.total + (c.hostile || c.crisis ? 1 : 0)) * 1.2);
  else center = Math.random() * (n - 1);
  center += (Math.random() - 0.5) * 0.8;
  const p: Record<string, number> = {};
  for (let i = 0; i < n; i++) p[String(i)] = Math.exp(-((i - center) ** 2) / (2 * 0.6 ** 2));
  const probabilities = normalize(p);
  const score = Object.entries(probabilities).reduce((s, [k, v]) => s + Number(k) * v, 0);
  const legend = Object.fromEntries(q.criteria.map((d, i) => [String(i), d]));
  return { type: 'score', score, legend, probabilities, confidence: concentration(probabilities) };
}

/** Exported for tests: answers in the raw wire format. */
export function mockAnswers(state: SystemOneState, questions: Questions): Answers {
  const c = readCues(messageOf(state));
  const out: Answers = {};
  for (const [name, q] of Object.entries(questions)) out[name] = answer(name, q, c);
  return out;
}

class MockProvider implements DecisionProvider {
  readonly providerId = 'mock';
  /** The mock ignores model names: it is always "mock", so journal entries never claim a real model. */
  readonly model = 'mock';

  constructor(private ctx: ProviderContext, _model: string) {}

  profile(): ModelProfile {
    return { ...this.ctx.catalog.profileFor('mock'), name: this.model, publisher: 'Mote (mock)', notes: 'Random but plausible answers. No model needed.' };
  }

  async status(): Promise<ProviderStatus> {
    return {
      state: 'ready',
      provider: this.providerId,
      model: this.model,
      message: 'Mock provider: plausible random answers, no model needed',
      checkedAt: Date.now(),
    };
  }

  async ask(state: SystemOneState, questions: Questions) {
    await new Promise((r) => setTimeout(r, 450 + Math.random() * 500));
    const raw = { model: this.model, answers: mockAnswers(state, questions), usage: { input_tokens: 0, output_tokens: 0 } };
    return validateResponse(questions, raw, this.model);
  }

  async setModel(_model: string): Promise<ProviderStatus> {
    return this.status();
  }

  async listModels(): Promise<InstalledModel[]> {
    return [{ name: this.model, isDecisionModel: true, isCloud: false, tier: 'other', languages: ['Any (random)'] }];
  }
}

const factory: ProviderFactory = {
  id: 'mock',
  create: (ctx, model) => new MockProvider(ctx, model),
};

export default factory;
