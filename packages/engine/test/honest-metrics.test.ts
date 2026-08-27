import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { sessionCloseMessage } from '../src/coach/templates';
import {
  computeSkillProfile, punctRatioFromIkis, weakKeyRatioFromKeyIkis,
} from '../src/skill/index';
import type { DiagnosisSnapshot } from '../src/types';

/**
 * Two ways this product could lie to a user, both regression-locked here:
 * comparing incomparable WPM numbers, and scoring a dimension we never
 * measured as if it were perfect.
 */

function snapshot(wpmNet: number): DiagnosisSnapshot {
  return {
    sessionMetrics: {
      wpmNet, wpmRaw: wpmNet + 6, accuracy: 0.981, consistency: 54, rhythm: 73,
      hesitationRate: 5, backspaceRate: 3, correctionTimePct: 0.03,
      keystrokes: 900, errors: 17, corrections: 12, activeMs: 120_000, timingSuspect: false,
    },
    skillProfile: {
      speed: 63, accuracy: 87, consistency: 54, rhythm: 73,
      weakKeyControl: null, punctuation: 46, overall: 68,
      raw: { wpmNet, firstAttemptAccuracy: 0.981, cv: 0.46, residualMad: 0.24, weakKeyRatio: null, punctRatio: 0.46 },
    },
    findings: [],
    tradeoff: { alpha: 0, beta: 0, vControl: 0, vCollapse: 0, headroom: 0, r2: 0, n: 0 },
    bottlenecks: { patterns: [] },
    habits: [],
    confidenceNotes: [],
  };
}

describe('the trend headline compares speed test to speed test', () => {
  it('reports the speed test, not the drill-inflated session net', () => {
    // Session net 72.6 is inflated by the practice block; the speed test is
    // 60.0 and the previous one was 65.4 — the honest read is a drop.
    const msg = sessionCloseMessage({
      snapshot: snapshot(72.6),
      speedTestWpm: 60.0,
      prevSpeedTestWpm: 65.4,
      nextMilestoneWpm: 80,
      wpmPerSession: null,
    });
    expect(msg).toContain('60');
    expect(msg).toMatch(/down 5.4/);
    expect(msg).not.toContain('72.6');   // never headlines the inflated number
    expect(msg).not.toMatch(/up \d/);    // and never invents a gain
  });

  it('still reports a genuine gain when the speed test actually rose', () => {
    const msg = sessionCloseMessage({
      snapshot: snapshot(80),
      speedTestWpm: 68.2,
      prevSpeedTestWpm: 65.4,
      nextMilestoneWpm: null,
      wpmPerSession: null,
    });
    expect(msg).toMatch(/up 2.8/);
  });

  it('milestone estimates are measured from the speed test', () => {
    const msg = sessionCloseMessage({
      snapshot: snapshot(72.6),
      speedTestWpm: 60,
      prevSpeedTestWpm: 59,
      nextMilestoneWpm: 80,
      wpmPerSession: 1,
    });
    // 20 WPM to go at ~1/session → a range around 13–33, never ~7 (which is
    // what the inflated 72.6 would have implied.
    const match = msg.match(/Estimated (\d+)–(\d+) sessions/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(10);
  });

  it('says so plainly when there was no speed test', () => {
    const msg = sessionCloseMessage({
      snapshot: snapshot(72.6),
      speedTestWpm: null,
      prevSpeedTestWpm: 65.4,
      nextMilestoneWpm: 80,
      wpmPerSession: 1,
    });
    expect(msg).toMatch(/no trend reading/i);
  });
});

describe('unmeasured dimensions are never scored as perfect', () => {
  it('weak-key control is null when only common keys have data', () => {
    // A short session: a handful of high-frequency keys, which are also the
    // fastest. Reporting 1.00 here is the bug.
    const thin = new Map<string, number[]>();
    for (const ch of 'etaoni') thin.set(ch, Array(40).fill(120));
    expect(weakKeyRatioFromKeyIkis(thin)).toBeNull();
  });

  it('weak-key control reports once coverage is broad enough', () => {
    const broad = new Map<string, number[]>();
    for (const ch of 'etaonisrhldcumfp') broad.set(ch, Array(25).fill(150));
    for (const ch of 'qzxj') broad.set(ch, Array(25).fill(300));
    const ratio = weakKeyRatioFromKeyIkis(broad);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeLessThan(1); // slow keys pull it below perfect
  });

  it('punctuation is null when no punctuation has been typed', () => {
    expect(punctRatioFromIkis(Array(200).fill(150), [])).toBeNull();
    expect(punctRatioFromIkis(Array(200).fill(150), Array(5).fill(300))).toBeNull();
  });

  it('the composite excludes unmeasured dimensions instead of inflating', () => {
    const measured = computeSkillProfile({
      wpmNet: 73, firstAttemptAccuracy: 0.981, cv: 0.46, residualMad: 0.24,
      weakKeyRatio: null, punctRatio: null,
    });
    expect(measured.weakKeyControl).toBeNull();
    expect(measured.punctuation).toBeNull();

    // Overall is the weighted average of what we DID measure, renormalized.
    const w = CONFIG.skill.weights;
    const denom = w.speed + w.accuracy + w.consistency + w.rhythm;
    const expected =
      (w.speed * measured.speed + w.accuracy * measured.accuracy +
        w.consistency * measured.consistency + w.rhythm * measured.rhythm) / denom;
    expect(measured.overall).toBeCloseTo(expected, 6);

    // And a phantom 100 on the missing dimensions would have scored higher.
    const inflated = computeSkillProfile({
      wpmNet: 73, firstAttemptAccuracy: 0.981, cv: 0.46, residualMad: 0.24,
      weakKeyRatio: 1, punctRatio: 1,
    });
    expect(inflated.overall).toBeGreaterThan(measured.overall);
  });
});
