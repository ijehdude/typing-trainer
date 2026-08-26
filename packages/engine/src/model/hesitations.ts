import { CONFIG, type EngineConfig } from '../config';
import { mad, median } from '../metrics/index';
import type { Observation } from './observations';
import type { ModelParams } from './ridge';
import { predictLogIki } from './ridge';

/**
 * Rhythm residual analysis (PRD §7.6): hesitations are keystrokes whose
 * model residual exceeds +2.5 MAD of the residual distribution. Their rate
 * and where they concentrate are first-class outputs.
 */
export interface HesitationAnalysis {
  /** Hesitations per 100 observations. */
  rate: number;
  /** MAD of residuals in log space (difficulty-adjusted rhythm input). */
  residualMad: number;
  /** Transitions ranked by hesitation count, desc. */
  topTransitions: Array<{ bigram: string; count: number; share: number }>;
  totalHesitations: number;
}

export function analyzeHesitations(
  params: ModelParams,
  obs: readonly Observation[],
  cfg: EngineConfig = CONFIG,
): HesitationAnalysis {
  if (obs.length === 0) {
    return { rate: 0, residualMad: 0, topTransitions: [], totalHesitations: 0 };
  }
  const residuals = obs.map((o) => o.logIki - predictLogIki(params, o));
  const med = median(residuals);
  const m = mad(residuals);
  const threshold = med + cfg.model.hesitationMadThreshold * m;

  const byBigram = new Map<string, number>();
  let total = 0;
  residuals.forEach((r, i) => {
    if (m > 0 && r > threshold) {
      total++;
      const bg = obs[i]!.prevChar + obs[i]!.char;
      byBigram.set(bg, (byBigram.get(bg) ?? 0) + 1);
    }
  });

  const topTransitions = [...byBigram.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 10)
    .map(([bigram, count]) => ({ bigram, count, share: total > 0 ? count / total : 0 }));

  return {
    rate: (total / obs.length) * 100,
    residualMad: m,
    topTransitions,
    totalHesitations: total,
  };
}
