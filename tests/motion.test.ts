import { describe, expect, it } from 'vitest';
import { GESTURE_DURATION, GestureRig, gesturePose, type GestureKind, type Pose } from '../client/src/blob/gestures';
import { moodPitch, moodTempo, voiceFromTemperament } from '../client/src/audio/voice';
import { generateTemperament } from '../server/mood/temperament';
import { temperament } from './helpers';

const KINDS = Object.keys(GESTURE_DURATION) as GestureKind[];
const magnitude = (p: Pose) => Object.values(p).reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('gestures', () => {
  it('start and end at rest, so nothing ever snaps', () => {
    for (const k of KINDS) {
      const d = GESTURE_DURATION[k];
      expect(magnitude(gesturePose(k, 0, 1)), `${k} at start`).toBeLessThan(0.12);
      expect(magnitude(gesturePose(k, d * 0.999, 1)), `${k} at end`).toBeLessThan(0.005);
      expect(magnitude(gesturePose(k, d + 0.1, 1)), `${k} after end`).toBe(0);
    }
  });

  it('move smoothly: no big jumps between 60 fps frames', () => {
    // wobble is a noise amplitude the shader scales by 0.14, so it may step a little faster.
    const maxStep = (key: keyof Pose) => (key === 'wobble' ? 0.15 : 0.08);
    for (const k of KINDS) {
      let prev = gesturePose(k, 0, 1);
      for (let t = 1 / 60; t < GESTURE_DURATION[k]; t += 1 / 60) {
        const p = gesturePose(k, t, 1);
        for (const key of Object.keys(p) as (keyof Pose)[]) {
          expect(Math.abs(p[key] - prev[key]), `${k}.${key} at ${t.toFixed(2)}s`).toBeLessThan(maxStep(key));
        }
        prev = p;
      }
    }
  });

  it('stay within sensible bounds and are visible', () => {
    for (const k of KINDS) {
      let peak = 0;
      for (let t = 0; t < GESTURE_DURATION[k]; t += 0.01) {
        const p = gesturePose(k, t, 1);
        expect(Number.isFinite(magnitude(p))).toBe(true);
        expect(Math.abs(p.squash), k).toBeLessThan(0.3);
        expect(Math.abs(p.scale), k).toBeLessThan(0.2);
        peak = Math.max(peak, magnitude(p));
      }
      expect(peak, `${k} should actually move`).toBeGreaterThan(0.02);
    }
  });

  it('give each emotion its own body language', () => {
    const peakOf = (k: GestureKind, key: keyof Pose) => {
      let m = 0;
      for (let t = 0; t < GESTURE_DURATION[k]; t += 0.01) m = Math.max(m, Math.abs(gesturePose(k, t)[key]));
      return m;
    };
    expect(peakOf('joy', 'y')).toBeGreaterThan(0.2); // hops
    expect(peakOf('anger', 'spikes')).toBeGreaterThan(0.3); // flares
    expect(peakOf('fear', 'z')).toBeGreaterThan(0.3); // flinches back
    expect(peakOf('curiosity', 'roll')).toBeGreaterThan(0.15); // tilts
    expect(peakOf('disgust', 'yaw')).toBeGreaterThan(0.25); // turns away
    expect(peakOf('soothe', 'x')).toBe(0); // the safeguard never shakes
  });

  it('are calmer with reduced motion', () => {
    const full = new GestureRig(1);
    const reduced = new GestureRig(0.35);
    full.play('anger', 0);
    reduced.play('anger', 0);
    expect(Math.abs(reduced.pose(0.2).x)).toBeLessThan(Math.abs(full.pose(0.2).x) * 0.2);
  });

  it('layer and expire in the rig', () => {
    const rig = new GestureRig();
    rig.play('joy', 0);
    rig.play('pulse', 0.1);
    expect(rig.isPlaying(0.2)).toBe(true);
    expect(magnitude(rig.pose(0.2))).toBeGreaterThan(0);
    expect(rig.isPlaying(5)).toBe(false);
    expect(magnitude(rig.pose(5))).toBe(0);
  });
});

describe('voices', () => {
  it('are fixed by the seed', () => {
    const t = generateTemperament(777);
    expect(voiceFromTemperament(t)).toEqual(voiceFromTemperament(generateTemperament(777)));
  });

  it('differ between blobs', () => {
    const voices = Array.from({ length: 30 }, (_, i) => voiceFromTemperament(generateTemperament(5000 + i)));
    expect(new Set(voices.map((v) => v.base.toFixed(1))).size).toBeGreaterThan(25);
    expect(new Set(voices.map((v) => `${v.fmRatio}/${v.wave}`)).size).toBeGreaterThan(3);
  });

  it('follow the archetype: a stoic blob sounds lower than an anxious one', () => {
    const stoic = voiceFromTemperament(temperament({ archetype: 'stoic', seed: 3 }));
    const anxious = voiceFromTemperament(temperament({ archetype: 'anxious', seed: 3 }));
    expect(stoic.base).toBeLessThan(anxious.base);
    for (let s = 1; s < 50; s++) {
      const v = voiceFromTemperament(generateTemperament(s));
      expect(v.base).toBeGreaterThan(120);
      expect(v.base).toBeLessThan(400);
    }
  });

  it('are colored by mood: higher when happy, faster when aroused', () => {
    const v = voiceFromTemperament(temperament());
    expect(moodPitch({ valence: 1, arousal: 0.3, trust: 0.5, clarity: 0.8 })).toBeGreaterThan(1);
    expect(moodPitch({ valence: -1, arousal: 0.3, trust: 0.5, clarity: 0.8 })).toBeLessThan(1);
    expect(moodTempo(v, { valence: 0, arousal: 1, trust: 0.5, clarity: 0.8 })).toBeLessThan(moodTempo(v, { valence: 0, arousal: 0, trust: 0.5, clarity: 0.8 }));
  });
});
