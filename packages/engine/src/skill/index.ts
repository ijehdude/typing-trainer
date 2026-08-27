import { CONFIG, type EngineConfig } from '../config';
import { clamp, geometricMean } from '../metrics/index';
import type { SkillProfile } from '../types';

/**
 * The Skill Profile (PRD §8): six 0–100 dimensions plus a composite.
 * The §8.1 table is the reference fixture for these formulas.
 */

export interface SkillRawInputs {
  wpmNet: number;
  firstAttemptAccuracy: number; // 0..1
  cv: number;                   // coefficient of variation of per-second WPM
  residualMad: number;          // MAD of model residuals, log space
  /** m_med / m_worst (≤ 1 for a typist with weak keys); null = not yet measured. */
  weakKeyRatio: number | null;
  /** m_alpha / m_punct; null = not yet measured. */
  punctRatio: number | null;
}

export function speedScore(wpm: number, cfg: EngineConfig = CONFIG): number {
  const anchors = cfg.skill.speedAnchors;
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (wpm <= first[0]) return (wpm / first[0]) * first[1];
  if (wpm >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i - 1]!;
    const [x2, y2] = anchors[i]!;
    if (wpm <= x2) return y1 + ((wpm - x1) / (x2 - x1)) * (y2 - y1);
  }
  return last[1];
}

export function accuracyScore(acc: number, cfg: EngineConfig = CONFIG): number {
  const { accuracyFloor, accuracyExponent } = cfg.skill;
  return 100 * Math.pow(clamp((acc - accuracyFloor) / (1 - accuracyFloor), 0, 1), accuracyExponent);
}

export function consistencyScoreFromCv(cv: number): number {
  return 100 * clamp(1 - cv, 0, 1);
}

export function rhythmScoreFromMad(residualMad: number, cfg: EngineConfig = CONFIG): number {
  return 100 * clamp(1 - residualMad / cfg.skill.rhythmMadDivisor, 0, 1);
}

export function weakKeyScore(weakKeyRatio: number | null): number | null {
  return weakKeyRatio === null ? null : 100 * clamp(weakKeyRatio, 0, 1);
}

export function punctuationScore(punctRatio: number | null): number | null {
  return punctRatio === null ? null : 100 * clamp(punctRatio, 0, 1);
}

export function computeSkillProfile(raw: SkillRawInputs, cfg: EngineConfig = CONFIG): SkillProfile {
  const speed = speedScore(raw.wpmNet, cfg);
  const accuracy = accuracyScore(raw.firstAttemptAccuracy, cfg);
  const consistency = consistencyScoreFromCv(raw.cv);
  const rhythm = rhythmScoreFromMad(raw.residualMad, cfg);
  const weakKeyControl = weakKeyScore(raw.weakKeyRatio);
  const punctuation = punctuationScore(raw.punctRatio);

  // A dimension we could not measure is left out of the composite and its
  // weight redistributed, rather than counted as a perfect score. Scoring an
  // unmeasured dimension 100 silently inflates the total (PRD G5: never make
  // a claim the data cannot support).
  const w = cfg.skill.weights;
  const parts: Array<[number | null, number]> = [
    [speed, w.speed],
    [accuracy, w.accuracy],
    [consistency, w.consistency],
    [rhythm, w.rhythm],
    [weakKeyControl, w.weakKeyControl],
    [punctuation, w.punctuation],
  ];
  let weighted = 0;
  let totalWeight = 0;
  for (const [value, weight] of parts) {
    if (value === null) continue;
    weighted += value * weight;
    totalWeight += weight;
  }
  const overall = totalWeight > 0 ? weighted / totalWeight : 0;

  return { speed, accuracy, consistency, rhythm, weakKeyControl, punctuation, overall, raw };
}

/**
 * Weak-key ratio (PRD §8.2 dim 5): the user's median key vs their 5 worst
 * keys (min 20 observations each), both as geometric means of IKI.
 */
export function weakKeyRatioFromKeyIkis(
  ikisByKey: ReadonlyMap<string, readonly number[]>,
  cfg: EngineConfig = CONFIG,
): number | null {
  const { weakKeyWorstN, weakKeyMinObs, weakKeyMinKeys } = cfg.skill;
  const keyGms: number[] = [];
  const eligible: number[] = [];
  for (const [, ikis] of ikisByKey) {
    if (ikis.length === 0) continue;
    const gm = geometricMean([...ikis]);
    keyGms.push(gm);
    if (ikis.length >= weakKeyMinObs) eligible.push(gm);
  }
  // This compares your worst keys against your median. If only a handful of
  // keys have data they are inevitably the *most common* ones — which are
  // also your fastest — so the "worst five" would be drawn from your best
  // keys and the ratio would read as a spurious 1.00. Demand broad coverage
  // or report nothing.
  if (eligible.length < weakKeyMinKeys) return null;
  const mMed = geometricMean(keyGms);
  const worst = eligible.sort((a, b) => b - a).slice(0, weakKeyWorstN);
  const mWorst = geometricMean(worst);
  return mWorst > 0 ? clamp(mMed / mWorst, 0, 1) : null;
}

export function isPunctChar(ch: string): boolean {
  return /[0-9`~!@#$%^&*()\-_=+\[\]{}\\|;:'",.<>/?£¬]/.test(ch);
}

/**
 * Punctuation ratio (dim 6): alphabetic gm IKI vs punct/symbol/digit gm IKI.
 * Null when either class is too thin — a neutral 1 would read as a perfect
 * score for someone who simply hasn't typed any punctuation yet.
 */
export function punctRatioFromIkis(
  alphaIkis: readonly number[],
  punctIkis: readonly number[],
  cfg: EngineConfig = CONFIG,
): number | null {
  const min = cfg.skill.punctMinObs;
  if (alphaIkis.length < min || punctIkis.length < min) return null;
  const mAlpha = geometricMean([...alphaIkis]);
  const mPunct = geometricMean([...punctIkis]);
  return mPunct > 0 ? clamp(mAlpha / mPunct, 0, 1) : null;
}

/**
 * Score integrity (PRD §8.4): EWMA toward the new value, clamped so one
 * session never moves the composite more than maxCompositeDeltaPerSession.
 */
export function updateComposite(
  prevOverall: number | null,
  sessionOverall: number,
  cfg: EngineConfig = CONFIG,
): number {
  if (prevOverall === null) return sessionOverall;
  const alpha = cfg.skill.ewmaAlpha;
  const blended = prevOverall + alpha * (sessionOverall - prevOverall);
  const maxDelta = cfg.skill.maxCompositeDeltaPerSession;
  return clamp(blended, prevOverall - maxDelta, prevOverall + maxDelta);
}
