// A deliberately conservative token estimate. Real tokenizers differ per model; overestimating is
// safer than overflowing a small context (e.g. Laya's 512 tokens per question).

export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  // ~3.5 ASCII chars per token; non-ASCII characters (accents, CJK, emoji) often cost a token or more each.
  return Math.ceil(ascii / 3.5 + other * 1.2);
}

export function estimateJsonTokens(value: unknown): number {
  return estimateTokens(typeof value === 'string' ? value : JSON.stringify(value));
}
