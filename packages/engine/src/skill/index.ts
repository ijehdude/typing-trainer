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
  weakKeyRatio: number;         // m_med / m_worst (≤ 1 for a typist with weak keys)
  punctRatio: number;           // m_alpha / m_punct
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

export function weakKeyScore(weakKeyRatio: number): number {
  return 100 * clamp(weakKeyRatio, 0, 1);
}

export function punctuationScore(punctRatio: number): number {
  return 100 * clamp(punctRatio, 0, 1);
}

export function computeSkillProfile(raw: SkillRawInputs, cfg: EngineConfig = CONFIG): SkillProfile {
  const speed = speedScore(raw.wpmNet, cfg);
  const accuracy = accuracyScore(raw.firstAttemptAccuracy, cfg);
  const consistency = consistencyScoreFromCv(raw.cv);
  const rhythm = rhythmScoreFromMad(raw.residualMad, cfg);
  const weakKeyControl = weakKeyScore(raw.weakKeyRatio);
  const punctuation = punctuationScore(raw.punctRatio);
  const w = cfg.skill.weights;
  const overall =
    w.speed * speed +
    w.accuracy * accuracy +
    w.consistency * consistency +
    w.rhythm * rhythm +
    w.weakKeyControl * weakKeyControl +
    w.punctuation * punctuation;
  return { speed, accuracy, consistency, rhythm, weakKeyControl, punctuation, overall, raw };
}

/**
 * Weak-key ratio (PRD §8.2 dim 5): the user's median key vs their 5 worst
 * keys (min 20 observations each), both as geometric means of IKI.
 */
export function weakKeyRatioFromKeyIkis(
  ikisByKey: ReadonlyMap<string, readonly number[]>,
  cfg: EngineConfig = CONFIG,
): number {
  const { weakKeyWorstN, weakKeyMinObs } = cfg.skill;
  const keyGms: number[] = [];
  const eligible: number[] = [];
  for (const [, ikis] of ikisByKey) {
    if (ikis.length === 0) continue;
    const gm = geometricMean([...ikis]);
    keyGms.push(gm);
    if (ikis.length >= weakKeyMinObs) eligible.push(gm);
  }
  if (keyGms.length === 0 || eligible.length === 0) return 1;
  const mMed = geometricMean(keyGms);
  const worst = eligible.sort((a, b) => b - a).slice(0, weakKeyWorstN);
  const mWorst = geometricMean(worst);
  return mWorst > 0 ? clamp(mMed / mWorst, 0, 1) : 1;
}

export function isPunctChar(ch: string): boolean {
  return /[0-9`~!@#$%^&*()\-_=+\[\]{}\\|;:'",.<>/?£¬]/.test(ch);
}

/** Punctuation ratio (dim 6): alphabetic gm IKI vs punct/symbol/digit gm IKI. */
export function punctRatioFromIkis(
  alphaIkis: readonly number[],
  punctIkis: readonly number[],
): number {
  if (alphaIkis.length < 20 || punctIkis.length < 20) return 1; // not enough data → neutral
  const mAlpha = geometricMean([...alphaIkis]);
  const mPunct = geometricMean([...punctIkis]);
  return mPunct > 0 ? clamp(mAlpha / mPunct, 0, 1) : 1;
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
