import type { DiagnosisSnapshot, Finding } from '../types';

/**
 * Coach templates (PRD §14.2, §19.6): the deterministic, first-class path.
 * Voice rules enforced by construction: every claim carries a number, no
 * exclamation marks, no "amazing/awesome/incredible", at most one criticism
 * and it is always followed by the prescription, estimates are ranges from
 * measured rates, thin data is admitted honestly.
 */

const r1 = (x: number) => Math.round(x * 10) / 10;

export function sessionOpenMessage(args: {
  lastFinding: Finding | null;
  plannedMinutes: number;
  sessionsCompleted: number;
}): string {
  if (args.sessionsCompleted === 0) {
    return `First session. ${args.plannedMinutes} minutes — a calibration pass so the plan is built on measurements, not guesses.`;
  }
  if (args.lastFinding) {
    return `Welcome back.\nLast session identified ${args.lastFinding.label} as a bottleneck (about ${r1(args.lastFinding.estWpmCost)} WPM).\nLet's work on it. ${args.plannedMinutes} minutes.`;
  }
  return `Welcome back. ${args.plannedMinutes} minutes today; the plan continues from your last session.`;
}

export function sessionCloseMessage(args: {
  snapshot: DiagnosisSnapshot;
  prevWpm: number | null;
  nextMilestoneWpm: number | null;
  /** Measured WPM change per session over the trailing window; null if thin. */
  wpmPerSession: number | null;
}): string {
  const { snapshot, prevWpm } = args;
  const wpm = snapshot.sessionMetrics.wpmNet;
  const lines: string[] = [];

  if (prevWpm !== null) {
    const delta = wpm - prevWpm;
    if (delta >= 0.5) lines.push(`You finished at ${r1(wpm)} WPM, up ${r1(delta)} from last session.`);
    else if (delta <= -0.5) lines.push(`You finished at ${r1(wpm)} WPM, down ${r1(Math.abs(delta))} from last session. One session is noise, not a trend.`);
    else lines.push(`You finished at ${r1(wpm)} WPM, level with last session.`);
  } else {
    lines.push(`Baseline recorded: ${r1(wpm)} WPM at ${r1(snapshot.sessionMetrics.accuracy * 100)}% accuracy.`);
  }

  const top = snapshot.findings[0];
  if (top) {
    lines.push(`Biggest available gain: ${top.label}, worth about ${r1(top.estWpmCost)} WPM. Tomorrow's session starts there.`);
  } else if (snapshot.confidenceNotes.length > 0) {
    lines.push(`Not enough data yet to name your bottleneck with confidence — the next session gathers what's missing.`);
  }

  if (args.nextMilestoneWpm !== null && args.wpmPerSession !== null && args.wpmPerSession > 0.05) {
    const gap = args.nextMilestoneWpm - wpm;
    if (gap > 0) {
      const lo = Math.max(1, Math.ceil(gap / (args.wpmPerSession * 1.5)));
      const hi = Math.ceil(gap / (args.wpmPerSession * 0.6));
      lines.push(`Next milestone: ${args.nextMilestoneWpm} WPM. Estimated ${lo}–${hi} sessions at your current rate.`);
    }
  }

  return lines.join('\n');
}

/** Between-block message (PRD §13.4): ≤3 lines, one measured number, no empty praise. */
export function blockBoundaryMessage(args: {
  blockLabel: string;
  targetPattern: string | null;
  ikiDeltaMs: number | null; // negative = faster
  nextTarget: string | null;
}): string | null {
  const lines: string[] = [`${args.blockLabel} complete.`];
  if (args.targetPattern && args.ikiDeltaMs !== null && Math.abs(args.ikiDeltaMs) >= 3) {
    const dir = args.ikiDeltaMs < 0 ? 'faster' : 'slower';
    lines.push(`${printable(args.targetPattern)} is ${Math.round(Math.abs(args.ikiDeltaMs))} ms ${dir} than when we started.`);
  }
  if (args.nextTarget) lines.push(`Next block targets ${printable(args.nextTarget)}.`);
  return lines.length > 1 ? lines.slice(0, 3).join('\n') : null;
}

export function firstDiagnosisMessage(args: {
  wpm: number;
  accuracy: number;
  slowTransitions: string[];
  estTopCostWpm: number | null;
  topCostLabel: string | null;
}): string {
  const lines = [
    `You type at ${Math.round(args.wpm)} WPM. Your accuracy is ${r1(args.accuracy * 100)}%.`,
  ];
  if (args.slowTransitions.length > 0) {
    lines.push(`Early estimate: your slowest transitions are ${args.slowTransitions.slice(0, 3).map(printable).join(', ')}.`);
  }
  if (args.estTopCostWpm !== null && args.topCostLabel !== null && args.estTopCostWpm >= 1) {
    lines.push(`${args.topCostLabel} alone may be costing you about ${Math.round(args.estTopCostWpm)} WPM — two more sessions will confirm it.`);
  }
  lines.push(`Here's a session that targets what we found.`);
  return lines.join('\n');
}

function printable(p: string): string {
  if (p.length === 2) return `${p[0]} → ${p[1]}`;
  return p === ' ' ? 'space' : p;
}

/** Guard used by tests and the LLM validator: voice rules of §14.2. */
export function violatesVoiceRules(text: string): string | null {
  if (/!/.test(text)) return 'exclamation mark';
  if (/amazing|awesome|incredible/i.test(text)) return 'banned superlative';
  if (!/\d/.test(text)) return 'no measured number';
  return null;
}
