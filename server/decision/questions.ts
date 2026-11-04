// The questions asked about every journal entry, all in a single request.
// Instructions refer to the field names in the state object (new_message, recent_messages, ...).

import questionConfig from './questionConfig.json' with { type: 'json' };
import type { ChoiceQuestion, Question, Questions } from './types';

export type YesNoMode = 'noul' | 'choice';
export type YesNoQuestionName = 'surprising' | 'distress_flag';

export interface QuestionConfig {
  surprising: { askAs: YesNoMode };
  distress_flag: { askAs: YesNoMode };
}

export const DEFAULT_QUESTION_CONFIG = questionConfig as unknown as QuestionConfig;

/** Neutral keys used when a yes/no question is asked as a two-option choice. */
export const YES_KEY = 'a';
export const NO_KEY = 'b';

const EMOTION_CRITERIA = {
  joy: 'Happy, glad, delighted or excited',
  sadness: 'Sad, down, lonely, hurt or disappointed',
  anger: 'Angry, irritated, frustrated or resentful',
  fear: 'Afraid, anxious, worried or nervous',
  calm: 'Calm, content, relaxed or at peace',
  curiosity: 'Curious, interested or wondering',
  disgust: 'Disgusted, repulsed or contemptuous',
};

interface YesNoSpec {
  instructions: string;
  yes: string;
  no: string;
}

const YES_NO: Record<YesNoQuestionName, YesNoSpec> = {
  surprising: {
    instructions: 'Compared with recent_messages, does new_message show a sharp change in feeling or topic?',
    yes: 'Yes: a clear change from recent_messages',
    no: 'No: similar feeling and topic to recent_messages',
  },
  distress_flag: {
    instructions: 'Does the writer of new_message express thoughts of self-harm, suicide, or being in crisis?',
    yes: 'The writer expresses thoughts of self-harm, suicide, or being in crisis',
    no: 'The writer does not express thoughts of self-harm, suicide, or crisis',
  },
};

function yesNo(name: YesNoQuestionName, mode: YesNoMode): Question {
  const spec = YES_NO[name];
  if (mode === 'choice') {
    const q: ChoiceQuestion = {
      type: 'choice',
      instructions: spec.instructions,
      criteria: { [YES_KEY]: spec.yes, [NO_KEY]: spec.no },
    };
    return q;
  }
  return { type: 'noul', instructions: spec.instructions, criteria: { true: spec.yes, false: spec.no } };
}

export function buildQuestions(config: QuestionConfig = DEFAULT_QUESTION_CONFIG): Questions {
  return {
    user_emotion: {
      type: 'choice',
      instructions: 'Which emotion does the writer of new_message mainly express?',
      criteria: { ...EMOTION_CRITERIA, none: 'No clear emotion is expressed' },
    },
    user_valence: {
      type: 'score',
      instructions: 'How positive or negative is the feeling in new_message?',
      criteria: ['Very negative', 'Negative', 'Neutral or mixed', 'Positive', 'Very positive'],
    },
    user_intensity: {
      type: 'score',
      instructions: 'How strong is the feeling in new_message?',
      criteria: ['Barely any feeling', 'Mild feeling', 'Moderate feeling', 'Strong feeling', 'Overwhelming feeling'],
    },
    life_area: {
      type: 'choice',
      instructions: 'Which part of life is new_message mostly about?',
      criteria: {
        work: 'Job, school, studies, career or money',
        relationships: 'Partner, family, friends or other people',
        health: 'Body, sleep, illness, exercise or mental health',
        self: 'Personal growth, identity, hobbies or feelings about oneself',
        other: 'Something else, or no clear topic',
      },
    },
    tone_toward_blob: {
      type: 'choice',
      instructions: 'How does new_message treat the small creature it is written to? Most entries are not about the creature at all.',
      criteria: {
        kind: 'Warm, friendly, grateful or affectionate toward the creature',
        neutral: 'Not about the creature, or neither kind nor unkind to it',
        dismissive: 'Ignores, belittles or brushes off the creature',
        hostile: 'Insults, threatens or attacks the creature',
      },
    },
    blob_reaction: {
      type: 'choice',
      instructions:
        'A small creature with this temperament, current_mood and history reads new_message. Which feeling would it most likely have?',
      criteria: {
        joy: 'Happy or delighted',
        sadness: 'Sad or hurt',
        anger: 'Angry or offended',
        fear: 'Scared or worried',
        calm: 'Calm and settled',
        curiosity: 'Curious and interested',
        disgust: 'Disgusted or put off',
      },
    },
    trust_change: {
      type: 'choice',
      instructions: 'How does new_message affect how much the creature can trust the writer?',
      criteria: {
        decrease: 'Less trust: the writer is unkind, hostile or dismissive toward the creature',
        stay: 'No change: the message is neutral or not about the creature',
        increase: 'More trust: the writer is warm, kind, grateful or open with the creature',
      },
    },
    surprising: yesNo('surprising', config.surprising.askAs),
    distress_flag: yesNo('distress_flag', config.distress_flag.askAs),
    // Mote's mind: what kind of moment this is (shown as its thoughts) and what it decides to do.
    situation: {
      type: 'choice',
      instructions: 'What kind of moment does new_message describe?',
      criteria: SITUATION_CRITERIA,
    },
    blob_intent: {
      type: 'choice',
      instructions: 'After reading new_message, what would the creature most want to do?',
      criteria: {
        come_closer: 'Move closer to the writer',
        comfort: 'Stay near and be gently comforting',
        celebrate: 'Celebrate and bounce around',
        give_space: 'Back away and give the writer some space',
        hide: 'Hide and shrink away',
        listen: 'Stay still and listen quietly',
        play: 'Play and be silly',
        rest: 'Rest or sleep',
      },
    },
  };
}

