import { describe, expect, it } from 'vitest';
import { qwertyUs } from '@typing-trainer/content';
import { analyzeBlock } from '../src/capture/analyze';
import { firstAttemptAccuracy, mean, netWpm } from '../src/metrics/index';
import { COHORT, defaultProfile, simulateTyping } from '../src/simulator/index';

const TEXT = 'the quick brown fox jumps over the lazy dog and then it ran back home again '.repeat(10);

describe('synthetic typist (PRD Appendix C)', () => {
  it('is deterministic given a seed', () => {
    const p = defaultProfile();
    const a = simulateTyping(p, TEXT, qwertyUs, { seed: 42 });
    const b = simulateTyping(p, TEXT, qwertyUs, { seed: 42 });
    expect(a).toEqual(b);
    const c = simulateTyping(p, TEXT, qwertyUs, { seed: 43 });
    expect(a).not.toEqual(c);
  });

  it('produces a stream the capture layer accepts cleanly', () => {
    const stream = simulateTyping(defaultProfile(), TEXT, qwertyUs, { seed: 7 });
    const block = analyzeBlock(stream, qwertyUs, TEXT);
    expect(block.timingSuspect).toBe(false);
    expect(block.keystrokes.length).toBeGreaterThanOrEqual(TEXT.length);
    const included = block.keystrokes.filter((k) => !k.excludedFromTiming);
    expect(included.length).toBeGreaterThan(TEXT.length * 0.6);
  });

  it('accurate-slow beginner types slow and precise', () => {
    const stream = simulateTyping(COHORT['accurateSlowBeginner']!, TEXT, qwertyUs, { seed: 11 });
    const block = analyzeBlock(stream, qwertyUs, TEXT);
    const correctChars = block.keystrokes.filter((k) => k.correct && !k.isCorrection).length;
    const wpm = netWpm(correctChars, block.activeMs);
    expect(wpm).toBeGreaterThan(20);
    expect(wpm).toBeLessThan(45);
    expect(firstAttemptAccuracy(block.keystrokes)).toBeGreaterThan(0.98);
  });

  it('planted hand imbalance is recoverable from the stream (ground truth)', () => {
    const stream = simulateTyping(COHORT['handImbalanced']!, TEXT, qwertyUs, { seed: 5 });
    const block = analyzeBlock(stream, qwertyUs, TEXT);
    const ikisByHand = { L: [] as number[], R: [] as number[] };
    for (const k of block.keystrokes) {
      if (k.iki !== null && !k.excludedFromTiming && k.hand && k.key !== ' ') {
        ikisByHand[k.hand].push(k.iki);
      }
    }
    expect(ikisByHand.L.length).toBeGreaterThan(50);
    expect(ikisByHand.R.length).toBeGreaterThan(50);
    // Profile plants right-hand multipliers 1.18–1.4; the measured gap must show it.
    expect(mean(ikisByHand.R) / mean(ikisByHand.L)).toBeGreaterThan(1.08);
  });

  it('visual searcher shows planted per-key latency on p', () => {
    const text = 'pap pep pip pop pup apa epe ipi opo upu '.repeat(15);
    const stream = simulateTyping(COHORT['visualSearcher']!, text, qwertyUs, { seed: 9 });
    const block = analyzeBlock(stream, qwertyUs, text);
    const pIkis: number[] = [];
    const aIkis: number[] = [];
    for (const k of block.keystrokes) {
      if (k.iki === null || k.excludedFromTiming) continue;
      if (k.key === 'p') pIkis.push(k.iki);
      if (k.key === 'a') aIkis.push(k.iki);
    }
    expect(pIkis.length).toBeGreaterThan(30);
    expect(mean(pIkis) / mean(aIkis)).toBeGreaterThan(1.4);
  });

  it('overdriver makes more errors than the beginner at speed', () => {
    const fast = simulateTyping(COHORT['plateauedOverdriver']!, TEXT, qwertyUs, { seed: 3 });
    const slow = simulateTyping(COHORT['accurateSlowBeginner']!, TEXT, qwertyUs, { seed: 3 });
    const accFast = firstAttemptAccuracy(analyzeBlock(fast, qwertyUs, TEXT).keystrokes);
    const accSlow = firstAttemptAccuracy(analyzeBlock(slow, qwertyUs, TEXT).keystrokes);
    expect(accFast).toBeLessThan(accSlow);
  });
});
