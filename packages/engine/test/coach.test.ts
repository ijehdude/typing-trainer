import { describe, expect, it } from 'vitest';
import { qwertyUs } from '@typing-trainer/content';
import {
  blockBoundaryMessage, firstDiagnosisMessage, sessionCloseMessage,
  sessionOpenMessage, violatesVoiceRules,
} from '../src/coach/templates';
import { detectPlateau, whyAmIStuck, type SessionPoint } from '../src/coach/stuck';
import { buildCalibrationText, verifyCoverage } from '../src/generators/calibration';
import type { DiagnosisSnapshot } from '../src/types';

const DAY = 86_400_000;

function snapshotWith(overrides: Partial<DiagnosisSnapshot['sessionMetrics']> = {}, extra: Partial<DiagnosisSnapshot> = {}): DiagnosisSnapshot {
  return {
    sessionMetrics: {
      wpmNet: 72, wpmRaw: 81, accuracy: 0.968, consistency: 89, rhythm: 64,
      hesitationRate: 6, backspaceRate: 4, correctionTimePct: 0.04,
      keystrokes: 5000, errors: 140, corrections: 120, activeMs: 700_000,
      timingSuspect: false, ...overrides,
    },
    skillProfile: {
      speed: 65, accuracy: 76, consistency: 89, rhythm: 64, weakKeyControl: 71,
      punctuation: 45, overall: 69,
      raw: { wpmNet: 72, firstAttemptAccuracy: 0.968, cv: 0.11, residualMad: 0.32, weakKeyRatio: 0.71, punctRatio: 0.45 },
    },
    findings: [
      { cause: 'finger:RP', label: 'Right pinky', evidence: 'Right pinky keys are ~31% slower, costing about 4.1 WPM.', estWpmCost: 4.1, confidence: 'high', patterns: ['p', ';'] },
      { cause: 'bigram:io', label: 'i → o', evidence: 'The i → o transition is consistently slow, costing about 2.2 WPM.', estWpmCost: 2.2, confidence: 'medium', patterns: ['io'] },
    ],
    tradeoff: { alpha: -9, beta: 0.07, vControl: 64, vCollapse: 79, headroom: 7, r2: 0.12, n: 4000 },
    bottlenecks: { patterns: [] },
    habits: [],
    confidenceNotes: [],
    ...extra,
  };
}

describe('coach templates (PRD §14.2 voice rules)', () => {
  it('every template output passes the voice-rule guard', () => {
    const messages = [
      sessionOpenMessage({ lastFinding: snapshotWith().findings[0]!, plannedMinutes: 15, sessionsCompleted: 4 }),
      sessionOpenMessage({ lastFinding: null, plannedMinutes: 15, sessionsCompleted: 0 }),
      sessionCloseMessage({ snapshot: snapshotWith(), speedTestWpm: 74.8, prevSpeedTestWpm: 70.1, nextMilestoneWpm: 80, wpmPerSession: 0.5 }),
      sessionCloseMessage({ snapshot: snapshotWith(), speedTestWpm: 74.8, prevSpeedTestWpm: null, nextMilestoneWpm: null, wpmPerSession: null }),
      firstDiagnosisMessage({ wpm: 68, accuracy: 0.961, slowTransitions: ['io', 'rt'], estTopCostWpm: 5, topCostLabel: 'Your right pinky' }),
    ];
    for (const m of messages) {
      expect(m.length).toBeGreaterThan(10);
      expect(violatesVoiceRules(m), m).toBeNull();
    }
  });

  it('estimates are ranges, never points', () => {
    const m = sessionCloseMessage({ snapshot: snapshotWith(), speedTestWpm: 72, prevSpeedTestWpm: 70, nextMilestoneWpm: 80, wpmPerSession: 0.5 });
    expect(m).toMatch(/\d+–\d+ sessions/);
  });

  it('block boundary messages are ≤3 lines with a measured number', () => {
    const m = blockBoundaryMessage({ blockLabel: 'Block 2', targetPattern: 'rt', ikiDeltaMs: -22, nextTarget: 'th' });
    expect(m).not.toBeNull();
    expect(m!.split('\n').length).toBeLessThanOrEqual(3);
    expect(m).toContain('22 ms faster');
  });

  it('admits thin data instead of inventing a trend', () => {
    const noFindings = snapshotWith({}, { findings: [], confidenceNotes: ['thin'] });
    const m = sessionCloseMessage({ snapshot: noFindings, speedTestWpm: 70, prevSpeedTestWpm: null, nextMilestoneWpm: null, wpmPerSession: null });
    expect(m).toMatch(/Not enough data|Baseline/);
  });
});

