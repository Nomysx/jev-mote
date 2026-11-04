import { describe, expect, it } from 'vitest';
import { concentration } from '../shared/math';
import { moodToVisual, VISUAL_KEYS } from '../shared/visuals';
import { applyMessage, decay, grudgeTotal, initialMood, initialTrust, restingState } from '../server/mood/engine';
import { describeTemperament, generateTemperament } from '../server/mood/temperament';
import { TUNING } from '../server/mood/tuning';
import { DAY, HOUR, dist, hostileSignals, kindSignals, signals, temperament } from './helpers';

const T0 = Date.UTC(2026, 10, 1, 9);

describe('temperament', () => {
  it('is deterministic for a seed and varies between seeds', () => {
    expect(generateTemperament(42)).toEqual(generateTemperament(42));
    const many = Array.from({ length: 40 }, (_, i) => generateTemperament(1000 + i));
    expect(new Set(many.map((t) => t.archetype)).size).toBe(5);
    expect(new Set(many.map((t) => t.volatility.toFixed(4))).size).toBe(40);
  });

  it('keeps traits in 0..1 and close to the archetype', () => {
    for (let s = 1; s < 200; s++) {
      const t = generateTemperament(s);
      const spec = TUNING.temperament.archetypes[t.archetype];
      for (const k of ['baselineValence', 'volatility', 'trustSpeed', 'recoverySpeed', 'grudgeMemory', 'lumpiness'] as const) {
        expect(t[k]).toBeGreaterThan(0);
        expect(t[k]).toBeLessThan(1);
        expect(Math.abs(t[k] - spec[k])).toBeLessThanOrEqual(TUNING.temperament.traitJitter + 1e-9);
      }
    }
  });

  it('describes the temperament in words', () => {
    const d = describeTemperament(temperament({ archetype: 'anxious', trustSpeed: 0.2, grudgeMemory: 0.2, volatility: 0.8 }));
    expect(d).toBe('anxious, reacts strongly, slow to trust, quick to forgive');
  });
});

describe('time decay', () => {
  it('drifts back to baseline over time, including while the app is closed', () => {
    const t = temperament();
    let m = applyMessage(initialMood(t, T0), t, hostileSignals(), T0).mood;
    const rest = restingState(t, m.trust, []);
    const dip = Math.abs(m.valence - rest.valence);
    expect(dip).toBeGreaterThan(0.15);
    const later = decay(m, t, T0 + 4 * DAY);
    expect(Math.abs(later.valence - restingState(t, later.trust, later.grudges).valence)).toBeLessThan(0.05);
    expect(later.emotions.calm).toBeGreaterThan(m.emotions.calm);
  });

  it('gives the same result for one long gap and many short steps', () => {
    const t = temperament();
    const m = applyMessage(initialMood(t, T0), t, hostileSignals(), T0).mood;
    const once = decay(m, t, T0 + 30 * HOUR);
    let stepped = m;
    for (let h = 1; h <= 30; h++) stepped = decay(stepped, t, T0 + h * HOUR);
    expect(once.valence).toBeCloseTo(stepped.valence, 3);
    expect(once.trust).toBeCloseTo(stepped.trust, 4);
    expect(grudgeTotal(once.grudges)).toBeCloseTo(grudgeTotal(stepped.grudges), 3);
  });

  it('recovers faster with a higher recovery speed', () => {
    const slow = temperament({ recoverySpeed: 0.1 });
    const fast = temperament({ recoverySpeed: 0.9 });
    const dipSlow = applyMessage(initialMood(slow, T0), slow, hostileSignals(), T0).mood;
    const dipFast = applyMessage(initialMood(fast, T0), fast, hostileSignals(), T0).mood;
    const gap = (t: typeof slow, m: typeof dipSlow) => {
      const d = decay(m, t, T0 + 6 * HOUR);
      return Math.abs(d.valence - restingState(t, d.trust, d.grudges).valence);
    };
    expect(gap(fast, dipFast)).toBeLessThan(gap(slow, dipSlow));
  });

  it('is a no-op for zero or negative elapsed time', () => {
    const t = temperament();
    const m = initialMood(t, T0);
    expect(decay(m, t, T0)).toEqual(m);
    expect(decay(m, t, T0 - HOUR)).toEqual(m);
  });
});

