import { describe, expect, it } from 'vitest';
import { qwertyUs, POPULATION_PRIOR } from '@typing-trainer/content';
import { analyzeBlock } from '../src/capture/analyze';
import { analyzeSession } from '../src/diagnosis/snapshot';
import { transitionFrequencies } from '../src/diagnosis/counterfactual';
import { COHORT, simulateTyping } from '../src/simulator/index';

const TEXT =
  'the quick brown fox jumps over the lazy dog while happy people prepare a proper supper for a sleepy puppy '.repeat(12);

describe('DiagnosisSnapshot assembly (PRD §7.8)', () => {
  const freqs = transitionFrequencies(TEXT, qwertyUs);

  function runSession(seed: number, sessionId: number, retained: never[] | undefined = undefined) {
    const stream = simulateTyping(COHORT['handImbalanced']!, TEXT, qwertyUs, { seed });
    const block = analyzeBlock(stream, qwertyUs, TEXT);
    return analyzeSession({
      blocks: [block],
      layout: qwertyUs,
      sessionId,
      corpusFreqs: freqs,
      prior: POPULATION_PRIOR,
      ...(retained ? { retainedObs: retained } : {}),
    });
  }

  it('produces a complete, internally consistent snapshot', () => {
    const s1 = runSession(41, 1);
    const result = analyzeSession({
      blocks: [analyzeBlock(simulateTyping(COHORT['handImbalanced']!, TEXT, qwertyUs, { seed: 42 }), qwertyUs, TEXT)],
      layout: qwertyUs,
      sessionId: 2,
      corpusFreqs: freqs,
      prior: POPULATION_PRIOR,
      retainedObs: s1.observations,
    });
    const snap = result.snapshot;

    expect(snap.sessionMetrics.wpmNet).toBeGreaterThan(20);
    expect(snap.sessionMetrics.wpmNet).toBeLessThan(200);
    expect(snap.sessionMetrics.accuracy).toBeGreaterThan(0.85);
    expect(snap.sessionMetrics.accuracy).toBeLessThanOrEqual(1);
    expect(snap.sessionMetrics.keystrokes).toBeGreaterThan(TEXT.length * 0.9);
    expect(snap.skillProfile.overall).toBeGreaterThan(0);
    expect(snap.skillProfile.overall).toBeLessThanOrEqual(100);
  });

  it('never shows a Finding below medium confidence (G5)', () => {
    const s1 = runSession(41, 1);
    const result = analyzeSession({
      blocks: [analyzeBlock(simulateTyping(COHORT['handImbalanced']!, TEXT, qwertyUs, { seed: 42 }), qwertyUs, TEXT)],
      layout: qwertyUs,
      sessionId: 2,
      corpusFreqs: freqs,
      prior: POPULATION_PRIOR,
      retainedObs: s1.observations,
    });
    for (const f of result.snapshot.findings) {
      expect(['medium', 'high']).toContain(f.confidence);
      expect(f.estWpmCost).toBeGreaterThan(0);
      expect(f.evidence).toMatch(/\d/); // every claim carries a number (§14.2)
    }
    // Ranked by cost, descending.
    const costs = result.snapshot.findings.map((f) => f.estWpmCost);
    expect([...costs].sort((a, b) => b - a)).toEqual(costs);
  });

  it('diagnoses the planted right-hand imbalance across two sessions', () => {
    const s1 = runSession(41, 1);
    const result = analyzeSession({
      blocks: [analyzeBlock(simulateTyping(COHORT['handImbalanced']!, TEXT, qwertyUs, { seed: 42 }), qwertyUs, TEXT)],
      layout: qwertyUs,
      sessionId: 2,
      corpusFreqs: freqs,
      prior: POPULATION_PRIOR,
      retainedObs: s1.observations,
    });
    const causes = [
      ...result.snapshot.findings.map((f) => f.cause),
      ...result.belowBar.map((f) => f.cause),
    ];
    // The planted ×1.4 right pinky (or another right-hand finger) surfaces.
    expect(causes.some((c) => /finger:R/.test(c))).toBe(true);
  });

  it('a single session yields no findings — nothing has 2 sessions of evidence yet', () => {
    const result = runSession(41, 1);
    for (const f of result.snapshot.findings) {
      expect(['medium', 'high']).toContain(f.confidence); // gate still holds
    }
    // With one session, medium requires ≥2 sessions — so nothing is shown.
    expect(result.snapshot.findings).toHaveLength(0);
  });

  it('is deterministic: identical inputs produce identical snapshots (§19.7)', () => {
    const a = runSession(77, 1);
    const b = runSession(77, 1);
    expect(JSON.stringify(a.snapshot)).toBe(JSON.stringify(b.snapshot));
  });
});
