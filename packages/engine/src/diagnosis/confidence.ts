import { CONFIG, type EngineConfig } from '../config';
import type { Confidence } from '../types';

/**
 * Confidence gating (PRD §7.7). No Finding is ever shown below `medium`;
 * the caller turns sub-medium candidates into probes or honest notes.
 */
export function confidenceFor(
  nObs: number,
  nSessions: number,
  absEffect: number,
  se: number,
  cfg: EngineConfig = CONFIG,
): Confidence {
  const c = cfg.confidence;
  if (nObs < c.lowMinObs || nSessions < 2) return 'insufficient';
  if (
    nObs >= c.highMinObs &&
    nSessions >= c.highMinSessions &&
    se > 0 &&
    absEffect >= c.highMinSe * se
  ) {
    return 'high';
  }
  if (
    nObs >= c.mediumMinObs &&
    nSessions >= c.mediumMinSessions &&
    se > 0 &&
    absEffect >= c.mediumMinSe * se
  ) {
    return 'medium';
  }
  return 'low';
}

export function meetsBar(conf: Confidence, bar: Confidence = 'medium'): boolean {
  const order: Confidence[] = ['insufficient', 'low', 'medium', 'high'];
  return order.indexOf(conf) >= order.indexOf(bar);
}
