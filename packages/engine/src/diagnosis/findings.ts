import type { Finger, Layout } from '@typing-trainer/content';
import { CONFIG, type EngineConfig } from '../config';
import { median } from '../metrics/index';
import type { ModelParams } from '../model/ridge';
import type { Confidence, Finding } from '../types';
import { confidenceFor, meetsBar } from './confidence';
import { estimateCost, type Effect } from './counterfactual';

export const FINGER_LABELS: Record<Finger, string> = {
  LP: 'Left pinky', LR: 'Left ring', LM: 'Left middle', LI: 'Left index', LT: 'Left thumb',
  RT: 'Right thumb', RI: 'Right index', RM: 'Right middle', RR: 'Right ring', RP: 'Right pinky',
};

export interface FindingCandidate extends Finding {
  /** Candidates below the bar aren't shown but can become probes (§12.4). */
  shown: boolean;
}

const MIN_COST_WPM = 0.5;

/**
 * Build the ranked Finding list (PRD §7.4): fingers, worst keys, worst
 * specific transitions, and the SFB class — every candidate costed over the
 * same reference corpus and gated by §7.7. Comparability in WPM is the product.
 */
export function buildFindings(
  params: ModelParams,
  freqs: ReadonlyMap<string, number>,
  layout: Layout,
  cfg: EngineConfig = CONFIG,
): { findings: Finding[]; belowBar: FindingCandidate[]; notes: string[] } {
  const candidates: FindingCandidate[] = [];
  const notes: string[] = [];

  const add = (
    effect: Effect,
    cause: string,
    label: string,
    nObs: number,
    nSessions: number,
    coefDelta: number,
    se: number,
    patterns: string[],
    evidence: (cost: number) => string,
  ) => {
    const cost = estimateCost(effect, params, freqs, layout);
    if (cost < MIN_COST_WPM) return;
    const conf = confidenceFor(nObs, nSessions, Math.abs(coefDelta), se, cfg);
    const finding: FindingCandidate = {
      cause,
      label,
      evidence: evidence(cost),
      estWpmCost: round1(cost),
      confidence: conf,
      patterns,
      shown: meetsBar(conf),
    };
    candidates.push(finding);
    if (!finding.shown && cost >= 1.5) {
      notes.push(
        `${label} looks costly (~${round1(cost)} WPM) but there isn't enough data yet to be sure.`,
      );
    }
  };

  // Fingers (thumbs excluded — space is its own world).
  const fingerEntries = Object.entries(params.phi).filter(
    ([f]) => f !== 'LT' && f !== 'RT',
  ) as Array<[Finger, number]>;
  for (const [finger, coef] of fingerEntries) {
    const peerMed = median(fingerEntries.filter(([f]) => f !== finger).map(([, v]) => v));
    const delta = coef - peerMed;
    if (delta <= 0) continue;
    const pct = Math.round((Math.exp(delta) - 1) * 100);
    add(
      { type: 'finger', finger },
      `finger:${finger}`,
      FINGER_LABELS[finger],
      params.counts.phi[finger] ?? 0,
      params.counts.sessions[`finger:${finger}`] ?? 0,
      delta,
      params.se.phi[finger] ?? 0,
      keysOfFinger(layout, finger),
      (cost) =>
        `${FINGER_LABELS[finger]} keys are ~${pct}% slower than your other fingers, costing about ${round1(cost)} WPM.`,
    );
  }

  // Worst individual keys by κ above key-median.
  const kappaEntries = Object.entries(params.kappa).filter(([k]) => k !== ' ');
  const kappaMed = median(kappaEntries.map(([, v]) => v));
  const worstKeys = kappaEntries
    .map(([k, v]) => [k, v - kappaMed] as const)
    .filter(([, d]) => d > 0.1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  for (const [char, delta] of worstKeys) {
    const pct = Math.round((Math.exp(delta) - 1) * 100);
    add(
      { type: 'key', char },
      `key:${char}`,
      `The ${printable(char)} key`,
      params.counts.kappa[char] ?? 0,
      params.counts.sessions[`key:${char}`] ?? 0,
      delta,
      params.se.kappa[char] ?? 0,
      [char],
      (cost) =>
        `${printable(char)} runs ~${pct}% slower than your typical key, costing about ${round1(cost)} WPM.`,
    );
  }

  // Worst specific transitions by δ.
  const worstBigrams = Object.entries(params.delta)
    .filter(([, v]) => v > 0.12)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  for (const [bigram, delta] of worstBigrams) {
    add(
      { type: 'bigram', bigram },
      `bigram:${bigram}`,
      `${printable(bigram[0]!)} → ${printable(bigram[1]!)}`,
      params.counts.delta[bigram] ?? 0,
      params.counts.sessions[`bigram:${bigram}`] ?? 0,
      delta,
      params.se.delta[bigram] ?? 0,
      [bigram],
      (cost) =>
        `The ${printable(bigram[0]!)} → ${printable(bigram[1]!)} transition is consistently slow for you, costing about ${round1(cost)} WPM.`,
    );
  }

  // Same-finger bigram class.
  if (params.sigmaSfb > 0.05) {
    add(
      { type: 'class', cls: 'sfb' },
      'class:sfb',
      'Same-finger bigrams',
      params.counts.sigmaSfb,
      params.counts.sessions['class:sfb'] ?? 0,
      params.sigmaSfb,
      params.se.sigmaSfb,
      [],
      (cost) =>
        `Transitions that reuse a finger slow you ~${Math.round((Math.exp(params.sigmaSfb) - 1) * 100)}%, costing about ${round1(cost)} WPM.`,
    );
  }

  const shown = candidates
    .filter((c) => c.shown)
    .sort((a, b) => b.estWpmCost - a.estWpmCost)
    .map(({ shown: _, ...finding }) => finding);
  const belowBar = candidates.filter((c) => !c.shown);

  return { findings: shown, belowBar, notes };
}

export function confidenceFloor(findings: readonly Finding[]): Confidence {
  return findings.every((f) => meetsBar(f.confidence)) ? 'medium' : 'insufficient';
}

function keysOfFinger(layout: Layout, finger: Finger): string[] {
  return Object.values(layout.keys)
    .filter((k) => k.finger === finger)
    .map((k) => k.char);
}

function printable(ch: string): string {
  if (ch === ' ') return 'space';
  if (ch === '\n') return 'enter';
  if (ch === '\t') return 'tab';
  return ch;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