describe('trust', () => {
  /** Three kind messages a day (9:00, 14:00, 20:00) for `days` days. */
  function kindDays(t: ReturnType<typeof temperament>, days: number) {
    let m = initialMood(t, T0);
    const trustByDay: number[] = [];
    for (let d = 0; d < days; d++) {
      for (const h of [0, 5, 11]) m = applyMessage(m, t, kindSignals(), T0 + d * DAY + h * HOUR).mood;
      trustByDay.push(m.trust);
    }
    return { m, trustByDay };
  }

  it('takes about a week of consistent kindness for a slow-trusting blob to go from low to high trust', () => {
    const t = temperament({ trustSpeed: 0.2 });
    expect(initialTrust(t)).toBeLessThan(0.2);
    const { trustByDay } = kindDays(t, 8);
    expect(trustByDay[0]).toBeLessThan(0.35); // not after one day
    expect(trustByDay[2]).toBeLessThan(0.55); // not after three days
    expect(trustByDay[6]).toBeGreaterThan(0.7); // high after a week
  });

  it('is capped per day, however many messages are sent', () => {
    const t = temperament({ trustSpeed: 0.2 });
    let m = initialMood(t, T0);
    for (let i = 0; i < 60; i++) m = applyMessage(m, t, kindSignals(), T0 + i * 10 * 60_000).mood;
    const cap = TUNING.trust.dailyCapBase * (TUNING.trust.speedFloor + t.trustSpeed * TUNING.trust.speedGain);
    expect(m.trust - initialTrust(t)).toBeLessThanOrEqual(cap + 0.01);
  });

  it('grows faster for a blob that trusts easily', () => {
    const slow = kindDays(temperament({ trustSpeed: 0.2 }), 3).m.trust;
    const fast = kindDays(temperament({ trustSpeed: 0.85 }), 3).m.trust;
    expect(fast).toBeGreaterThan(slow + 0.15);
  });

  it('drops after hostility', () => {
    const t = temperament();
    const { m } = kindDays(t, 5);
    const after = applyMessage(m, t, hostileSignals(), T0 + 5 * DAY).mood;
    expect(after.trust).toBeLessThan(m.trust - 0.2);
  });

  it('changes the resting look', () => {
    const t = temperament({ trustSpeed: 0.3 });
    const start = moodToVisual(decay(initialMood(t, T0), t, T0 + 9 * DAY), t);
    const { m } = kindDays(t, 8);
    const rested = moodToVisual(decay(m, t, T0 + 9 * DAY), t);
    expect(rested.scale).toBeGreaterThan(start.scale + 0.1);
    expect(rested.closeness).toBeGreaterThan(start.closeness + 0.3);
    expect(rested.warmth).toBeGreaterThan(start.warmth + 0.1);
  });
});

describe('grudges', () => {
  it('a hostile message leaves a grudge that fades over time', () => {
    const t = temperament({ grudgeMemory: 0.5 });
    const out = applyMessage(initialMood(t, T0), t, hostileSignals(), T0);
    expect(out.grudgeCreated).not.toBeNull();
    expect(out.grudgeCreated!.cause).toBe('hostile');
    const w0 = grudgeTotal(out.mood.grudges);
    const w1 = grudgeTotal(decay(out.mood, t, T0 + DAY).grudges);
    const w7 = grudgeTotal(decay(out.mood, t, T0 + 14 * DAY).grudges);
    expect(w1).toBeLessThan(w0);
    expect(w1).toBeGreaterThan(0);
    expect(w7).toBe(0);
  });

  it('lingers longer with a long grudge memory', () => {
    const short = temperament({ grudgeMemory: 0.1 });
    const long = temperament({ grudgeMemory: 0.9 });
    const left = (t: typeof short) => grudgeTotal(decay(applyMessage(initialMood(t, T0), t, hostileSignals(), T0).mood, t, T0 + 2 * DAY).grudges);
    expect(left(long)).toBeGreaterThan(left(short) + 0.1);
  });

  it('dampens positive reactions while active', () => {
    const t = temperament();
    const clean = initialMood(t, T0 + HOUR);
    const hurt = applyMessage(initialMood(t, T0), t, hostileSignals(), T0).mood;
    const joyClean = applyMessage(clean, t, kindSignals(), T0 + HOUR).mood;
    const joyHurt = applyMessage(hurt, t, kindSignals(), T0 + HOUR).mood;
    expect(joyHurt.emotions.joy).toBeLessThan(joyClean.emotions.joy - 0.1);
    expect(joyHurt.valence).toBeLessThan(joyClean.valence);
  });

  it('is not created by neutral messages', () => {
    const t = temperament();
    expect(applyMessage(initialMood(t, T0), t, signals(), T0).grudgeCreated).toBeNull();
  });
});