describe('plateau detection (PRD §14.3)', () => {
  const flat: SessionPoint[] = Array.from({ length: 10 }, (_, i) => ({
    endedAt: i * 2 * DAY,
    wpm: 72 + (i % 2 === 0 ? 0.4 : -0.4),
  }));
  const rising: SessionPoint[] = Array.from({ length: 10 }, (_, i) => ({
    endedAt: i * 2 * DAY,
    wpm: 70 + i * 0.8,
  }));

  it('flags a flat 10-session window spanning 14+ days', () => {
    expect(detectPlateau(flat).plateaued).toBe(true);
  });

  it('does not flag clear improvement', () => {
    expect(detectPlateau(rising).plateaued).toBe(false);
  });

  it('needs enough span and sessions before making the call', () => {
    expect(detectPlateau(flat.slice(0, 4)).plateaued).toBe(false);
    const shortSpan = flat.map((p, i) => ({ ...p, endedAt: i * DAY * 0.5 }));
    expect(detectPlateau(shortSpan).plateaued).toBe(false);
  });
});

describe('why am I stuck (PRD §14.3)', () => {
  it('produces ranked, quantified causes with one-click prescriptions', () => {
    const report = whyAmIStuck({
      snapshot: snapshotWith(),
      history: Array.from({ length: 10 }, (_, i) => ({ endedAt: i * 2 * DAY, wpm: 72 })),
      accByQuartile: { low: 0.982, high: 0.937 },
      sessionsLast7Days: 2,
    });
    expect(report.causes.length).toBeGreaterThanOrEqual(3);
    const costs = report.causes.map((c) => c.estWpmCost);
    expect([...costs].sort((a, b) => b - a)).toEqual(costs);
    for (const c of report.causes) {
      expect(c.detail).toMatch(/\d/);
      expect(c.prescription.sessions).toBeGreaterThan(0);
      expect(c.prescription.minutes).toBeGreaterThan(0);
    }
    // Overdriving (wpm 72 > vControl 64) must be diagnosed.
    expect(report.causes.some((c) => c.id === 'accuracy_instability')).toBe(true);
    // Punctuation gap (65 vs 45 = 20 points) must be diagnosed.
    expect(report.causes.some((c) => c.id === 'class_gap')).toBe(true);
  });

  it('diagnoses distinct profiles differently (≥8 simulated plateau shapes)', () => {
    const shapes: Array<[string, Parameters<typeof whyAmIStuck>[0]]> = [
      ['overdriver', { snapshot: snapshotWith(), history: [], accByQuartile: { low: 0.99, high: 0.93 } }],
      ['weak finger', { snapshot: snapshotWith({ wpmNet: 60 }, { tradeoff: { alpha: 0, beta: 0, vControl: 0, vCollapse: 0, headroom: 0, r2: 0, n: 0 } }), history: [] }],
      ['backspacer', { snapshot: snapshotWith({ correctionTimePct: 0.11, backspaceRate: 9 }), history: [] }],
      ['punct gap', { snapshot: snapshotWith(), history: [] }],
      ['burst-stall', { snapshot: snapshotWith({ consistency: 92, rhythm: 60 }), history: [] }],
      ['visual', { snapshot: snapshotWith(), history: [], hiddenVsVisible: { wpmHidden: 58, wpmVisible: 72 } }],
      ['low volume', { snapshot: snapshotWith(), history: [], sessionsLast7Days: 1 }],
      ['combined', { snapshot: snapshotWith({ correctionTimePct: 0.08 }), history: [], sessionsLast7Days: 2, hiddenVsVisible: { wpmHidden: 55, wpmVisible: 72 } }],
    ];
    for (const [name, input] of shapes) {
      const report = whyAmIStuck(input);
      expect(report.causes.length, name).toBeGreaterThan(0);
      expect(report.causes[0]!.headline.length, name).toBeGreaterThan(10);
    }
    // Distinct shapes produce distinct top causes across the set.
    const tops = new Set(shapes.map(([, input]) => whyAmIStuck(input).causes[0]!.id));
    expect(tops.size).toBeGreaterThanOrEqual(4);
  });
});

describe('calibration text (PRD §18.2)', () => {
  it('is coverage-engineered: every letter ≥8, top bigrams ≥4', () => {
    const cal = buildCalibrationText(qwertyUs, 7);
    const all = cal.parts.join(' ');
    expect(verifyCoverage(all)).toBe(true);
  });

  it('is deterministic per seed and has three parts', () => {
    const a = buildCalibrationText(qwertyUs, 7);
    const b = buildCalibrationText(qwertyUs, 7);
    expect(a.parts).toEqual(b.parts);
    expect(a.parts).toHaveLength(3);
    // Part 3 exercises punctuation/digits.
    expect(/[0-9"';:,.\-()$%]/.test(a.parts[2]!)).toBe(true);
  });
});