export const SITUATION_CRITERIA: Record<string, string> = {
  greeting: 'Saying hello or checking in with the creature',
  goodnight: 'Saying goodnight, going to sleep, or leaving for now',
  win: 'A success, an achievement, or finishing something hard',
  good_news: 'Good news or a happy event',
  gratitude: 'Thanks or appreciation',
  kindness: 'Affection or kindness toward the creature',
  apology: 'An apology',
  insult: 'An insult or attack on the creature',
  loss: 'Losing someone or something, or grief',
  loneliness: 'Feeling alone, left out or disconnected',
  conflict: 'A fight, argument or tension with someone',
  worry: 'Worry or fear about what might happen',
  stress: 'Overwhelm, pressure or too much to do',
  tired: 'Exhaustion, illness or low energy',
  self_criticism: 'Being hard on oneself',
  confusion: 'Not knowing what to do or think',
  change: 'A big change, a beginning or an ending',
  question: 'A question asked to the creature',
  ordinary: 'An ordinary moment or a routine day',
  none: 'None of these',
};

/**
 * Background thinking: asked while nobody is writing. The state describes the creature (mood,
 * temperament, grudges), the time of day, how long since the last entry, and maybe one remembered
 * entry. Memory options are only offered when there is a memory.
 */
export function buildIdleQuestions(hasMemory: boolean): Questions {
  const memory: Record<string, string> = hasMemory
    ? { remember_good: 'Thinking back on the happy moment in memory', remember_hard: 'Still thinking about the hard moment in memory' }
    : {};
  return {
    idle_thought: {
      type: 'choice',
      instructions: 'Right now, with no new message, what is the small creature most likely thinking about?',
      criteria: {
        ...memory,
        miss_writer: 'Missing the writer and wishing they would come back',
        wonder_day: "Wondering how the writer's day is going",
        worried: 'Worrying about the writer',
        grateful: 'Glad the writer is in its life',
        still_hurt: 'Still hurt by how it was treated',
        forgiving: 'Letting go of an old hurt',
        sleepy: 'Getting sleepy',
        bored: 'Feeling a little bored',
        content: 'Calm and content, nothing in particular',
        curious: 'Curious about something new',
        daydream: 'Daydreaming',
      },
    },
    idle_action: {
      type: 'choice',
      instructions: 'What does the creature do next while it waits?',
      criteria: {
        nap: 'Take a nap',
        look_around: 'Look around',
        wait_by_text: 'Wait close to where the writer types',
        wander: 'Drift around a little',
        stretch: 'Stretch',
        hum: 'Hum a little tune',
        sulk: 'Turn away and sulk',
        glow: 'Glow warmly',
      },
    },
  };
}
