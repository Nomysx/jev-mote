// Mote's thoughts: short, hand-written lines. The decision model never writes text; it only chooses
// which kind of thought fits (with probabilities), and these lines give that choice a voice,
// flavored by temperament. A seed (e.g. the entry id) picks the variant, so the journal shows the
// same thought Mote had at the time.

import type { Archetype, IdleAction, IdleThought, Intent, Situation } from '../../../shared/types';

type Lines = { all: string[] } & Partial<Record<Archetype, string[]>>;

export const SITUATION_LINES: Record<Situation, Lines> = {
  greeting: { all: ['hi!', 'oh, hello', "you're back"], cheerful: ['hiii!'], stoic: ['hello.'], anxious: ['oh! hi'], curious: ['hello, you'], moody: ['oh. hi'] },
  goodnight: { all: ['sleep well', 'night night', 'rest now'], cheerful: ['sweet dreams!'], stoic: ['good night.'], anxious: ['see you tomorrow?'], curious: ['dream of something nice'], moody: ['…night'] },
  win: { all: ['you did it!', 'look at you', "that's huge"], cheerful: ['yesss!'], stoic: ['well earned.'], anxious: ['phew. you did it'], curious: ['how did you do it?'], moody: ['finally, some light'] },
  good_news: { all: ['oh, nice!', 'good news!', "that's lovely"], cheerful: ['yay!'], stoic: ['good.'], anxious: ['oh good. phew'], curious: ['ooh, and then?'], moody: ['a good one, for once'] },
  gratitude: { all: ["that's warm", 'aw', 'thank you, too'], cheerful: ['happy to help!'], stoic: ['…thank you.'], anxious: ['really? me?'], curious: ['you noticed'], moody: ['that helps'] },
  kindness: { all: ['aw', "you're sweet", 'warm inside'], cheerful: ['stay forever'], stoic: ['…kind.'], anxious: ['you mean it?'], curious: ['you like me?'], moody: ["maybe today's okay"] },
  apology: { all: ['okay. thank you', 'i hear you', "it's okay now"], cheerful: ['all good!'], stoic: ['accepted.'], anxious: ["you won't do it again?"], curious: ['what changed?'], moody: ['…maybe'] },
  insult: { all: ['ouch', 'that stung', 'why?'], cheerful: ['…oh'], stoic: ['noted.'], anxious: ['did i do something?'], curious: ['why say that?'], moody: ['of course'] },
  loss: { all: ['oh no', "i'm so sorry", "that's heavy"], cheerful: ['oh… no'], stoic: ['take your time.'], anxious: ['oh no, oh no'], curious: ['they mattered'], moody: ['it hurts, i know'] },
  loneliness: { all: ["you're not alone", "i'm right here", 'come closer'], cheerful: ["i'm here!"], stoic: ['still here.'], anxious: ['me neither…'], curious: ['who do you miss?'], moody: ['lonely together'] },
  conflict: { all: ['that sounds hard', 'oof', 'breathe'], cheerful: ["it'll pass"], stoic: ['let it cool.'], anxious: ['is it safe?'], curious: ['what happened?'], moody: ['storms…'] },
  worry: { all: ['it might be okay', 'one step at a time', 'breathe'], cheerful: ["you've got this"], stoic: ['face it calmly.'], anxious: ['me too…'], curious: ["what's the worst part?"], moody: ['clouds again'] },
  stress: { all: ["that's a lot", 'slow down', 'one thing at a time'], cheerful: ['tiny steps!'], stoic: ['one by one.'], anxious: ['so much…'], curious: ['which one first?'], moody: ['heavy load'] },
  tired: { all: ['rest a little', 'you need sleep', 'so tired…'], cheerful: ['nap time?'], stoic: ['rest.'], anxious: ['please rest'], curious: ['when did you sleep?'], moody: ['drained'] },
  self_criticism: { all: ['be kind to you', 'too harsh', "you're doing your best"], cheerful: ["you're great, though!"], stoic: ['go easy.'], anxious: ["don't say that"], curious: ['would you say that to a friend?'], moody: ['you deserve better'] },
  confusion: { all: ['hmm…', "it's okay not to know", 'let it settle'], cheerful: ["we'll figure it out"], stoic: ['wait and see.'], anxious: ['what now?'], curious: ['interesting…'], moody: ['foggy'] },
  change: { all: ['big change', 'a new chapter', 'wow'], cheerful: ['new adventure!'], stoic: ['change comes.'], anxious: ['so different…'], curious: ["what's next?"], moody: ['things shift'] },
  question: { all: ['hmm?', 'good question', 'let me think…'], cheerful: ['ooh, a question!'], stoic: ['…'], anxious: ['me? um…'], curious: ['i wonder too'], moody: ['who knows'] },
  ordinary: { all: ['mm, okay', 'a quiet day', 'nice and steady'], cheerful: ['a nice day!'], stoic: ['steady.'], anxious: ['okay. good.'], curious: ['tell me more'], moody: ['just a day'] },
  none: { all: ['hm', 'i see', '…'] },
};

