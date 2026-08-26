import { describe, expect, it } from 'vitest';
import { qwertyUs } from '@typing-trainer/content';
import { COHORT } from '../src/simulator/index';
import { runTrainingLoop } from '../src/simulator/loop';
import { mean } from '../src/metrics/index';

/**
 * The whole-adaptive-loop regression test (PRD Appendix C reason #2/#3):
 * planner → generators → simulated typist → diagnosis → SRS, over many
 * sessions, in seconds.
 */
describe('training loop end-to-end', () => {
  it('runs 10 sessions for a rapid learner: valid plans, improving speed tests', () => {
    const records = runTrainingLoop({
      typist: COHORT['rapidLearner']!,
      layout: qwertyUs,
      sessions: 10,
      minutes: 15,
      profile: 'writer',
      seed: 4242,
      charsPerMinute: 60,
      trainingEffect: 0.9,
    });

    expect(records).toHaveLength(10);
    for (const r of records) {
      // Every plan valid from any state, including cold start (§23 acceptance).
      expect(r.plan.blocks[0]!.kind).toBe('warmup');
      expect(r.plan.blocks[r.plan.blocks.length - 1]!.kind).toBe('test');
      expect(r.speedTestWpm).toBeGreaterThan(10);
      expect(r.trainedPatterns.length).toBeGreaterThan(0);
      // Findings remain gated at every session.
      for (const f of r.snapshot.findings) {
        expect(['medium', 'high']).toContain(f.confidence);
      }
    }

    // Trained patterns improve → the untargeted speed test drifts upward.
    const early = mean(records.slice(0, 3).map((r) => r.speedTestWpm));
    const late = mean(records.slice(-3).map((r) => r.speedTestWpm));
    expect(late).toBeGreaterThan(early);
  });

  it('handles the full cohort for 3 sessions without invalid plans or crashes', () => {
    for (const [name, typist] of Object.entries(COHORT)) {
      const records = runTrainingLoop({
        typist,
        layout: qwertyUs,
        sessions: 3,
        minutes: 10,
        profile: 'writer',
        seed: 77,
        charsPerMinute: 40,
      });
      expect(records, name).toHaveLength(3);
      for (const r of records) {
        expect(r.plan.blocks.length, name).toBeGreaterThanOrEqual(3);
        expect(r.snapshot.sessionMetrics.keystrokes, name).toBeGreaterThan(0);
      }
    }
  });

  it('is fully deterministic (§19.7)', () => {
    const run = () =>
      runTrainingLoop({
        typist: COHORT['burstTypist']!,
        layout: qwertyUs,
        sessions: 3,
        minutes: 5,
        profile: 'developer',
        seed: 99,
        charsPerMinute: 40,
      });
    const a = run();
    const b = run();
    expect(JSON.stringify(a.map((r) => [r.speedTestWpm, r.snapshot.sessionMetrics.wpmNet]))).toBe(
      JSON.stringify(b.map((r) => [r.speedTestWpm, r.snapshot.sessionMetrics.wpmNet])),
    );
  });
});
