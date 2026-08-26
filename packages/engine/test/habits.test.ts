import { describe, expect, it } from 'vitest';
import { qwertyUs } from '@typing-trainer/content';
import { analyzeBlock } from '../src/capture/analyze';
import { detectHabits, handIkiRatio } from '../src/habits/index';
import { extractObservations } from '../src/model/observations';
import { fitModel, ZERO_PRIOR } from '../src/model/ridge';
import { extractTradeoffPoints, fitTradeoff } from '../src/model/tradeoff';
import { COHORT, simulateTyping } from '../src/simulator/index';
import type { SessionMetrics } from '../src/types';

const TEXT =
  ('the quick brown fox jumps over the lazy dog while happy people prepare a proper supper ' +
    'and the quiet queen quizzed a dozen dizzy zebras by the quay ').repeat(10);

const metrics = (over: Partial<SessionMetrics> = {}): SessionMetrics => ({
  wpmNet: 70, wpmRaw: 76, accuracy: 0.97, consistency: 88, rhythm: 78,
  hesitationRate: 4, backspaceRate: 3, correctionTimePct: 0.03,
  keystrokes: 4000, errors: 90, corrections: 80, activeMs: 600_000, timingSuspect: false,
  ...over,
});

function analysisFor(profileName: keyof typeof COHORT, seeds: number[]) {
  const obs = seeds.flatMap((seed, i) => {
    const stream = simulateTyping(COHORT[profileName]!, TEXT, qwertyUs, { seed });
    const block = analyzeBlock(stream, qwertyUs, TEXT);
    return extractObservations(block.keystrokes, qwertyUs, i + 1);
  });
  return { obs, params: fitModel(obs, ZERO_PRIOR) };
}

describe('habit detection (PRD §15)', () => {
  it('flags hand imbalance only when sustained across 3 sessions', () => {
    const { obs, params } = analysisFor('handImbalanced', [1, 2]);
    const ratio = handIkiRatio(obs)!;
    expect(ratio).toBeGreaterThan(1.08);

    const base = {
      params, observations: obs, sessionMetrics: metrics(),
      tradeoff: { alpha: 0, beta: 0, vControl: 0, vCollapse: 0, headroom: 0, r2: 0, n: 0 },
    };
    const sustained = detectHabits({ ...base, handRatioHistory: [ratio, ratio] });
    expect(sustained.some((h) => h.habit === 'hand_imbalance')).toBe(true);

    const notSustained = detectHabits({ ...base, handRatioHistory: [] });
    expect(notSustained.some((h) => h.habit === 'hand_imbalance')).toBe(false);
  });

  it('flags visual search with hedged, evidence-first copy (§15.4)', () => {
    const { obs, params } = analysisFor('visualSearcher', [3, 4]);
    const flags = detectHabits({
      params, observations: obs, sessionMetrics: metrics(),
      tradeoff: { alpha: 0, beta: 0, vControl: 0, vCollapse: 0, headroom: 0, r2: 0, n: 0 },
    });
    const vs = flags.find((h) => h.habit === 'visual_search');
    expect(vs).toBeDefined();
    expect(vs!.evidence).toContain('consistent with');
    expect(vs!.evidence).not.toMatch(/you are looking/i);
    expect(vs!.remedy.visibility).toBe('keyboard_hidden');
  });

  it('flags backspace thrash at ≥8 corrections per 100 chars', () => {
    const { obs, params } = analysisFor('accurateSlowBeginner', [5]);
    const base = {
      params, observations: obs,
      tradeoff: { alpha: 0, beta: 0, vControl: 0, vCollapse: 0, headroom: 0, r2: 0, n: 0 },
    };
    expect(
      detectHabits({ ...base, sessionMetrics: metrics({ backspaceRate: 9 }) })
        .some((h) => h.habit === 'backspace_thrash'),
    ).toBe(true);
    expect(
      detectHabits({ ...base, sessionMetrics: metrics({ backspaceRate: 4 }) })
        .some((h) => h.habit === 'backspace_thrash'),
    ).toBe(false);
  });

  it('flags overdriving when >20% of typing runs above collapse speed', () => {
    const stream = simulateTyping(COHORT['plateauedOverdriver']!, TEXT, qwertyUs, { seed: 6 });
    const block = analyzeBlock(stream, qwertyUs, TEXT);
    const obs = extractObservations(block.keystrokes, qwertyUs, 1);
    const params = fitModel(obs, ZERO_PRIOR);
    const points = extractTradeoffPoints(block.keystrokes);
    const tradeoff = fitTradeoff(points, 80);
    const flags = detectHabits({
      params, observations: obs, sessionMetrics: metrics(), tradeoff, tradeoffPoints: points,
    });
    if (tradeoff.vCollapse > 0) {
      const above = points.filter((p) => p.localWpm > tradeoff.vCollapse).length / points.length;
      expect(flags.some((h) => h.habit === 'overdriving')).toBe(above > 0.2);
    }
  });
});
