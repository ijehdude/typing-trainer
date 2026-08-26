import { CONFIG, type EngineConfig } from '../config';
import type { AnalyzedKeystroke } from '../types';

/**
 * The live in-block analyzer (PRD §13.1). Fed batches of ~8 keystrokes from
 * the worker; maintains per-target EWMA statistics and signals when the
 * target ranking has changed materially. Never touches the input path.
 */

export interface LiveTargetState {
  pattern: string;
  /** Corpus frequency weight for cost proxying. */
  freq: number;
  ewmaIki: number | null;
  n: number;
  errors: number;
}

export interface RetargetSignal {
  from: string;
  to: string;
  /** Live cost estimates that produced the signal. */
  costs: Record<string, number>;
}

const EWMA_ALPHA = 0.18;

export class LiveAnalyzer {
  private readonly targets = new Map<string, LiveTargetState>();
  private currentTop: string | null = null;

  constructor(
    targets: ReadonlyArray<{ pattern: string; freq: number }>,
    private readonly cfg: EngineConfig = CONFIG,
  ) {
    for (const t of targets) {
      this.targets.set(t.pattern, { pattern: t.pattern, freq: t.freq, ewmaIki: null, n: 0, errors: 0 });
    }
    this.currentTop = this.rank()[0]?.pattern ?? null;
  }

  /** Feed a batch of analyzed keystrokes (every ~8 correct keys, §13.1). */
  push(batch: readonly AnalyzedKeystroke[]): RetargetSignal | null {
    for (let i = 0; i < batch.length; i++) {
      const ks = batch[i]!;
      const prev = i > 0 ? batch[i - 1] : undefined;
      for (const state of this.targets.values()) {
        const matches =
          state.pattern.length === 1
            ? ks.key === state.pattern
            : prev !== undefined && prev.key + ks.key === state.pattern;
        if (!matches) continue;
        if (ks.errorType !== null) state.errors++;
        if (ks.iki !== null && !ks.excludedFromTiming) {
          state.ewmaIki =
            state.ewmaIki === null ? ks.iki : state.ewmaIki + EWMA_ALPHA * (ks.iki - state.ewmaIki);
          state.n++;
        }
      }
    }
    return this.maybeRetarget();
  }

  /** Live cost proxy: EWMA IKI weighted by corpus frequency. */
  rank(): Array<{ pattern: string; cost: number }> {
    return [...this.targets.values()]
      .map((s) => ({ pattern: s.pattern, cost: (s.ewmaIki ?? 250) * s.freq * (1 + s.errors * 0.2) }))
      .sort((a, b) => b.cost - a.cost);
  }

  private maybeRetarget(): RetargetSignal | null {
    const ranked = this.rank();
    if (ranked.length < 2 || this.currentTop === null) return null;
    const top = ranked[0]!;
    if (top.pattern === this.currentTop) return null;
    // Only signal when the old top has fallen behind by > retargetMargin (§13.1).
    const oldTop = ranked.find((r) => r.pattern === this.currentTop);
    if (!oldTop || oldTop.cost > top.cost * (1 - this.cfg.live.retargetMargin)) return null;
    const signal: RetargetSignal = {
      from: this.currentTop,
      to: top.pattern,
      costs: Object.fromEntries(ranked.map((r) => [r.pattern, r.cost])),
    };
    this.currentTop = top.pattern;
    return signal;
  }
}
