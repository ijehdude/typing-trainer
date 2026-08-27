import { describe, expect, it } from 'vitest';
import {
  accuracyScore, computeSkillProfile, punctuationScore, speedScore,
  updateComposite, weakKeyRatioFromKeyIkis,
} from '../src/skill/index';

describe('Skill Profile — §8.1 reference fixture', () => {
  it('reproduces the PRD §8.1 table exactly', () => {
    // Raw values from the PRD's example user.
    const profile = computeSkillProfile({
      wpmNet: 82,
      firstAttemptAccuracy: 0.974,
      cv: 0.09,
      residualMad: 0.144,
      weakKeyRatio: 1 / 1.37,
      punctRatio: 0.61,
    });
    expect(Math.round(profile.speed)).toBe(72);        // 82 WPM → 72
    expect(Math.round(profile.accuracy)).toBe(82);     // 97.4% → 82
    expect(Math.round(profile.consistency)).toBe(91);  // CV 0.09 → 91
    expect(Math.round(profile.rhythm)).toBe(84);       // MAD 0.144 → 84
    expect(Math.round(profile.weakKeyControl!)).toBe(73); // 1.37× gap → 73
    expect(Math.round(profile.punctuation!)).toBe(61);
    expect(Math.round(profile.overall)).toBe(78);      // composite → 78/100
  });
});

describe('dimension formulas (PRD §8.2)', () => {
  it('speed anchors', () => {
    expect(speedScore(20)).toBe(10);
    expect(speedScore(60)).toBe(50);
    expect(speedScore(80)).toBe(70);
    expect(speedScore(100)).toBe(85);
    expect(speedScore(140)).toBe(100);
    expect(speedScore(200)).toBe(100);
    expect(speedScore(10)).toBe(5); // below first anchor: linear to 0
  });

  it('accuracy anchors (PRD anchors are rounded; formula is authoritative)', () => {
    const anchors: Array<[number, number]> = [
      [0.995, 97], [0.99, 93], [0.98, 87], [0.97, 79], [0.95, 64], [0.92, 35],
    ];
    for (const [acc, score] of anchors) {
      expect(Math.abs(accuracyScore(acc) - score)).toBeLessThanOrEqual(0.6);
    }
    expect(accuracyScore(0.90)).toBe(0); // below 90% you are guessing
    expect(accuracyScore(0.85)).toBe(0);
  });

  it('weak-key ratio: perfectly even typist scores 1, slow keys pull it down', () => {
    // Needs ≥ weakKeyMinKeys distinct keys with data, or the dimension is
    // reported as unmeasured rather than guessed (see honest-metrics.test.ts).
    const fast = 'abcdefghijklmnop';  // 16 keys
    const slow = 'qrstu';             // 5 keys
    const even = new Map<string, number[]>();
    const uneven = new Map<string, number[]>();
    for (const ch of fast) {
      even.set(ch, Array(25).fill(150));
      uneven.set(ch, Array(25).fill(150));
    }
    for (const ch of slow) uneven.set(ch, Array(25).fill(300));

    expect(weakKeyRatioFromKeyIkis(even)!).toBeCloseTo(1, 5);
    const n = fast.length + slow.length;
    const expected =
      Math.exp((fast.length / n) * Math.log(150) + (slow.length / n) * Math.log(300)) / 300;
    expect(weakKeyRatioFromKeyIkis(uneven)!).toBeCloseTo(expected, 5);
  });

  it('punctuation score clamps at 100 when punct is as fast as letters', () => {
    expect(punctuationScore(1.2)).toBe(100);
    expect(punctuationScore(0.61)!).toBeCloseTo(61, 5);
    expect(punctuationScore(null)).toBeNull(); // unmeasured is not a perfect score
  });
});

describe('score integrity (PRD §8.4)', () => {
  it('one session can never move the composite more than 3 points', () => {
    expect(updateComposite(70, 95)).toBe(73);
    expect(updateComposite(70, 40)).toBe(67);
  });

  it('EWMA applies within the clamp', () => {
    // 70 + 0.25·(78−70) = 72 — inside the ±3 window.
    expect(updateComposite(70, 78)).toBeCloseTo(72, 5);
  });

  it('first session sets the score directly', () => {
    expect(updateComposite(null, 63)).toBe(63);
  });
});
