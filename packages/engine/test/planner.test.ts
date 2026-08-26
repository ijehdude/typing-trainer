import { describe, expect, it } from 'vitest';
import { checkFatigue, planSession, replanRemaining } from '../src/planner/index';
import type { BlockResult, PlannedBlock } from '../src/planner/index';
import type { DiagnosisSnapshot, Finding } from '../src/types';

function fakeSnapshot(findings: Finding[]): DiagnosisSnapshot {
  return {
    sessionMetrics: {
      wpmNet: 72, wpmRaw: 78, accuracy: 0.97, consistency: 88, rhythm: 80,
      hesitationRate: 4, backspaceRate: 3, correctionTimePct: 0.03,
      keystrokes: 4000, errors: 90, corrections: 80, activeMs: 600_000, timingSuspect: false,
    },
    skillProfile: {
      speed: 65, accuracy: 79, consistency: 88, rhythm: 80, weakKeyControl: 70,
      punctuation: 60, overall: 72,
      raw: { wpmNet: 72, firstAttemptAccuracy: 0.97, cv: 0.12, residualMad: 0.18, weakKeyRatio: 0.7, punctRatio: 0.6 },
    },
    findings,
    tradeoff: { alpha: -8, beta: 0.06, vControl: 68, vCollapse: 84, headroom: 12, r2: 0.1, n: 3000 },
    bottlenecks: { patterns: [] },
    habits: [],
    confidenceNotes: [],
  };
}

const finding = (cause: string, patterns: string[], cost: number): Finding => ({
  cause, label: cause, evidence: `costs ${cost} WPM`, estWpmCost: cost,
  confidence: 'medium', patterns,
});

describe('Autopilot planner (PRD §12)', () => {
  it.each([5, 10, 15, 25])('produces a valid %d-minute plan from a diagnosis', (minutes) => {
    const plan = planSession({
      minutes,
      snapshot: fakeSnapshot([finding('bigram:io', ['io'], 4.2), finding('finger:RP', ['p', ';'], 2.1)]),
      profile: 'developer',
      seed: 42,
    });
    const total = plan.blocks.reduce((s, b) => s + b.minutes, 0);
    expect(Math.abs(total - minutes)).toBeLessThanOrEqual(1);
    // Invariants (§12.2): unscored warm-up first, untargeted stage-5 test last.
    expect(plan.blocks[0]!.kind).toBe('warmup');
    expect(plan.blocks[0]!.scored).toBe(false);
    const last = plan.blocks[plan.blocks.length - 1]!;
    expect(last.kind).toBe('test');
    expect(last.targets).toEqual([]);
    expect(last.stage).toBe(5);
    // The top finding drives the primary target block.
    const primary = plan.blocks.find((b) => b.kind === 'target');
    expect(primary!.targets).toContain('io');
  });

  it('produces a valid, varied plan from cold start (no model state)', () => {
    const a = planSession({ minutes: 15, snapshot: null, profile: 'writer', seed: 1 });
    expect(a.blocks.length).toBeGreaterThanOrEqual(4);
    const targets = a.blocks.filter((b) => b.kind === 'target');
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(t.targets.length).toBeGreaterThan(0);
    // Seeds differ per block → generated content varies.
    expect(new Set(a.blocks.map((b) => b.seed)).size).toBe(a.blocks.length);
  });

  it('schedules a probe when a costly candidate lacks confidence (§12.4)', () => {
    const plan = planSession({
      minutes: 15,
      snapshot: fakeSnapshot([finding('bigram:io', ['io'], 4.2)]),
      belowBar: [{
        cause: 'finger:RP', label: 'Right pinky', evidence: '', estWpmCost: 3.0,
        confidence: 'insufficient', patterns: ['p', ';'], shown: false,
      }],
      profile: 'writer',
      seed: 9,
    });
    const probe = plan.blocks.find((b) => b.kind === 'probe');
    expect(probe).toBeDefined();
    expect(probe!.targets).toContain('p');
  });

  it('SRS due patterns join the primary block', () => {
    const plan = planSession({
      minutes: 15,
      snapshot: fakeSnapshot([finding('bigram:io', ['io'], 4.2)]),
      srsQueue: [{ pattern: 'rt', patternType: 'bigram', source: 'due' }],
      profile: 'writer',
      seed: 3,
    });
    const primary = plan.blocks.find((b) => b.kind === 'target')!;
    expect(primary.targets).toContain('rt');
  });
});

describe('mid-session re-planning (PRD §13.3)', () => {
  const block = (ordinal: number, kind: PlannedBlock['kind'], targets: string[], stage = 2): PlannedBlock => ({
    ordinal, kind, minutes: 3, stage: stage as PlannedBlock['stage'], targets,
    visibility: 'keyboard_hidden', policy: 'free', scored: true, label: 'x', seed: 1, profile: 'writer',
  });
  const result = (ordinal: number, targets: string[], targetMet: boolean): BlockResult => ({
    ordinal, kind: 'target', targets, wpmNet: 70, accuracy: 0.97, targetMet,
  });

  it('two consecutive failed blocks on a pattern trigger a strategy change, not a third block', () => {
    const remaining = [block(3, 'target', ['io'], 2)];
    const replanned = replanRemaining({
      remaining,
      completed: [result(1, ['io'], false), result(2, ['io'], false)],
    });
    expect(replanned[0]!.stage).toBe(1); // dropped a stage
  });

  it('a met target promotes the next block a stage', () => {
    const replanned = replanRemaining({
      remaining: [block(2, 'target', ['io'], 2)],
      completed: [result(1, ['io'], true)],
    });
    expect(replanned[0]!.stage).toBe(3);
  });

  it('the speed test block is never modified', () => {
    const test = block(4, 'test', [], 5);
    const replanned = replanRemaining({
      remaining: [test],
      completed: [result(1, ['io'], false), result(2, ['io'], false)],
    });
    expect(replanned[0]).toEqual(test);
  });
});

describe('fatigue management (PRD §12.3)', () => {
  it('flags a micro-rest after two blocks >8% below peak', () => {
    expect(checkFatigue([80, 82, 74, 73])).toEqual({ microRest: true, reduceDifficulty: true });
    expect(checkFatigue([80, 82, 79, 80])).toEqual({ microRest: false, reduceDifficulty: false });
    expect(checkFatigue([80, 70])).toEqual({ microRest: false, reduceDifficulty: false });
  });
});
