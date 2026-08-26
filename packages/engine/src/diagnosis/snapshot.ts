import type { Layout } from '@typing-trainer/content';
import type { AnalyzedBlock } from '../capture/analyze';
import { CONFIG, type EngineConfig } from '../config';
import {
  backspaceRate, consistencyScore, correctionTimePct, firstAttemptAccuracy,
  mean, netWpm, perSecondWpm, rawWpm,
} from '../metrics/index';
import { analyzeHesitations } from '../model/hesitations';
import { extractObservations, type Observation } from '../model/observations';
import { fitModel, type ModelParams, type ModelPrior, ZERO_PRIOR } from '../model/ridge';
import { extractTradeoffPoints, fitTradeoff } from '../model/tradeoff';
import {
  computeSkillProfile, isPunctChar, punctRatioFromIkis, weakKeyRatioFromKeyIkis,
} from '../skill/index';
import type { DiagnosisSnapshot, PatternStat, SessionMetrics } from '../types';
import { detectHabits } from '../habits/index';
import { buildFindings, type FindingCandidate } from './findings';

/**
 * Assemble the DiagnosisSnapshot (PRD §7.8) — the single input to the
 * Planner, the Coach, and the Dashboard. Nothing else may read raw
 * keystrokes.
 */

export interface SessionAnalysisInput {
  blocks: readonly AnalyzedBlock[];
  layout: Layout;
  sessionId: number;
  /** Reference-corpus transition frequencies (the user's Typing Profile). */
  corpusFreqs: ReadonlyMap<string, number>;
  prior?: ModelPrior;
  /** Retained observations from earlier sessions (refit window, §7.2). */
  retainedObs?: readonly Observation[];
  /** Per-hand IKI ratios from previous sessions (habit detection, §15.1). */
  handRatioHistory?: readonly number[];
}

export interface SessionAnalysisResult {
  snapshot: DiagnosisSnapshot;
  params: ModelParams;
  /** This session's observations, for the caller to retain. */
  observations: Observation[];
  /** Costly-but-unproven candidates → probe material (§12.4). */
  belowBar: FindingCandidate[];
}

export function analyzeSession(
  input: SessionAnalysisInput,
  cfg: EngineConfig = CONFIG,
): SessionAnalysisResult {
  const { blocks, layout, sessionId } = input;
  const allKeystrokes = blocks.flatMap((b) => b.keystrokes);

  // --- model fit over retained + fresh observations -----------------------
  const fresh = blocks.flatMap((b) => extractObservations(b.keystrokes, layout, sessionId));
  const window = [...(input.retainedObs ?? []), ...fresh].slice(-cfg.model.refitWindow);
  const params = fitModel(window, input.prior ?? ZERO_PRIOR, cfg);
  const hesitations = analyzeHesitations(params, window, cfg);

  // --- session metrics ----------------------------------------------------
  const correctChars = allKeystrokes.filter((k) => k.correct && !k.isCorrection).length;
  const allChars = allKeystrokes.filter((k) => !k.isCorrection).length;
  const activeMs = blocks.reduce((s, b) => s + b.activeMs, 0);
  const perSecond = blocks.flatMap((b) => perSecondWpm(b));
  const consistency = consistencyScore(perSecond);
  const cv = perSecond.length >= 2 ? 1 - consistency / 100 : 0;
  const rhythm = 100 * Math.max(0, Math.min(1, 1 - hesitations.residualMad / cfg.skill.rhythmMadDivisor));
  const wpmNetV = netWpm(correctChars, activeMs);
  const corrTimePct = blocks.length > 0 ? mean(blocks.map((b) => correctionTimePct(b, cfg))) : 0;

  const sessionMetrics: SessionMetrics = {
    wpmNet: wpmNetV,
    wpmRaw: rawWpm(allChars, activeMs),
    accuracy: firstAttemptAccuracy(allKeystrokes),
    consistency,
    rhythm,
    hesitationRate: hesitations.rate,
    backspaceRate: backspaceRate(allKeystrokes),
    correctionTimePct: corrTimePct,
    keystrokes: allKeystrokes.length,
    errors: allKeystrokes.filter((k) => k.errorType !== null).length,
    corrections: allKeystrokes.filter((k) => k.isCorrection).length,
    activeMs,
    timingSuspect: blocks.some((b) => b.timingSuspect),
  };

  // --- skill profile ------------------------------------------------------
  const ikisByKey = new Map<string, number[]>();
  const alphaIkis: number[] = [];
  const punctIkis: number[] = [];
  for (const k of allKeystrokes) {
    if (k.iki === null || k.excludedFromTiming) continue;
    let arr = ikisByKey.get(k.key);
    if (!arr) ikisByKey.set(k.key, (arr = []));
    arr.push(k.iki);
    if (/[a-z]/.test(k.key)) alphaIkis.push(k.iki);
    else if (isPunctChar(k.key)) punctIkis.push(k.iki);
  }
  const skillProfile = computeSkillProfile(
    {
      wpmNet: wpmNetV,
      firstAttemptAccuracy: sessionMetrics.accuracy,
      cv,
      residualMad: hesitations.residualMad,
      weakKeyRatio: weakKeyRatioFromKeyIkis(ikisByKey, cfg),
      punctRatio: punctRatioFromIkis(alphaIkis, punctIkis),
    },
    cfg,
  );

  // --- findings, tradeoff, bottlenecks ------------------------------------
  const { findings, belowBar, notes } = buildFindings(params, input.corpusFreqs, layout, cfg);
  const tradeoffPoints = extractTradeoffPoints(allKeystrokes, cfg);
  const tradeoff = fitTradeoff(tradeoffPoints, wpmNetV, cfg);
  const bottlenecks = bottleneckStats(window, params);
  const habits = detectHabits(
    {
      params,
      observations: window,
      sessionMetrics,
      tradeoff,
      tradeoffPoints,
      ...(input.handRatioHistory ? { handRatioHistory: input.handRatioHistory } : {}),
    },
    cfg,
  );

  const confidenceNotes = [...notes];
  if (sessionMetrics.timingSuspect) {
    confidenceNotes.push('Timing on part of this session looked unreliable; it is excluded from trends.');
  }

  return {
    snapshot: {
      sessionMetrics,
      skillProfile,
      findings,
      tradeoff,
      bottlenecks: { patterns: bottlenecks },
      habits, // the UI surfaces at most one per session (§15.3)
      confidenceNotes,
    },
    params,
    observations: fresh,
    belowBar,
  };
}

function bottleneckStats(obs: readonly Observation[], params: ModelParams): PatternStat[] {
  const byBigram = new Map<string, number[]>();
  for (const o of obs) {
    const bg = o.prevChar + o.char;
    let arr = byBigram.get(bg);
    if (!arr) byBigram.set(bg, (arr = []));
    arr.push(o.logIki);
  }
  return Object.entries(params.delta)
    .filter(([bg, v]) => v > 0.08 && (byBigram.get(bg)?.length ?? 0) >= 10)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([bg]) => {
      const logs = byBigram.get(bg)!;
      const m = mean(logs);
      return {
        pattern: bg,
        patternType: 'bigram' as const,
        n: logs.length,
        ewmaLogIki: m,
        ewmaVar: mean(logs.map((x) => (x - m) ** 2)),
        accuracy: 1, // per-bigram error attribution arrives with pattern stats persistence
        lastSeen: 0,
      };
    });
}
