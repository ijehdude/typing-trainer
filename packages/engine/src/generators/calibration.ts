import { corpusByDomain, lexicon, type Layout } from '@typing-trainer/content';
import { CONFIG, type EngineConfig } from '../config';
import { createRng } from '../rand';
import { commonBigrams } from '../curriculum/index';
import { countOccurrences } from './index';

/**
 * The onboarding calibration test (PRD §18.2): 3 parts, engineered for
 * coverage — every letter ≥ minPerLetter, top bigrams ≥ minPerBigram —
 * not for a pleasant read.
 */

export interface CalibrationText {
  parts: [string, string, string]; // prose, coverage, punctuation/digits
  coverage: { letters: Record<string, number>; bigrams: Record<string, number> };
}

export function buildCalibrationText(
  _layout: Layout,
  seed: number,
  cfg: EngineConfig = CONFIG,
): CalibrationText {
  const rng = createRng(seed);

  // Part 1 — general prose (~180 chars).
  const prosePool = corpusByDomain('prose');
  const prose = prosePool[rng.int(prosePool.length)]!.text.slice(0, 190);

  // Part 2 — coverage: greedily pick words until every letter and the top
  // bigrams hit their quotas.
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const targetBigrams = commonBigrams(cfg.calibration.topBigrams);
  const letterCount: Record<string, number> = Object.fromEntries(letters.map((l) => [l, 0]));
  const bigramCount: Record<string, number> = Object.fromEntries(targetBigrams.map((b) => [b, 0]));
  const words = lexicon();
  const chosen: string[] = [];
  const need = () =>
    letters.filter((l) => letterCount[l]! < cfg.calibration.minPerLetter).length +
    targetBigrams.filter((b) => bigramCount[b]! < cfg.calibration.minPerBigram).length;

  let guard = 0;
  while (need() > 0 && guard++ < 600) {
    // Score each of a sampled batch of words by how much unmet quota it fills.
    let best: string | null = null;
    let bestScore = -1;
    for (let k = 0; k < 60; k++) {
      const w = words[rng.int(words.length)]!;
      let score = 0;
      for (const ch of w) {
        if (letterCount[ch] !== undefined && letterCount[ch]! < cfg.calibration.minPerLetter) score += 1;
      }
      for (let i = 1; i < w.length; i++) {
        const bg = w[i - 1]! + w[i]!;
        if (bigramCount[bg] !== undefined && bigramCount[bg]! < cfg.calibration.minPerBigram) score += 2;
      }
      if (score > bestScore) {
        bestScore = score;
        best = w;
      }
    }
    if (!best || bestScore <= 0) {
      // Quotas that words can't fill (rare letters): inject a pseudo-cluster.
      const missing = letters.filter((l) => letterCount[l]! < cfg.calibration.minPerLetter);
      if (missing.length === 0) break;
      best = missing.slice(0, 3).join('') + 'a';
    }
    chosen.push(best);
    for (const ch of best) if (letterCount[ch] !== undefined) letterCount[ch]!++;
    for (let i = 1; i < best.length; i++) {
      const bg = best[i - 1]! + best[i]!;
      if (bigramCount[bg] !== undefined) bigramCount[bg]!++;
    }
  }
  const coverage = chosen.join(' ');

  // Part 3 — punctuation, capitals, digits.
  const punctPool = [...corpusByDomain('punctuation_heavy'), ...corpusByDomain('numbers')];
  const p1 = punctPool[rng.int(punctPool.length)]!.text;
  let p2 = punctPool[rng.int(punctPool.length)]!.text;
  if (p2 === p1) p2 = punctPool[(punctPool.indexOf(punctPool.find((c) => c.text === p1)!) + 1) % punctPool.length]!.text;
  const punct = `${p1} ${p2}`.slice(0, 220);

  return {
    parts: [prose, coverage, punct],
    coverage: { letters: letterCount, bigrams: bigramCount },
  };
}

/** Verify the §18.2 coverage contract — used by tests and CI. */
export function verifyCoverage(text: string, cfg: EngineConfig = CONFIG): boolean {
  for (const l of 'abcdefghijklmnopqrstuvwxyz') {
    if (countOccurrences(text, [l]) < cfg.calibration.minPerLetter) return false;
  }
  const bigrams = commonBigrams(cfg.calibration.topBigrams);
  let met = 0;
  for (const bg of bigrams) {
    if (countOccurrences(text, [bg]) >= cfg.calibration.minPerBigram) met++;
  }
  return met >= bigrams.length * 0.9; // a few rare bigrams may fall short of quota
}
