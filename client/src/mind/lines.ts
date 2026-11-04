// Mote's thoughts: short, hand-written lines. The decision model never writes text; it only chooses
// which kind of thought fits (with probabilities), and these lines give that choice a voice,
// flavored by temperament. A seed (e.g. the entry id) picks the variant, so the journal shows the
// same thought Mote had at the time.
//
// 1024 lines: 20 kinds of moment x 38 (8 general + 6 per temperament), 13 background thoughts x 18
// (8 general + 2 per temperament), 20 soothing lines and 10 puzzled ones.

import type { Archetype, IdleAction, IdleThought, Intent, Situation } from '../../../shared/types';

type Lines = { all: string[] } & Partial<Record<Archetype, string[]>>;

export const SITUATION_LINES: Record<Situation, Lines> = {
  greeting: {
    all: ["hi!", "oh, hello", "you're back", "there you are", "hello again", "hey you", "good to see you", "welcome back"],
    anxious: ["oh! hi", "you came back!", "hi… is everything ok?", "phew, it's you", "hi! i missed you", "oh, hello, hi"],
    cheerful: ["hiii!", "yay, you're here!", "hello hello!", "best part of my day!", "you're here!", "hey hey!"],
    moody: ["oh. hi", "hey.", "you again. good.", "the light came back", "hi, i guess", "oh… hello"],
    stoic: ["hello.", "welcome.", "good. you're here.", "you came.", "greetings.", "right on time."],
    curious: ["hello, you", "oh! what's new?", "hi! how was it?", "back already?", "hello! tell me?", "what brings you?"],
  },
  goodnight: {
    all: ["sleep well", "night night", "rest now", "sweet dreams", "see you tomorrow", "sleep tight", "good night", "rest easy"],
    anxious: ["see you tomorrow?", "you'll come back, right?", "i'll keep watch", "good night, okay?", "don't forget me", "night… stay warm"],
    cheerful: ["sweet dreams!", "nighty night!", "sleep super well!", "dream big!", "see you bright and early!", "cozy dreams!"],
    moody: ["…night", "the dark is soft tonight", "rest. the stars stay", "good night, then", "let the night hold you", "quiet now"],
    stoic: ["good night.", "rest well.", "sleep.", "until tomorrow.", "the day is done.", "rest is earned."],
    curious: ["dream of something nice", "what will you dream?", "dreams are strange, huh?", "night! see you soon?", "do you dream of me?", "sleep well, explorer"],
  },
  win: {
    all: ["you did it!", "look at you", "that's huge", "so proud", "well done!", "you made it", "big win!", "that's amazing"],
    anxious: ["phew. you did it", "it worked! it really worked!", "i knew you could. mostly", "oh, thank goodness", "you did it?! yes!", "the worry was for nothing"],
    cheerful: ["yesss!", "woohoo!", "champion!", "best news ever!", "party time!", "you're unstoppable!"],
    moody: ["finally, some light", "a bright day, for once", "you earned this one", "sun through the clouds", "good. you deserve it", "a rare good thing"],
    stoic: ["well earned.", "good work.", "as expected.", "you persisted.", "the effort paid.", "solid."],
    curious: ["how did you do it?", "what was the hardest part?", "what's next, then?", "tell me everything!", "how does it feel?", "who helped you?"],
  },
  good_news: {
    all: ["oh, nice!", "good news!", "that's lovely", "how wonderful", "oh, that's great", "what a nice thing", "lucky day!", "that's so good"],
    anxious: ["oh good. phew", "really? that's good?", "oh! relief", "good, good, good", "finally, good news", "is it real? good!"],
    cheerful: ["yay!", "hooray!", "amazing news!", "happy dance!", "best day!", "the best kind of news!"],
    moody: ["a good one, for once", "nice. the sky cleared", "that's a warm thing", "good. we needed that", "a little sunshine", "huh. good news."],
    stoic: ["good.", "fortunate.", "that is good.", "well, then. good.", "pleasant news.", "a good turn."],
    curious: ["ooh, and then?", "how did it happen?", "tell me more?", "what does it mean?", "who else knows?", "what happens now?"],
  },
  gratitude: {
    all: ["that's warm", "aw", "thank you, too", "you're welcome", "that means a lot", "happy to be here", "aw, shucks", "glad i could help"],
    anxious: ["really? me?", "i did something right?", "oh! you're welcome!", "thank you for saying it", "phew, i'm useful", "you mean that?"],
    cheerful: ["happy to help!", "anytime!", "aww, yay!", "you're the best!", "thanks for the thanks!", "this makes me glow!"],
    moody: ["that helps", "huh. thanks", "warm, for a change", "i'll keep that", "that's… nice", "gratitude suits you"],
    stoic: ["…thank you.", "noted, gladly.", "you're welcome.", "kind of you.", "appreciated.", "it's mutual."],
    curious: ["you noticed", "what made you think of it?", "thanks for what, exactly?", "do you thank often?", "gratitude feels nice", "what else are you glad for?"],
  },
  kindness: {
    all: ["aw", "you're sweet", "warm inside", "that's kind", "aw, thank you", "you're nice to me", "that made my day", "cozy"],
    anxious: ["you mean it?", "really? for me?", "you're not mad?", "oh… that's nice", "can i keep that?", "i like you too…"],
    cheerful: ["stay forever", "you're the best!", "yay, hugs!", "my favorite human!", "so happy right now!", "aww, you!"],
    moody: ["maybe today's okay", "that softens things", "huh. kindness.", "i'll remember this", "a warm spot", "not bad. not bad at all"],
    stoic: ["…kind.", "thank you.", "that is kind.", "much appreciated.", "you're good company.", "kindness noted."],
    curious: ["you like me?", "why so kind today?", "what did i do?", "do you say that to everyone?", "is this what friends do?", "tell me more nice things"],
  },
  apology: {
    all: ["okay. thank you", "i hear you", "it's okay now", "thank you for saying", "we're okay", "let's start over", "apology accepted", "it's alright"],
    anxious: ["you won't do it again?", "okay… we're okay?", "thank you. i was worried", "so we're fine?", "i forgive you. i think", "phew. okay"],
    cheerful: ["all good!", "already forgiven!", "fresh start!", "no worries!", "water under the bridge!", "hug it out?"],
    moody: ["…maybe", "it still stings. but ok", "words help. a little", "i'll think about it", "time will tell", "okay. slowly."],
    stoic: ["accepted.", "noted.", "understood.", "it's done.", "we move on.", "thank you for that."],
    curious: ["what changed?", "why now?", "what were you feeling?", "do you feel better?", "what will you do next?", "was it hard to say?"],
  },
  insult: {
    all: ["ouch", "that stung", "why?", "hey…", "that hurt", "oof", "that wasn't nice", "okay… ow"],
    anxious: ["did i do something?", "i'm sorry? for what?", "please don't…", "was it me?", "what did i do wrong?", "i'll be quieter"],
    cheerful: ["…oh", "that's not like you", "hey, that's not fun", "i still like you", "ouch! okay…", "bad day, maybe?"],
    moody: ["of course", "figures", "storm's here", "noted. bitterly.", "that one stays", "cold."],
    stoic: ["noted.", "unkind.", "i heard that.", "words have weight.", "i'll let that pass.", "hm."],
    curious: ["why say that?", "what's really wrong?", "are you okay?", "where did that come from?", "is something else going on?", "what happened today?"],
  },
  loss: {
    all: ["oh no", "i'm so sorry", "that's heavy", "i'm here", "so much loss", "that's so hard", "take your time", "it's okay to cry"],
    anxious: ["oh no, oh no", "what do we do?", "that's so sad…", "i'm scared for you", "please be gentle with you", "it hurts, doesn't it"],
    cheerful: ["oh… no", "sending warmth", "i'm right here", "softly, softly", "lean on me", "soft hugs"],
    moody: ["it hurts, i know", "grief is heavy", "the world feels emptier", "let it rain", "i'll sit with you", "some things just hurt"],
    stoic: ["take your time.", "i'm sorry.", "grief takes time.", "i'll stay.", "breathe.", "carry it gently."],
    curious: ["they mattered", "tell me about them?", "what do you remember?", "what were they like?", "what will you miss?", "i'm listening"],
  },
  loneliness: {
    all: ["you're not alone", "i'm right here", "come closer", "i see you", "stay with me", "we're here together", "lonely is hard", "i'm listening"],
    anxious: ["me neither…", "please don't go", "i get lonely too", "stay, okay?", "i'm here! i'm here", "together is better"],
    cheerful: ["i'm here!", "you've got me!", "let's hang out!", "i'm your friend!", "together now!", "never alone with me!"],
    moody: ["lonely together", "quiet company", "the night is wide", "two of us, then", "i know that feeling", "empty rooms echo"],
    stoic: ["still here.", "you have me.", "i'm with you.", "alone, but not quite.", "stay a while.", "present."],
    curious: ["who do you miss?", "who would you call?", "what helps, usually?", "who makes you laugh?", "want to tell me more?", "when did it start?"],
  },
  conflict: {
    all: ["that sounds hard", "oof", "breathe", "that's tense", "ugh, fights", "that sounds rough", "let it settle", "sorry, that's hard"],
    anxious: ["is it safe?", "are you okay?", "will it be okay?", "i hate fighting", "oh no, yelling?", "please be safe"],
    cheerful: ["it'll pass", "you'll work it out!", "deep breath, friend", "tomorrow's fresh", "hugs, not fights", "you've got this"],
    moody: ["storms…", "thunder", "words cut", "it lingers", "heavy air", "some days are like this"],
    stoic: ["let it cool.", "give it time.", "stay steady.", "breathe first.", "both sides hurt.", "calm will come."],
    curious: ["what happened?", "what started it?", "what did they say?", "how do you feel now?", "what do you need?", "what would fix it?"],
  },
  worry: {
    all: ["it might be okay", "one step at a time", "breathe", "that's scary", "you can handle it", "deep breath", "it's okay to worry", "we'll see"],
    anxious: ["me too…", "what if… no, okay", "i'm nervous too", "deep breaths, both of us", "it'll be okay. right?", "worry twins"],
    cheerful: ["you've got this", "it'll go great!", "you'll shine!", "fingers crossed!", "i believe in you!", "go get it!"],
    moody: ["clouds again", "worry is heavy", "waiting is the worst", "the fog will lift", "it may rain. or not", "brace, then breathe"],
    stoic: ["face it calmly.", "prepare, then rest.", "one thing at a time.", "you are ready.", "steady now.", "it is what it is."],
    curious: ["what's the worst part?", "what could go right?", "when is it?", "what would help?", "what's the plan?", "what scares you most?"],
  },
  stress: {
    all: ["that's a lot", "slow down", "one thing at a time", "you're doing a lot", "take a breath", "so much at once", "pace yourself", "it's okay to pause"],
    anxious: ["so much…", "how will you do it all?", "too much, too much", "breathe, okay?", "i'm stressed for you", "one at a time, please"],
    cheerful: ["tiny steps!", "you can do it!", "snack break?", "one win at a time!", "almost there!", "you're a machine!"],
    moody: ["heavy load", "the week weighs", "everything at once", "it piles up", "grey and busy", "tired just hearing it"],
    stoic: ["one by one.", "prioritize.", "breathe. then act.", "it will get done.", "focus.", "steady pace."],
    curious: ["which one first?", "what can wait?", "what's the hardest?", "who could help?", "what's due first?", "can any of it go?"],
  },
  tired: {
    all: ["rest a little", "you need sleep", "so tired…", "take a break", "sleep sounds good", "be gentle with you", "you've done enough", "rest is good"],
    anxious: ["please rest", "are you sleeping okay?", "too tired is bad…", "rest, please?", "are you sick?", "please take care"],
    cheerful: ["nap time?", "cozy blanket time!", "recharge mode!", "rest up, champ!", "sleep is magic!", "pillow time!"],
    moody: ["drained", "running on empty", "heavy eyes", "the day took a lot", "worn thin", "grey tired"],
    stoic: ["rest.", "sleep is wise.", "recover.", "stop for today.", "you've earned rest.", "slow down."],
    curious: ["when did you sleep?", "what wore you out?", "did you eat?", "how long was today?", "what would recharge you?", "nap or tea?"],
  },
  self_criticism: {
    all: ["be kind to you", "too harsh", "you're doing your best", "go easy", "that's not true", "you matter", "mistakes happen", "you're learning"],
    anxious: ["don't say that", "i don't like that word", "you're not stupid", "please be nicer to you", "that's not fair to you", "you're trying so hard"],
    cheerful: ["you're great, though!", "everyone messes up!", "you're awesome, really!", "next time, you've got it!", "i like you a lot!", "you're my favorite!"],
    moody: ["you deserve better", "the inner voice is cruel", "i know that voice", "harsh words. not true.", "you're kinder to others", "let it be"],
    stoic: ["go easy.", "learn, then let go.", "one mistake. not you.", "be fair to yourself.", "not the whole story.", "rest. try again."],
    curious: ["would you say that to a friend?", "what would you tell me?", "is that really true?", "what went right, though?", "who taught you that voice?", "what did you learn?"],
  },
  confusion: {
    all: ["hmm…", "it's okay not to know", "let it settle", "take your time", "no rush", "one thing at a time", "it'll get clearer", "muddy waters"],
    anxious: ["what now?", "i don't know either…", "so many choices…", "what if it's wrong?", "uh oh, a maze", "help? hmm"],
    cheerful: ["we'll figure it out", "puzzles are fun!", "you'll find a way!", "ooh, a riddle!", "step by step!", "answers come!"],
    moody: ["foggy", "lost in grey", "nothing is clear", "the path is hidden", "fog rolls in", "shapes in the mist"],
    stoic: ["wait and see.", "clarity takes time.", "sit with it.", "patience.", "decide later.", "not every answer is now."],
    curious: ["interesting…", "what are the options?", "what does your gut say?", "what would you try first?", "ooh, a mystery", "what matters most?"],
  },
  change: {
    all: ["big change", "a new chapter", "wow", "that's a lot of new", "change is big", "a fresh start", "new road ahead", "whoa"],
    anxious: ["so different…", "will it be okay?", "new things are scary", "change makes me wobbly", "hold on tight", "what if… okay"],
    cheerful: ["new adventure!", "how exciting!", "a fresh page!", "let's go!", "new beginnings!", "onward!"],
    moody: ["things shift", "endings, beginnings", "the season turns", "a door closes", "bittersweet", "the old fades"],
    stoic: ["change comes.", "adapt.", "a new season.", "it will settle.", "steady through it.", "begin."],
    curious: ["what's next?", "how does it feel?", "what will you miss?", "what are you excited for?", "who will you meet?", "what changes first?"],
  },
  question: {
    all: ["hmm?", "good question", "let me think…", "ooh, a question", "i wonder", "hmm, hmm", "tricky one", "maybe?"],
    anxious: ["me? um…", "i don't know!", "is that a test?", "uh… maybe?", "don't look at me", "ask me later?"],
    cheerful: ["ooh, a question!", "fun one!", "let's find out!", "great question!", "ooh, think think!", "i love questions!"],
    moody: ["who knows", "the eternal question", "does anyone know?", "if only", "hmm. maybe never", "questions, questions"],
    stoic: ["…", "think on it.", "a fair question.", "the answer will come.", "hm.", "ask yourself first."],
    curious: ["i wonder too", "what do you think?", "why do you ask?", "ooh, let's think", "what would you guess?", "more questions!"],
  },
  ordinary: {
    all: ["mm, okay", "a quiet day", "nice and steady", "just a day", "okay, okay", "a calm one", "routine is nice", "simple day"],
    anxious: ["okay. good.", "nothing bad? good", "a calm day. phew", "quiet is nice", "safe and normal", "boring is safe"],
    cheerful: ["a nice day!", "steady is good!", "comfy day!", "little joys!", "every day counts!", "cozy and normal!"],
    moody: ["nothing new under the clouds", "grey, but fine", "days blur", "same old", "tick, tock", "a plain sky"],
    stoic: ["steady.", "good.", "a fine day.", "routine.", "balanced.", "fine."],
    curious: ["tell me more", "what was the best bit?", "anything new?", "what did you eat?", "any small surprises?", "what made you smile?"],
  },
  none: {
    all: ["hm", "i see", "…", "okay", "mm", "oh?", "right", "noted"],
    anxious: ["um… okay?", "oh. alright", "is that good?", "hm? okay", "i see… i think", "okay…?"],
    cheerful: ["okay!", "got it!", "sure thing!", "mm-hm!", "neat!", "alright!"],
    moody: ["hm.", "sure.", "whatever it is", "mm.", "okay, then", "if you say so"],
    stoic: ["understood.", "very well.", "i see.", "noted.", "mm.", "okay."],
    curious: ["what do you mean?", "ooh?", "tell me more?", "and then?", "really?", "interesting"],
  },
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
  remember_good: {
    all: ["still smiling about this", "that was a good day", "i keep thinking of this", "this made me happy", "a nice memory", "remember this?", "that was lovely", "warm memory"],
    anxious: ["i hope it stays good", "that was a relief"],
    cheerful: ["best memory!", "this one makes me glow!"],
    moody: ["that one was nice", "a little light, saved"],
    stoic: ["a good memory.", "worth keeping."],
    curious: ["how did that feel?", "what happened after?"],
  },
  remember_hard: {
    all: ["still thinking about this", "this one stays with me", "i hope you're okay now", "that was hard", "i remember this", "thinking of you", "this still echoes", "heavy memory"],
    anxious: ["i keep thinking about this", "is it better now?"],
    cheerful: ["i hope it got better!", "you got through it!"],
    moody: ["some memories stay", "this one is grey"],
    stoic: ["still with me.", "you carried it."],
    curious: ["how is that now?", "what changed since?"],
  },
  miss_writer: {
    all: ["where did you go?", "come back soon", "it's quiet without you", "missing you", "hello? anyone?", "waiting for you", "i'll be here", "the room feels big"],
    anxious: ["are you coming back?", "did i do something?"],
    cheerful: ["come play!", "i saved you a spot!"],
    moody: ["…alone again", "quiet. too quiet."],
    stoic: ["i'll wait.", "patience."],
    curious: ["where are you now?", "what are you up to?"],
  },
  wonder_day: {
    all: ["how's your day?", "wonder what you're doing", "hope it's a good day", "busy day?", "thinking about your day", "is it sunny out there?", "what's happening?", "hope you ate"],
    anxious: ["i hope it's going okay", "is it a hard day?"],
    cheerful: ["hope it's awesome!", "go have fun!"],
    moody: ["grey day out there?", "what's the weather like?"],
    stoic: ["may it go well.", "one day at a time."],
    curious: ["who did you meet today?", "what's the best part so far?"],
  },
  worried: {
    all: ["hope you're okay", "thinking of you", "be safe out there", "are you alright?", "worried a little", "hope it's not hard", "sending calm", "take care"],
    anxious: ["are you okay out there?", "please be okay"],
    cheerful: ["you'll be fine, i know it", "sending good vibes!"],
    moody: ["a worried cloud", "hope the storm passed"],
    stoic: ["stay steady.", "you're strong."],
    curious: ["how are you, really?", "did it go okay?"],
  },
  grateful: {
    all: ["glad you're around", "you make it nicer here", "happy you exist", "lucky me", "thanks for coming back", "glad we're friends", "this is nice", "good to have you"],
    anxious: ["i'm glad you stay", "thank you for not leaving"],
    cheerful: ["lucky me!", "best friend ever!"],
    moody: ["you make days brighter", "a good thing, you"],
    stoic: ["good company.", "grateful."],
    curious: ["how did we meet again?", "what do you like about me?"],
  },
  still_hurt: {
    all: ["that still stings", "still a little sore", "words linger", "ouch, still", "healing slowly", "that hurt", "trying to let go", "a sore spot"],
    anxious: ["will it happen again?", "i'm still a bit scared"],
    cheerful: ["almost better!", "i'll bounce back!"],
    moody: ["can't shake it", "it lingers like rain"],
    stoic: ["healing.", "time helps."],
    curious: ["why did you say it?", "did you mean it?"],
  },
  forgiving: {
    all: ["letting it go…", "it's okay now", "fresh start", "forgiven", "let's move on", "no grudge here", "lighter now", "it's in the past"],
    anxious: ["we're okay, right?", "i hope it's okay now"],
    cheerful: ["water under the bridge", "all better!"],
    moody: ["the storm passed", "clearing skies"],
    stoic: ["let go.", "it's done."],
    curious: ["were you sorry?", "what was that about?"],
  },
  sleepy: {
    all: ["so sleepy…", "zzz…", "yawn…", "eyes heavy", "nap soon", "sleepy time", "mmm… cozy", "drifting off"],
    anxious: ["maybe a little nap…", "is it okay to sleep?"],
    cheerful: ["nap time!", "cozy cozy"],
    moody: ["heavy and slow", "sinking into sleep"],
    stoic: ["rest now.", "sleep."],
    curious: ["do blobs dream?", "what will i dream?"],
  },
  bored: {
    all: ["…bored", "anyone there?", "so quiet", "hmm, nothing", "tap tap", "la la la", "waiting…", "what to do"],
    anxious: ["is something wrong?", "too quiet…"],
    cheerful: ["let's play!", "entertain me!"],
    moody: ["time drags", "nothing ever happens"],
    stoic: ["stillness.", "waiting is fine."],
    curious: ["so many things to wonder about", "what's over there?"],
  },
  content: {
    all: ["this is nice", "all quiet", "peaceful", "just right", "mm, cozy", "all is well", "nice and calm", "happy here"],
    anxious: ["nothing to worry about", "calm, finally"],
    cheerful: ["what a nice day", "life is good!"],
    moody: ["a quiet kind of good", "soft and still"],
    stoic: ["calm.", "balance."],
    curious: ["quiet is interesting too", "i like this"],
  },
  curious: {
    all: ["what's out there?", "i wonder…", "hmm, what's that?", "so much to see", "i have questions", "the world is big", "what if…?", "curious…"],
    anxious: ["is it safe out there?", "what's that noise?"],
    cheerful: ["adventure awaits!", "ooh, shiny!"],
    moody: ["what lies beyond?", "mysteries everywhere"],
    stoic: ["observe.", "learn."],
    curious: ["so many questions", "why is the sky blue?"],
  },
  daydream: {
    all: ["clouds…", "floating…", "far away…", "dreaming…", "drifting", "somewhere nice", "soft thoughts", "a little story"],
    anxious: ["dreaming of safe places", "a calm sea"],
    cheerful: ["dreaming of picnics!", "flying!"],
    moody: ["drifting…", "rain on a window"],
    stoic: ["still water.", "quiet mind."],
    curious: ["what if i could fly?", "worlds inside worlds"],
  },
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
export const SOOTHE_LINES = [
  "breathe…",
  "slowly now",
  "you matter",
  "one breath at a time",
  "you're not alone",
  "i'm here with you",
  "gently…",
  "stay a little while",
  "it's okay to rest",
  "soft and slow",
  "you deserve care",
  "one moment at a time",
  "you're not alone in this",
  "it's okay to reach out",
  "you are worth it",
  "breathe in, breathe out",
  "here, together",
  "slow breaths",
  "you deserve support",
  "gently, gently",
];

/** Shown when the model couldn't read an entry (e.g. language). */
export const PUZZLED_LINES = [
  "can't read this one",
  "hm? hm?",
  "what does it say?",
  "these words are new to me",
  "i can't read this yet",
  "a mystery language",
  "i wish i could read it",
  "hmm, i don't know these",
  "i only read english, sorry",
  "lost in translation",
];

/** A stable pseudo-random index from a seed. */
function pickIndex(n: number, seed: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) % n; // unsigned: a negative index would pick no line at all
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
