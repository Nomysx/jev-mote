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
    instructions: 'Is new_message unexpected given recent_messages and current_mood?',
    yes: 'new_message is a sharp change in feeling or topic from what came before',
    no: 'new_message fits what came before',
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
  };
}
