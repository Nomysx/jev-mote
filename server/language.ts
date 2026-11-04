// A conservative, fully local guess at whether a message is *not* English.
// Used only to keep non-English messages away from English-only models. When unsure, it says English.

const EN = new Set(
  'the a an and or but i me my mine you your it its is am are was were be been being have has had do does did not no so to of in on at for with from by about as that this these those what which who when where why how all just very really too can could would should will today feel felt like im i\'m it\'s don\'t didn\'t can\'t we us our they them their he she him her his there here then than if because been got get going went'.split(
    ' ',
  ),
);

const OTHER: Record<string, string[]> = {
  es: 'el la los las un una y o pero que de en por para con sin es soy estoy está muy hoy me mi yo tu se lo le del al como más mucho porque cuando también pero'.split(' '),
  fr: 'le la les un une et ou mais que qui de du des en dans pour avec sans est suis je tu il elle nous vous très aujourd\'hui mon ma mes pas ne ce cette parce quand aussi'.split(' '),
  de: 'der die das ein eine und oder aber dass nicht ich du er sie wir ihr ist bin sehr heute mein meine mit ohne für auf auch weil wenn noch schon'.split(' '),
  it: 'il lo la gli le un una e o ma che di da in per con senza sono sei è molto oggi mio mia non perché quando anche io tu'.split(' '),
  pt: 'o a os as um uma e ou mas que de em por para com sem é sou estou muito hoje meu minha não eu você porque quando também'.split(' '),
  nl: 'de het een en of maar dat niet ik jij hij zij wij is ben zeer vandaag mijn met zonder voor ook omdat als'.split(' '),
};
const OTHER_SETS = Object.fromEntries(Object.entries(OTHER).map(([k, v]) => [k, new Set(v)]));

export interface LanguageGuess {
  nonEnglish: boolean;
  reason: 'script' | 'words' | null;
}

export function guessLanguage(text: string): LanguageGuess {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 3) return { nonEnglish: false, reason: null };
  const nonLatin = letters.filter((ch) => !/\p{Script=Latin}/u.test(ch)).length;
  if (nonLatin / letters.length > 0.3) return { nonEnglish: true, reason: 'script' };

  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (words.length < 4) return { nonEnglish: false, reason: null };
  let en = 0;
  for (const w of words) if (EN.has(w)) en++;
  let bestOther = 0;
  for (const set of Object.values(OTHER_SETS)) {
    let n = 0;
    for (const w of words) if (set.has(w) && !EN.has(w)) n++;
    bestOther = Math.max(bestOther, n);
  }
  const accented = letters.filter((ch) => /[À-ÖØ-öø-ÿĀ-ž]/u.test(ch)).length;
  const enShare = en / words.length;
  if (bestOther >= 2 && bestOther > en && enShare < 0.15) return { nonEnglish: true, reason: 'words' };
  if (accented / letters.length > 0.04 && enShare < 0.08 && words.length >= 6) return { nonEnglish: true, reason: 'words' };
  return { nonEnglish: false, reason: null };
}
