// Temperament at birth: an archetype plus seeded jitter. The same seed always gives the same blob.

import { randomInt } from 'node:crypto';
import { clamp, mulberry32 } from '../../shared/math';
import { ARCHETYPES, type Temperament } from '../../shared/types';
import { TUNING } from './tuning';

export function randomSeed(): number {
  return randomInt(1, 2 ** 31 - 1);
}

export function generateTemperament(seed: number): Temperament {
  const rnd = mulberry32(seed);
  const archetype = ARCHETYPES[Math.floor(rnd() * ARCHETYPES.length)];
  const spec = TUNING.temperament.archetypes[archetype];
  const j = TUNING.temperament.traitJitter;
  const jitter = (v: number, amount = j) => clamp(v + (rnd() * 2 - 1) * amount, 0.02, 0.98);
  const hue = (((spec.hue + (rnd() * 2 - 1) * TUNING.temperament.hueJitter) % 1) + 1) % 1;
  return {
    seed,
    archetype,
    baselineValence: jitter(spec.baselineValence),
    volatility: jitter(spec.volatility),
    trustSpeed: jitter(spec.trustSpeed),
    recoverySpeed: jitter(spec.recoverySpeed),
    grudgeMemory: jitter(spec.grudgeMemory),
    hue,
    lumpiness: jitter(spec.lumpiness),
  };
}

/** Temperament in words, for the decision model's state (e.g. "anxious, slow to trust, quick to forgive"). */
export function describeTemperament(t: Temperament): string {
  const words: string[] = [t.archetype];
  if (t.volatility > 0.65) words.push('reacts strongly');
  else if (t.volatility < 0.35) words.push('hard to rattle');
  if (t.trustSpeed < 0.35) words.push('slow to trust');
  else if (t.trustSpeed > 0.65) words.push('trusts easily');
  if (t.grudgeMemory < 0.35) words.push('quick to forgive');
  else if (t.grudgeMemory > 0.65) words.push('holds grudges');
  if (t.recoverySpeed > 0.65) words.push('bounces back fast');
  else if (t.recoverySpeed < 0.35) words.push('slow to recover');
  if (t.baselineValence > 0.62) words.push('generally upbeat');
  else if (t.baselineValence < 0.42) words.push('a little gloomy');
  return words.join(', ');
}