describe('reactions', () => {
  it('pulses once on a surprising message, only when there is history to be surprised by', () => {
    const t = temperament();
    const m = initialMood(t, T0);
    expect(applyMessage(m, t, signals({ surprising: 0.7 }), T0).pulse).toBe(true);
    expect(applyMessage(m, t, signals({ surprising: 0.5 }), T0).pulse).toBe(false);
    expect(applyMessage(m, t, signals({ surprising: 0.9 }), T0, { hasHistory: false }).pulse).toBe(false);
  });

  it('turns soft and calm on a distress signal', () => {
    const t = temperament();
    const angry = applyMessage(initialMood(t, T0), t, hostileSignals(), T0).mood;
    const out = applyMessage(angry, t, signals({ distress: 0.8, blobReaction: dist('fear', 0.8) }), T0 + 60_000);
    expect(out.distress).toBe(true);
    expect(out.mood.soothe).toBe(1);
    expect(out.mood.emotions.calm).toBeGreaterThan(0.5);
    const v = moodToVisual(out.mood, t);
    expect(v.spikes).toBeLessThan(0.1);
    expect(v.speed).toBeLessThan(0.5);
  });

  it('scales the reaction by volatility', () => {
    const calm = temperament({ volatility: 0.1 });
    const wild = temperament({ volatility: 0.95 });
    const s = signals({ blobReaction: dist('anger', 0.9), userIntensity: 0.9 });
    const a = applyMessage(initialMood(calm, T0), calm, s, T0).mood.emotions.anger;
    const b = applyMessage(initialMood(wild, T0), wild, s, T0).mood.emotions.anger;
    expect(b).toBeGreaterThan(a * 2);
  });

  it('two freshly born blobs react visibly differently to the same message', () => {
    const a = generateTemperament(101);
    let b = generateTemperament(202);
    for (let s = 203; b.archetype === a.archetype; s++) b = generateTemperament(s);
    const s = hostileSignals();
    const va = moodToVisual(applyMessage(initialMood(a, T0), a, s, T0).mood, a);
    const vb = moodToVisual(applyMessage(initialMood(b, T0), b, s, T0).mood, b);
    const diff = VISUAL_KEYS.reduce((sum, k) => sum + Math.abs(va[k] - vb[k]), 0);
    expect(diff).toBeGreaterThan(0.5);
  });

  it('shows mixed and uncertain emotions differently from clear ones', () => {
    const t = temperament({ volatility: 0.6 });
    const m0 = initialMood(t, T0);
    const clear = moodToVisual(applyMessage(m0, t, signals({ blobReaction: dist('anger', 0.9), blobReactionConfidence: 0.85 }), T0).mood, t);
    const mixedDist = dist('anger', 0.47, 'sadness', 0.45);
    const mixed = moodToVisual(applyMessage(m0, t, signals({ blobReaction: mixedDist, blobReactionConfidence: concentration(mixedDist) }), T0).mood, t);
    const flat = dist('anger', 1 / 7);
    const unsure = moodToVisual(applyMessage(m0, t, signals({ blobReaction: flat, blobReactionConfidence: 0.03 }), T0).mood, t);
    expect(mixed.split).toBeGreaterThan(0.6);
    expect(clear.split).toBeLessThan(0.1);
    expect(mixed.wobble).toBeGreaterThan(clear.wobble + 0.3);
    expect(unsure.haze).toBeGreaterThan(0.7);
    expect(clear.haze).toBeLessThan(0.1);
  });
});