export const INTENT_LABELS: Record<Intent, string> = {
  come_closer: 'come closer',
  comfort: 'comfort',
  celebrate: 'celebrate',
  give_space: 'give space',
  hide: 'hide',
  listen: 'listen',
  play: 'play',
  rest: 'rest',
};

export const IDLE_LINES: Record<IdleThought, Lines> = {
  remember_good: { all: ['still smiling about this', 'that was a good day'], moody: ['that one was nice'], stoic: ['a good memory.'] },
  remember_hard: { all: ['still thinking about this', 'this one stays with me'], anxious: ['i keep thinking about this'], stoic: ['still with me.'] },
  miss_writer: { all: ['where did you go?', 'come back soon', "it's quiet without you"], cheerful: ['come play!'], moody: ['…alone again'] },
  wonder_day: { all: ["how's your day?", "wonder what you're doing"], curious: ['what are you up to?'] },
  worried: { all: ["hope you're okay"], anxious: ['are you okay out there?'] },
  grateful: { all: ["glad you're around"], cheerful: ['lucky me'], stoic: ['good company.'] },
  still_hurt: { all: ['that still stings'], moody: ["can't shake it"], stoic: ['healing.'] },
  forgiving: { all: ['letting it go…'], cheerful: ['water under the bridge'] },
  sleepy: { all: ['so sleepy…', 'zzz…'], anxious: ['maybe a little nap…'] },
  bored: { all: ['…bored', 'anyone there?'], curious: ['so many things to wonder about'] },
  content: { all: ['this is nice', 'all quiet'], stoic: ['calm.'], cheerful: ['what a nice day'] },
  curious: { all: ["what's out there?", 'i wonder…'], curious: ['so many questions'] },
  daydream: { all: ['clouds…', 'floating…'], moody: ['drifting…'] },
};

export const IDLE_ACTION_LABELS: Record<IdleAction, string> = {
  nap: 'nap',
  look_around: 'look around',
  wait_by_text: 'wait for you',
  wander: 'wander',
  stretch: 'stretch',
  hum: 'hum',
  sulk: 'sulk',
  glow: 'glow',
};

/** Gentle lines for the distress safeguard: calm, never alarming. */
export const SOOTHE_LINES = ['breathe…', 'slowly now', 'you matter', 'one breath at a time'];

/** Shown when the model couldn't read an entry (e.g. language). */
export const PUZZLED_LINES = ["can't read this one", 'hm? hm?', 'what does it say?'];

/** A stable pseudo-random index from a seed. */
function pickIndex(n: number, seed: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) % n;
}

/** One line for a thought: usually the general set, sometimes the archetype's own voice. */
export function lineFor(lines: Lines, archetype: Archetype, seed: number): string {
  const own = lines[archetype] ?? [];
  const pool = own.length && pickIndex(3, seed + 7) === 0 ? own : lines.all;
  return pool[pickIndex(pool.length, seed)];
}

export function pickFrom(list: string[], seed: number): string {
  return list[pickIndex(list.length, seed)];
}
