import type { Finger, Layout } from '@typing-trainer/content';
import { keysAdjacent } from '@typing-trainer/content';
import { createRng, type Rng } from '../rand';
import { MOD_SHIFT, type Keystroke } from '../types';

/**
 * The synthetic typist (PRD Appendix C). Generates realistic keystroke
 * streams from a parameterized profile. This is the only source of ground
 * truth for validating the diagnosis engine: we plant a coefficient (e.g. a
 * 1.4× slow right pinky) and assert the engine recovers it.
 */
export interface TypistProfile {
  baseIki: number;                              // ms
  fingerMultipliers: Partial<Record<Finger, number>>;
  keyMultipliers: Record<string, number>;       // by produced char
  sfbPenalty: number;                           // same-finger bigram multiplier
  rowJumpPenalty: number;                       // multiplier per ≥2-row jump
  shiftPenalty: number;                         // multiplier for shifted chars
  hesitationRate: number;                       // probability per keystroke
  errorRateAtSpeed: (wpm: number) => number;    // probability per keystroke
  noiseSigma: number;                           // log-normal noise
  fatigueRate: number;                          // fractional slowdown over a block
  learningRate: number;                         // per-exposure improvement (multi-session sims)
}

export interface SimulateOptions {
  seed: number;
  startT?: number;
  /** Pattern → speed multiplier, applied on top of the profile (training effects). */
  skillAdjust?: ReadonlyMap<string, number>;
  /** Corrections: 'free' backspaces and retypes errors; 'none' leaves them. */
  correction?: 'free' | 'none';
}

const DWELL_MS = 70;

export function defaultProfile(overrides: Partial<TypistProfile> = {}): TypistProfile {
  return {
    baseIki: 150, // ≈ 80 WPM (PRD §7.3)
    fingerMultipliers: {},
    keyMultipliers: {},
    sfbPenalty: 1.5,
    rowJumpPenalty: 1.25,
    shiftPenalty: 1.35,
    hesitationRate: 0.02,
    errorRateAtSpeed: (wpm) => Math.min(0.3, 0.015 + Math.max(0, wpm - 90) * 0.002),
    noiseSigma: 0.22,
    fatigueRate: 0.03,
    learningRate: 0.05,
    ...overrides,
  };
}

/** Generate the keystroke stream for one pass over `targetText`. */
export function simulateTyping(
  profile: TypistProfile,
  targetText: string,
  layout: Layout,
  opts: SimulateOptions,
): Keystroke[] {
  const rng = createRng(opts.seed);
  const correction = opts.correction ?? 'free';
  const out: Keystroke[] = [];
  let t = opts.startT ?? 1000;
  const recentIkis: number[] = [];

  let prevFinger: Finger | null = null;
  let prevRow: number | null = null;
  let prevChar: string | null = null;

  for (let index = 0; index < targetText.length; index++) {
    const expected = targetText[index]!;
    const entry = layout.charIndex[expected];
    const keyDef = entry ? layout.keys[entry.code] : undefined;
    const finger = keyDef?.finger ?? null;
    const row = keyDef?.row ?? null;

    let interval = profile.baseIki;
    if (finger) interval *= profile.fingerMultipliers[finger] ?? 1;
    interval *= profile.keyMultipliers[expected] ?? 1;
    if (finger && prevFinger === finger && expected !== prevChar) interval *= profile.sfbPenalty;
    if (row !== null && prevRow !== null && Math.abs(row - prevRow) >= 2) {
      interval *= profile.rowJumpPenalty;
    }
    if (entry?.shifted) interval *= profile.shiftPenalty;
    if (prevChar !== null) {
      const adj = opts.skillAdjust?.get(prevChar + expected);
      if (adj !== undefined) interval *= adj;
    }
    interval *= 1 + profile.fatigueRate * (index / Math.max(1, targetText.length));
    interval *= Math.exp(profile.noiseSigma * rng.gaussian());
    if (rng.next() < profile.hesitationRate) interval *= 2.5 + rng.next() * 3.5;
    interval = Math.max(30, interval);

    t += interval;
    recentIkis.push(interval);
    if (recentIkis.length > 10) recentIkis.shift();
    const localWpm = 12 / (recentIkis.reduce((a, b) => a + b, 0) / recentIkis.length / 1000);

    const makeError = rng.next() < profile.errorRateAtSpeed(localWpm);
    if (makeError && entry) {
      const wrongChar = pickAdjacentChar(layout, entry.code, rng) ?? 'x';
      out.push(keystroke(t, wrongChar, expected, index, false, layout));
      if (correction === 'free') {
        t += interval * 1.2;
        out.push({
          t,
          tUp: t + DWELL_MS,
          code: 'Backspace',
          key: 'Backspace',
          expected,
          index,
          correct: false,
          isCorrection: true,
          repeat: false,
          modifiers: 0,
        });
        t += interval * 1.1;
        out.push(keystroke(t, expected, expected, index, true, layout));
      }
    } else {
      out.push(keystroke(t, expected, expected, index, true, layout));
    }

    prevFinger = finger;
    prevRow = row;
    prevChar = expected;
  }

  return out;
}

