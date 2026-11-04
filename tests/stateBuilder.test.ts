import { describe, expect, it } from 'vitest';
import { Catalog } from '../server/decision/catalog';
import { buildState, type HistoryItem } from '../server/decision/stateBuilder';
import { estimateJsonTokens } from '../server/decision/tokens';
import { applyMessage, initialMood } from '../server/mood/engine';
import { HOUR, hostileSignals, temperament } from './helpers';

const NOW = Date.UTC(2026, 10, 4, 12);
const catalog = new Catalog();
const laya = catalog.find('laya')!;
const nimble = catalog.find('nimble')!;
const tev1 = catalog.find('tev1')!;

function history(n: number, words = 30): HistoryItem[] {
  return Array.from({ length: n }, (_, i) => ({
    text: `Entry number ${i}: ` + 'today I thought about many things and wrote them down here '.repeat(Math.ceil(words / 11)).trim(),
    at: NOW - (n - i) * 3 * HOUR,
  }));
}

const t = temperament({ archetype: 'anxious' });
const mood = initialMood(t, NOW);

describe('buildState', () => {
  it('puts new_message first and keeps it complete, with all fields for regular models', () => {
    const msg = 'I had a long day. '.repeat(10).trim();
    const hurt = applyMessage(mood, t, hostileSignals(), NOW - HOUR).mood;
    const b = buildState({ newMessage: msg, history: history(10), mood: hurt, temperament: t, now: NOW }, tev1);
    expect(Object.keys(b.state)).toEqual(['new_message', 'current_mood', 'temperament', 'grudges', 'recent_messages']);
    expect(b.state.new_message).toBe(msg);
    expect(b.state.temperament).toContain('anxious');
    expect(b.state.current_mood).toMatch(/^[a-z ]+, .*valence -?\d\.\d\d.*trust \d\.\d\d/);
    expect(b.state.grudges![0]).toMatch(/^insulted 1 hour ago, (still|a little) hurt$/);
  });

  it('fits compact small-budget profiles: at most 3 short recent messages, no grudges field', () => {
    const compact = { maxStateTokens: 300, maxRecentMessages: 3, recentMessageMaxChars: 140, compactState: true };
    const hurt = applyMessage(mood, t, hostileSignals(), NOW - HOUR).mood;
    const b = buildState({ newMessage: 'Hello again.', history: history(30, 80), mood: hurt, temperament: t, now: NOW }, compact);
    expect(b.state.recent_messages!.length).toBeLessThanOrEqual(3);
    expect(b.state.recent_messages!.length).toBeGreaterThan(0);
    expect(b.state.grudges).toBeUndefined();
    expect(b.state.current_mood).toContain('hurt');
    expect(b.estimatedTokens).toBeLessThanOrEqual(300);
    for (const r of b.state.recent_messages!) expect(r.text.length).toBeLessThanOrEqual(140);
  });

  it('sends Laya only the new message and a numbers-only mood (it mixes state words into its answers)', () => {
    const hurt = applyMessage(mood, t, hostileSignals(), NOW - HOUR).mood;
    const b = buildState({ newMessage: 'Hello again.', history: history(30, 80), mood: hurt, temperament: t, now: NOW }, laya);
    expect(Object.keys(b.state)).toEqual(['new_message', 'current_mood']);
    expect(b.state.current_mood).toMatch(/^valence -?\d\.\d\d, arousal \d\.\d\d, trust \d\.\d\d, grudge \d\.\d\d$/);
    expect(b.estimatedTokens).toBeLessThanOrEqual(laya.maxStateTokens);
  });

  it('drops the oldest messages first', () => {
    const items = history(40, 40);
    const b = buildState({ newMessage: 'ok', history: items, mood, temperament: t, now: NOW }, { ...tev1, maxRecentMessages: 40 });
    expect(b.droppedMessages).toBeGreaterThan(0);
    const kept = b.state.recent_messages!.map((r) => r.text);
    // The newest message is kept, the oldest is gone.
    expect(kept[kept.length - 1]).toContain('Entry number 39');
    expect(kept.some((k) => k.includes('Entry number 0:'))).toBe(false);
    expect(b.estimatedTokens).toBeLessThanOrEqual(tev1.maxStateTokens);
  });

  it('then shortens long old messages', () => {
    const items = history(2, 400);
    const b = buildState({ newMessage: 'short', history: items, mood, temperament: t, now: NOW }, { ...tev1, maxStateTokens: 400, recentMessageMaxChars: 5000 });
    expect(b.shortenedMessages).toBeGreaterThan(0);
    expect(b.state.recent_messages!.length).toBeGreaterThan(0);
    expect(b.state.recent_messages!.some((r) => r.text.endsWith('…'))).toBe(true);
    expect(b.estimatedTokens).toBeLessThanOrEqual(400);
  });

  it('never cuts the new message, even when it alone is over budget', () => {
    const huge = 'This is a very long entry about everything that happened. '.repeat(200);
    const b = buildState({ newMessage: huge, history: history(10), mood, temperament: t, now: NOW }, tev1);
    expect(b.state.new_message).toBe(huge);
    expect(b.state.recent_messages).toEqual([]);
    expect(b.overBudget).toBe(true);
  });

  it('keeps more history for big-context models', () => {
    const items = history(30, 20);
    const small = buildState({ newMessage: 'hi', history: items, mood, temperament: t, now: NOW }, laya);
    const big = buildState({ newMessage: 'hi', history: items, mood, temperament: t, now: NOW }, nimble);
    expect(big.state.recent_messages!.length).toBeGreaterThan((small.state.recent_messages?.length ?? 0) + 5);
    expect(big.estimatedTokens).toBeLessThanOrEqual(nimble.maxStateTokens);
  });

  it('labels recent messages with relative times', () => {
    const b = buildState(
      { newMessage: 'hi', history: [{ text: 'yesterday thing', at: NOW - 30 * HOUR }, { text: 'recent', at: NOW - 2 * HOUR }], mood, temperament: t, now: NOW },
      nimble,
    );
    expect(b.state.recent_messages!.map((r) => r.when)).toEqual(['yesterday', '2 hours ago']);
  });

  it('estimates tokens conservatively', () => {
    expect(estimateJsonTokens('a'.repeat(350))).toBe(100);
    expect(estimateJsonTokens('日本語')).toBeGreaterThanOrEqual(3);
  });
});
