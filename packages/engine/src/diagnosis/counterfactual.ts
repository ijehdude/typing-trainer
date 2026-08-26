import type { Finger, Layout } from '@typing-trainer/content';
import { median } from '../metrics/index';
import type { ModelParams } from '../model/ridge';
import { predictLogIki } from '../model/ridge';

/**
 * Counterfactual WPM cost (PRD §7.4): predicted mean IKI over the user's
 * reference corpus under the fitted model, vs the same corpus with one
 * coefficient replaced by the user's own peer median. The claim is "if this
 * were as good as the rest of you" — never zero, never a population value.
 */

export type Effect =
  | { type: 'finger'; finger: Finger }
  | { type: 'key'; char: string }
  | { type: 'bigram'; bigram: string }
  | { type: 'class'; cls: 'sfb' | 'row_jump' };

/** Normalized transition frequencies of a reference corpus (PRD §7.4 step 1). */
export function transitionFrequencies(text: string, layout: Layout): Map<string, number> {
  const counts = new Map<string, number>();
  let total = 0;
  const lower = text;
  for (let i = 1; i < lower.length; i++) {
    const a = lower[i - 1]!;
    const b = lower[i]!;
    if (!layout.charIndex[a] || !layout.charIndex[b]) continue;
    const bg = a + b;
    counts.set(bg, (counts.get(bg) ?? 0) + 1);
    total++;
  }
  const out = new Map<string, number>();
  for (const [bg, c] of counts) out.set(bg, c / total);
  return out;
}

interface TransitionFeatures {
  prevChar: string;
  char: string;
  finger: Finger | null;
  sameHand: boolean;
  sfb: boolean;
  rowJump: 0 | 1 | 2 | 3;
}

export function transitionFeatures(bigram: string, layout: Layout): TransitionFeatures | null {
  const a = bigram[0]!;
  const b = bigram[1]!;
  const ea = layout.charIndex[a];
  const eb = layout.charIndex[b];
  if (!ea || !eb) return null;
  const da = layout.keys[ea.code]!;
  const db = layout.keys[eb.code]!;
  const jump = Math.abs(da.row - db.row);
  return {
    prevChar: a,
    char: b,
    finger: db.finger,
    sameHand: da.hand === db.hand,
    sfb: da.finger === db.finger && a !== b,
    rowJump: (jump > 3 ? 3 : jump) as 0 | 1 | 2 | 3,
  };
}

/** Predicted corpus-weighted mean IKI in ms: Σ freq(t) · exp(logIKI_pred(t)). */
export function corpusMeanIki(
  params: ModelParams,
  freqs: ReadonlyMap<string, number>,
  layout: Layout,
  override?: (f: TransitionFeatures) => TransitionFeatures,
): number {
  let m = 0;
  let covered = 0;
  for (const [bigram, freq] of freqs) {
    let f = transitionFeatures(bigram, layout);
    if (!f) continue;
    if (override) f = override(f);
    m += freq * Math.exp(predictLogIki(params, f));
    covered += freq;
  }
  return covered > 0 ? m / covered : 0;
}

/** Counterfactual params with `effect`'s coefficient set to its peer median. */
export function counterfactualParams(params: ModelParams, effect: Effect): ModelParams {
  switch (effect.type) {
    case 'finger': {
      const peers = Object.entries(params.phi)
        .filter(([f]) => f !== effect.finger)
        .map(([, v]) => v);
      return { ...params, phi: { ...params.phi, [effect.finger]: median(peers) } };
    }
    case 'key': {
      const peers = Object.entries(params.kappa)
        .filter(([k]) => k !== effect.char)
        .map(([, v]) => v);
      return { ...params, kappa: { ...params.kappa, [effect.char]: median(peers) } };
    }
    case 'bigram': {
      const peers = Object.entries(params.delta)
        .filter(([b]) => b !== effect.bigram)
        .map(([, v]) => v);
      return { ...params, delta: { ...params.delta, [effect.bigram]: median(peers) } };
    }
    case 'class':
      // Scalar classes have no within-user peers; the fair counterfactual is
      // "no extra penalty at all" (as good as ordinary transitions).
      if (effect.cls === 'sfb') return { ...params, sigmaSfb: 0 };
      return { ...params, rho: {} };
  }
}

/**
 * estimateCost (PRD §7.4): ΔWPM = 12/m_counterfactual − 12/m_actual,
 * both predicted over the reference corpus. Positive = WPM gained if fixed.
 */
export function estimateCost(
  effect: Effect,
  params: ModelParams,
  freqs: ReadonlyMap<string, number>,
  layout: Layout,
): number {
  const mActualMs = corpusMeanIki(params, freqs, layout);
  if (mActualMs <= 0) return 0;
  const mCfMs = corpusMeanIki(counterfactualParams(params, effect), freqs, layout);
  if (mCfMs <= 0) return 0;
  return 12 / (mCfMs / 1000) - 12 / (mActualMs / 1000);
}