function keystroke(
  t: number,
  key: string,
  expected: string,
  index: number,
  correct: boolean,
  layout: Layout,
): Keystroke {
  const entry = layout.charIndex[key];
  return {
    t,
    tUp: t + DWELL_MS,
    code: entry?.code ?? 'Unidentified',
    key,
    expected,
    index,
    correct,
    isCorrection: false,
    repeat: false,
    modifiers: entry?.shifted ? MOD_SHIFT : 0,
  };
}

function pickAdjacentChar(layout: Layout, code: string, rng: Rng): string | null {
  const adjacent: string[] = [];
  for (const def of Object.values(layout.keys)) {
    if (def.code !== code && keysAdjacent(def.code, code)) adjacent.push(def.char);
  }
  return adjacent.length > 0 ? rng.pick(adjacent) : null;
}

// --- The required simulated cohort (PRD Appendix C) ----------------------

export const COHORT: Readonly<Record<string, TypistProfile>> = Object.freeze({
  /** Overdrives: fast base speed, accuracy collapses above control speed. */
  plateauedOverdriver: defaultProfile({
    baseIki: 130,
    errorRateAtSpeed: (wpm) => Math.min(0.35, 0.01 + Math.max(0, wpm - 75) * 0.006),
  }),
  /** Visually searches for specific keys: huge latency on a few keys. */
  visualSearcher: defaultProfile({
    keyMultipliers: { p: 2.1, q: 2.0, x: 1.9, z: 1.9 },
    hesitationRate: 0.05,
  }),
  /** Right hand systematically slower. */
  handImbalanced: defaultProfile({
    fingerMultipliers: { RI: 1.18, RM: 1.2, RR: 1.22, RP: 1.4 },
  }),
  /** Fast on letters, weak on punctuation/symbols/digits. */
  punctuationWeakDeveloper: defaultProfile({
    baseIki: 125,
    keyMultipliers: {
      ';': 1.9, ':': 2.0, "'": 1.8, '"': 2.0, '{': 2.2, '}': 2.2, '(': 1.8,
      ')': 1.8, '[': 1.9, ']': 1.9, '=': 1.7, '-': 1.5, '_': 1.9, '/': 1.6,
      '\\': 2.1, '0': 1.5, '1': 1.4, '2': 1.4, '3': 1.4, '4': 1.5, '5': 1.5,
      '6': 1.6, '7': 1.6, '8': 1.5, '9': 1.5,
    },
  }),
  /** Slow but precise. */
  accurateSlowBeginner: defaultProfile({
    baseIki: 340,
    noiseSigma: 0.18,
    hesitationRate: 0.06,
    errorRateAtSpeed: () => 0.006,
  }),
  /** Fast average hiding stalls: high noise + frequent hesitations. */
  burstTypist: defaultProfile({
    baseIki: 120,
    noiseSigma: 0.45,
    hesitationRate: 0.09,
  }),
  /** Clean profile that improves quickly (learningRate used by session sims). */
  rapidLearner: defaultProfile({
    baseIki: 220,
    learningRate: 0.15,
    errorRateAtSpeed: () => 0.02,
  }),
  /** Inconsistent day-to-day; high noise and fatigue. */
  inconsistentRegressor: defaultProfile({
    baseIki: 170,
    noiseSigma: 0.5,
    fatigueRate: 0.12,
    hesitationRate: 0.07,
  }),
});
