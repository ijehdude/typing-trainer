import { CONFIG, type EngineConfig } from '../config';
import type { DiagnosisSnapshot, Prescription } from '../types';

/**
 * Plateau detection and the "Why am I stuck?" pipeline (PRD §14.3) —
 * the flagship diagnostic. Every cause produces a quantified finding with
 * a one-click prescription; the output is ranked by estimated ΔWPM.
 */

export interface SessionPoint {
  endedAt: number; // epoch ms
  wpm: number;     // speed-test WPM (the only trend metric)
}

export interface PlateauResult {
  plateaued: boolean;
  slopePerSession: number;
  projectedGain10: number;
  ciIncludesZero: boolean;
  n: number;
}

const DAY_MS = 86_400_000;

/** OLS of speed-test WPM on session index over the trailing window (§14.3). */
export function detectPlateau(
  history: readonly SessionPoint[],
  cfg: EngineConfig = CONFIG,
): PlateauResult {
  const window = history.slice(-cfg.plateau.windowSessions);
  const empty: PlateauResult = {
    plateaued: false, slopePerSession: 0, projectedGain10: 0, ciIncludesZero: true, n: window.length,
  };
  if (window.length < 5) return empty;
  const spanDays = (window[window.length - 1]!.endedAt - window[0]!.endedAt) / DAY_MS;
  if (spanDays < cfg.plateau.minSpanDays) return empty;

  const n = window.length;
  const xs = window.map((_, i) => i);
  const ys = window.map((p) => p.wpm);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i]! - (intercept + slope * xs[i]!)) ** 2;
  const seSlope = n > 2 && sxx > 0 ? Math.sqrt(sse / (n - 2) / sxx) : Infinity;
  const ciIncludesZero = Math.abs(slope) < 1.96 * seSlope;
  const projectedGain10 = slope * 10;

  return {
    plateaued: projectedGain10 < cfg.plateau.projectedGainWpm && ciIncludesZero,
    slopePerSession: slope,
    projectedGain10,
    ciIncludesZero,
    n,
  };
}

export interface StuckCause {
  id: string;
  headline: string;
  detail: string;
  estWpmCost: number;
  prescription: Prescription & { sessions: number };
}

export interface StuckInput {
  snapshot: DiagnosisSnapshot;
  history: readonly SessionPoint[];
  /** Accuracy in the lowest vs highest local-speed quartile, if computed. */
  accByQuartile?: { low: number; high: number };
  hiddenVsVisible?: { wpmHidden: number; wpmVisible: number };
  sessionsLast7Days?: number;
}

export interface StuckReport {
  plateau: PlateauResult;
  currentWpm: number;
  rawWpm: number;
  causes: StuckCause[]; // ranked by estWpmCost desc
}

