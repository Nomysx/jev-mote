// Small deterministic math helpers shared by server and client.

export const clamp = (x: number, lo = 0, hi = 1): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Normalize a record of non-negative weights so they sum to 1. Falls back to uniform. */
export function normalize<K extends string>(d: Record<K, number>): Record<K, number> {
  const keys = Object.keys(d) as K[];
  let sum = 0;
  for (const k of keys) {
    const v = Number.isFinite(d[k]) && d[k] > 0 ? d[k] : 0;
    sum += v;
  }
  const out = {} as Record<K, number>;
  for (const k of keys) {
    const v = Number.isFinite(d[k]) && d[k] > 0 ? d[k] : 0;
    out[k] = sum > 0 ? v / sum : 1 / keys.length;
  }
  return out;
}

/** Concentration of a distribution: 1 - H(p)/ln(N). Same definition Ollama uses for `confidence`. */
export function concentration(d: Record<string, number>): number {
  const vals = Object.values(d);
  const n = vals.length;
  if (n < 2) return 1;
  let h = 0;
  for (const p of vals) if (p > 0) h -= p * Math.log(p);
  return clamp(1 - h / Math.log(n));
}

/** The two most likely keys with their probabilities. */
export function topTwo<K extends string>(d: Record<K, number>): [[K, number], [K, number]] {
  const entries = (Object.entries(d) as [K, number][]).sort((a, b) => b[1] - a[1]);
  return [entries[0], entries[1] ?? entries[0]];
}

/** Mix two distributions with the same keys: (1-t)*a + t*b. */
export function mixDist<K extends string>(a: Record<K, number>, b: Record<K, number>, t: number): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of Object.keys(a) as K[]) out[k] = (1 - t) * a[k] + t * (b[k] ?? 0);
  return normalize(out);
}

/** Mulberry32: tiny seeded PRNG, returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shortest signed distance between two hues on a 0..1 wheel. */
export function hueDelta(from: number, to: number): number {
  let d = (to - from) % 1;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

export const mixHue = (a: number, b: number, t: number): number => (((a + hueDelta(a, b) * t) % 1) + 1) % 1;

/** Fully saturated RGB (0..1) for a hue on a 0..1 wheel. */
export function hueToRgb(h: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

export function rgbToHue([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 1e-6) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (((h / 6) % 1) + 1) % 1;
}

/**
 * Tint hue `a` toward hue `b` by mixing in RGB, so far-apart hues (blue -> yellow) blend through
 * soft in-between colors instead of rotating around the wheel through unrelated ones (green).
 */
export function mixHueRgb(a: number, b: number, t: number): number {
  const ca = hueToRgb(a);
  const cb = hueToRgb(b);
  const m: [number, number, number] = [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
  const max = Math.max(...m);
  const min = Math.min(...m);
  return max - min < 0.02 ? a : rgbToHue(m);
}
