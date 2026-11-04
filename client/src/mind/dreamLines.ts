// Words for Mote's dreams and for waking up. Like its thoughts, these are written in advance: the
// decision model only chooses where the dream goes, what happens, how it feels and how it ends.
// (Kept apart from lines.ts, which holds the 1024 thought lines.)

import type { DreamEnding, DreamEvent, DreamPlace, Greeting } from '../../../shared/types';

export const DREAM_EVENT_LINES: Record<DreamEvent, string[]> = {
  flying: ['i was flying', 'up and up, so light', 'nothing could hold me down', 'the wind carried me'],
  falling: ['i was falling…', 'down, down, slowly', 'the ground kept moving away', 'falling, but softly'],
  chased: ['something followed me', 'i ran and ran', 'it was right behind me', "i couldn't stop running"],
  lost: ["i couldn't find the way back", 'everything looked the same', 'where were you?', 'lost, and so small'],
  searching: ['i was looking for something', 'looking everywhere', 'something important was missing', 'i almost had it'],
  floating: ['just floating', 'no up, no down', 'drifting, so quiet', 'weightless'],
  held: ['something held me close', 'warm, so warm', 'safe, all around me', 'held, like a hug'],
  reunion: ['you were there!', 'we found each other', 'someone i missed was there', 'together again'],
  storm: ['a storm, so loud', 'the wind was angry', 'thunder everywhere', 'rain, rain, rain'],
  melting: ['i was melting', 'everything went soft', 'i kept changing shape', 'runny, wobbly, strange'],
  growing: ['i grew so big', 'bigger than the clouds', 'i filled the whole sky', 'huge, and getting bigger'],
  shrinking: ['i got so tiny', 'smaller and smaller', 'everything was enormous', 'tiny as a seed'],
};

export const DREAM_PLACE_LINES: Record<DreamPlace, string[]> = {
  sky: ['…over the clouds', '…high in the sky'],
  sea: ['…in the deep sea', '…under the water'],
  forest: ['…in a quiet forest', '…among the trees'],
  city: ['…in a city of lights', '…in a busy crowd'],
  home: ['…in a house i knew', '…in a familiar room'],
  school: ['…in a big school', '…somewhere like work'],
  space: ['…out among the stars', '…far past the moon'],
  dark: ['…somewhere dark', "…where i couldn't see"],
};

export const DREAM_ENDING_LINES: Record<DreamEnding, string[]> = {
  peaceful: ['and then it was quiet', 'and it was okay', 'and everything was calm'],
  woke_suddenly: ['and then — i woke up!', 'oh! i woke up', 'then a jolt, and i was awake'],
  faded: ['and then it faded', 'and the rest is gone', "i don't remember the end"],
  transformed: ['and then i was something else', 'and everything changed', 'and it all turned new'],
  found: ['and i found it!', 'and it all worked out', 'and then i found you'],
};

export const DREAM_INTRO_LINES = ['i had a dream…', 'last night…', 'i dreamed…', 'a dream came…', 'i saw a dream'];
export const REMEMBERED_INTRO_LINES = ['oh! i remember my dream', 'wait, i dreamed something', 'a dream comes back to me'];

/** Woken up (by an entry, a poke, or the morning). */
export const WOKEN_LINES = ["mm? oh, it's you", 'five more minutes…', 'was i asleep?', 'huh… hi', 'mmh… morning?', 'i was dreaming…', '*yawn*', "oh! you're here"];
export const NIGHTMARE_LINES = ['a bad dream…', 'oh! just a dream', "it's okay, it's okay", 'phew. only a dream'];

/** Greetings when the writer comes back (joyful and warm reuse the "greeting" thoughts). */
export const GREETING_LINES: Partial<Record<Greeting, string[]>> = {
  sulky: ["oh. it's you", 'hmph.', '…hi', 'you again'],
  sleepy: ['*yawn* hi', 'mm, hi…', 'sleepy hello', 'oh… hello'],
};

/** "Flying over the clouds" for lists. */
export const DREAM_TITLES: Record<DreamEvent, string> = {
  flying: 'Flying',
  falling: 'Falling',
  chased: 'Being chased',
  lost: 'Lost',
  searching: 'Searching',
  floating: 'Floating',
  held: 'Held close',
  reunion: 'A reunion',
  storm: 'A storm',
  melting: 'Melting',
  growing: 'Growing huge',
  shrinking: 'Shrinking',
};

export const PLACE_WORDS: Record<DreamPlace, string> = {
  sky: 'in the sky',
  sea: 'in the sea',
  forest: 'in a forest',
  city: 'in a city',
  home: 'at home',
  school: 'at school',
  space: 'in space',
  dark: 'in the dark',
};