export function whyAmIStuck(input: StuckInput, cfg: EngineConfig = CONFIG): StuckReport {
  const s = input.snapshot;
  const causes: StuckCause[] = [];
  const wpm = s.sessionMetrics.wpmNet;

  // 1 — Accuracy instability under speed (the most common cause, §7.5).
  if (s.tradeoff.vControl > 0 && wpm > s.tradeoff.vControl) {
    const accDrop = input.accByQuartile
      ? (input.accByQuartile.low - input.accByQuartile.high) * 100
      : null;
    if (accDrop === null || accDrop > cfg.stuck.accDropQuartilePp) {
      const cost = Math.min(10, Math.max(1, (wpm - s.tradeoff.vControl) * 0.35));
      causes.push({
        id: 'accuracy_instability',
        headline: 'Your plateau is caused by accuracy instability, not by raw speed.',
        detail:
          `Your raw speed is ${Math.round(s.sessionMetrics.wpmRaw)} WPM, but you can only hold ` +
          `${Math.round(s.tradeoff.vControl)} WPM at 97% accuracy` +
          (accDrop !== null ? `; between your slowest and fastest stretches, accuracy falls ${accDrop.toFixed(1)}pp.` : '.'),
        estWpmCost: round1(cost),
        prescription: {
          findingCause: 'accuracy_instability', blockKind: 'target', stage: 4, targets: [],
          minutes: 5, visibility: 'keyboard_hidden', sessions: 5,
          note: `Precision blocks paced at ${Math.max(20, Math.round(s.tradeoff.vControl - 5))} WPM — rebuild the ceiling from below.`,
        },
      });
    }
  }

  // 2/3 — Finger imbalance and specific transition bottlenecks: reuse Findings.
  for (const f of s.findings.slice(0, 3)) {
    causes.push({
      id: f.cause,
      headline: `${f.label} is holding your ceiling down.`,
      detail: f.evidence,
      estWpmCost: f.estWpmCost,
      prescription: {
        findingCause: f.cause, blockKind: 'target',
        stage: f.cause.startsWith('finger') ? 1 : 0,
        targets: f.patterns.slice(0, 4).filter((p) => p.length <= 3),
        minutes: 8, visibility: 'keyboard_hidden', sessions: 5,
        note: `8 minutes of targeted drills laddering into words, for your next 5 sessions.`,
      },
    });
  }

  // 4 — Rhythm collapse: fast on average, ragged underneath.
  const rhythmGap = s.sessionMetrics.consistency - s.sessionMetrics.rhythm;
  if (rhythmGap >= cfg.habits.burstStallGapPoints) {
    causes.push({
      id: 'rhythm_collapse',
      headline: 'Your average speed hides burst-and-stall typing.',
      detail: `Consistency ${Math.round(s.sessionMetrics.consistency)} vs rhythm ${Math.round(s.sessionMetrics.rhythm)}: you are fast in flashes and hesitating between them (${round1(s.sessionMetrics.hesitationRate)} hesitations per 100 keys).`,
      estWpmCost: round1(Math.min(6, rhythmGap * 0.15)),
      prescription: {
        findingCause: 'rhythm_collapse', blockKind: 'target', stage: 3, targets: [],
        minutes: 5, visibility: 'text_faded', sessions: 4,
        note: 'Paced blocks slightly below your burst speed to smooth the stalls.',
      },
    });
  }

  // 5 — Backspace overhead.
  if (s.sessionMetrics.correctionTimePct > cfg.stuck.backspaceTimePct) {
    const pct = Math.round(s.sessionMetrics.correctionTimePct * 100);
    causes.push({
      id: 'backspace_overhead',
      headline: `${pct}% of your typing time goes to corrections.`,
      detail: `You corrected ${round1(s.sessionMetrics.backspaceRate)} times per 100 characters; the time cost is ~${pct}% of the session.`,
      estWpmCost: round1(wpm * s.sessionMetrics.correctionTimePct),
      prescription: {
        findingCause: 'backspace_overhead', blockKind: 'target', stage: 2, targets: [],
        minutes: 5, visibility: 'keyboard_hidden', sessions: 4,
        note: 'Strict-mode precision blocks: errors stop the caret until corrected.',
      },
    });
  }

  // 6 — Character-class gap.
  const classGap = s.skillProfile.speed - s.skillProfile.punctuation;
  if (classGap >= cfg.stuck.classGapPoints) {
    causes.push({
      id: 'class_gap',
      headline: 'Punctuation and symbols are far behind your letters.',
      detail: `Your punctuation control scores ${Math.round(s.skillProfile.punctuation)} against ${Math.round(s.skillProfile.speed)} for raw speed — every sentence pays the difference.`,
      estWpmCost: round1(Math.min(5, classGap * 0.12)),
      prescription: {
        findingCause: 'class_gap', blockKind: 'target', stage: 2,
        targets: [',', '.', ';', "'"], minutes: 6, visibility: 'keyboard_hidden', sessions: 5,
        note: 'The Fluency punctuation unit, pulled forward.',
      },
    });
  }

  // 7 — Visual dependence.
  if (input.hiddenVsVisible) {
    const { wpmHidden, wpmVisible } = input.hiddenVsVisible;
    if (wpmVisible > 0 && (wpmVisible - wpmHidden) / wpmVisible >= cfg.stuck.hiddenGapPct) {
      const gapPct = Math.round(((wpmVisible - wpmHidden) / wpmVisible) * 100);
      causes.push({
        id: 'visual_dependence',
        headline: 'You type meaningfully slower without the on-screen keyboard.',
        detail: `${Math.round(wpmHidden)} WPM hidden vs ${Math.round(wpmVisible)} visible — a ${gapPct}% gap. This pattern is consistent with visual anchoring.`,
        estWpmCost: round1((wpmVisible - wpmHidden) * 0.6),
        prescription: {
          findingCause: 'visual_dependence', blockKind: 'target', stage: 2, targets: [],
          minutes: 5, visibility: 'keyboard_faded', sessions: 6,
          note: 'The fading protocol: visible → faded → hidden, one step per 3 clean sessions.',
        },
      });
    }
  }

  // 8 — Insufficient practice.
  if (input.sessionsLast7Days !== undefined && input.sessionsLast7Days < cfg.stuck.minSessionsPerWeek) {
    causes.push({
      id: 'practice_volume',
      headline: `${input.sessionsLast7Days} session${input.sessionsLast7Days === 1 ? '' : 's'} in the last 7 days is below the improvement threshold.`,
      detail: 'Motor consolidation needs spaced exposures: 3+ short sessions a week beat one long one.',
      estWpmCost: 2,
      prescription: {
        findingCause: 'practice_volume', blockKind: 'target', stage: 4, targets: [],
        minutes: 12, visibility: 'keyboard_hidden', sessions: 5,
        note: '12 minutes a day, 5 days — volume first, intensity later.',
      },
    });
  }

  causes.sort((a, b) => b.estWpmCost - a.estWpmCost);
  return {
    plateau: detectPlateau(input.history, cfg),
    currentWpm: wpm,
    rawWpm: s.sessionMetrics.wpmRaw,
    causes,
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
