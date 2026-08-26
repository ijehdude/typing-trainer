import { CONFIG, type EngineConfig } from '../config';
import type { AnalyzedBlock } from '../capture/analyze';
import type { AnalyzedKeystroke } from '../types';

/** Net WPM: (correctChars / 5) / activeMinutes (PRD Appendix A). */
export function netWpm(correctChars: number, activeMs: number): number {
  if (activeMs <= 0) return 0;
  return correctChars / 5 / (activeMs / 60_000);
}

/** Raw WPM: (allChars / 5) / activeMinutes. Corrections don't count as chars. */
export function rawWpm(allChars: number, activeMs: number): number {
  if (activeMs <= 0) return 0;
  return allChars / 5 / (activeMs / 60_000);
}

/** WPM ↔ mean IKI bridge (PRD §7.3): WPM = 12 / m, m in seconds. */
export function wpmFromMeanIkiMs(ikiMs: number): number {
  if (ikiMs <= 0) return 0;
  return 12 / (ikiMs / 1000);
}

export function meanIkiMsFromWpm(wpm: number): number {
  if (wpm <= 0) return Infinity;
  return (12 / wpm) * 1000;
}

/**
 * First-attempt accuracy (PRD §6.4, Appendix A): errors are counted at first
 * attempt on each position regardless of later correction.
 */
export function firstAttemptAccuracy(keystrokes: readonly AnalyzedKeystroke[]): number {
  const firstAttempt = new Map<number, boolean>();
  for (const ks of keystrokes) {
    if (ks.isCorrection) continue;
    if (!firstAttempt.has(ks.index)) firstAttempt.set(ks.index, ks.correct);
  }
  if (firstAttempt.size === 0) return 1;
  let correct = 0;
  for (const ok of firstAttempt.values()) if (ok) correct++;
  return correct / firstAttempt.size;
}

/**
 * Per-second net WPM series within active segments — the input to the
 * consistency score (PRD §8.2 dim 3). Buckets of 1 s; partial trailing
 * buckets are dropped to avoid edge noise.
 */
export function perSecondWpm(block: AnalyzedBlock): number[] {
  const out: number[] = [];
  for (const seg of block.segments) {
    const durMs = seg.endT - seg.startT;
    if (durMs < 1000) continue;
    const buckets = Math.floor(durMs / 1000);
    const counts = new Array<number>(buckets).fill(0);
    for (let i = seg.startIdx; i <= seg.endIdx; i++) {
      const ks = block.keystrokes[i]!;
      if (!ks.correct || ks.isCorrection || ks.repeat) continue;
      const b = Math.floor((ks.t - seg.startT) / 1000);
      if (b < buckets) counts[b] = (counts[b] ?? 0) + 1;
    }
    for (const c of counts) out.push((c / 5) * 60);
  }
  return out;
}

/** Consistency = 100 · clamp(1 − CV, 0, 1) where CV = σ/μ of per-second WPM. */
export function consistencyScore(perSecond: readonly number[]): number {
  if (perSecond.length < 2) return 0;
  const mu = mean(perSecond);
  if (mu <= 0) return 0;
  const cv = Math.sqrt(variance(perSecond, mu)) / mu;
  return 100 * clamp(1 - cv, 0, 1);
}

/** Rhythm = 100 · clamp(1 − MAD(ε)/divisor, 0, 1) over model log-residuals. */
export function rhythmScore(residualMad: number, cfg: EngineConfig = CONFIG): number {
  return 100 * clamp(1 - residualMad / cfg.skill.rhythmMadDivisor, 0, 1);
}

/** Corrections (backspaces) per 100 typed characters. */
export function backspaceRate(keystrokes: readonly AnalyzedKeystroke[]): number {
  let corrections = 0;
  let chars = 0;
  for (const ks of keystrokes) {
    if (ks.isCorrection) corrections++;
    else chars++;
  }
  return chars === 0 ? 0 : (corrections / chars) * 100;
}

/**
 * Share of active time spent in corrections: intervals that lead into a
 * correction keystroke or out of one (PRD §14.3 cause 5).
 */
export function correctionTimePct(block: AnalyzedBlock, cfg: EngineConfig = CONFIG): number {
  if (block.activeMs <= 0) return 0;
  const max = cfg.timing.ikiMaxMs;
  let correctionMs = 0;
  const kss = block.keystrokes;
  for (let i = 1; i < kss.length; i++) {
    const dt = kss[i]!.t - kss[i - 1]!.t;
    if (dt <= 0 || dt > max) continue;
    if (kss[i]!.isCorrection || kss[i - 1]!.isCorrection) correctionMs += dt;
  }
  return correctionMs / block.activeMs;
}

// --- shared math helpers -------------------------------------------------

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function variance(xs: readonly number[], mu = mean(xs)): number {
  if (xs.length < 2) return 0;
  let s = 0;
  for (const x of xs) s += (x - mu) * (x - mu);
  return s / xs.length;
}

/** Median absolute deviation (raw, not normal-consistent). */
export function mad(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const med = median(xs);
  return median(xs.map((x) => Math.abs(x - med)));
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function geometricMean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += Math.log(x);
  return Math.exp(s / xs.length);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
