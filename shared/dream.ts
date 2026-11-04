// Small pure helpers for dreams, shared by the server (making them) and the client (replaying them).

const STOPWORDS = new Set(
  (
    'about above after again against because been before being below between both could does doing down during each ' +
    'from further have having here hers herself himself into itself just more most myself once only other ourselves ' +
    'over same should some such than that their theirs them themselves then there these they this those through ' +
    'under until very were what when where which while whom with would your yours yourself yourselves really today ' +
    'yesterday tomorrow maybe still also even much many like just feel feels felt think thought know knew going gonna ' +
    'want wanted thing things something anything nothing everything someone anyone everyone always never every ' +
    "didn't don't doesn't can't won't wasn't isn't aren't i'm i've i'll it's that's there's what's you're they're " +
    'mote blob little kinda sort pretty quite'
  ).split(/\s+/),
);

/**
 * Words from the writer's entries that drift through a dream: the longest distinct words that are
 * not filler, in the order they appeared. Works for any language (filler is only removed for English).
 */
export function dreamFragments(texts: string[], max = 6): string[] {
  const seen = new Set<string>();
  const words: { w: string; order: number }[] = [];
  let order = 0;
  for (const text of texts) {
    for (const raw of text.match(/[\p{L}\p{M}'’-]+/gu) ?? []) {
      const w = raw.replace(/^['’-]+|['’-]+$/g, '');
      const key = w.toLowerCase().replace(/’/g, "'");
      if ([...key].length < 4 || STOPWORDS.has(key) || seen.has(key)) continue;
      seen.add(key);
      words.push({ w: w.toLowerCase(), order: order++ });
    }
  }
  return words
    .sort((a, b) => [...b.w].length - [...a.w].length || a.order - b.order)
    .slice(0, max)
    .sort((a, b) => a.order - b.order)
    .map((x) => x.w);
}

/** The most likely key of a distribution. */
export function topKey<K extends string>(d: Record<K, number>): K {
  return (Object.entries(d) as [K, number][]).sort((a, b) => b[1] - a[1])[0][0];
}

/** The second most likely key and its probability. */
export function secondKey<K extends string>(d: Record<K, number>): [K, number] {
  return (Object.entries(d) as [K, number][]).sort((a, b) => b[1] - a[1])[1];
}
