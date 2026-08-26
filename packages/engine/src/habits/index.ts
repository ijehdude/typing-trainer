import { CONFIG, type EngineConfig } from '../config';
import { mean, median } from '../metrics/index';
import type { Observation } from '../model/observations';
import type { ModelParams } from '../model/ridge';
import type { HabitFlag, SessionMetrics, TradeoffCurve } from '../types';
import type { TradeoffPoint } from '../model/tradeoff';

/**
 * Bad-habit detection (PRD §15) — V1's four detectors: visual search,
 * hand imbalance, backspace thrash, overdriving. Habits are hypotheses
 * with evidence (§15.4): copy is hedged, never an observation claim.
 */

export interface HabitInput {
  params: ModelParams;
  observations: readonly Observation[];
  sessionMetrics: SessionMetrics;
  tradeoff: TradeoffCurve;
  tradeoffPoints?: readonly TradeoffPoint[];
  /** Per-hand IKI ratios (R/L) from previous sessions, most recent last. */
  handRatioHistory?: readonly number[];
}

export function detectHabits(input: HabitInput, cfg: EngineConfig = CONFIG): HabitFlag[] {
  const flags: HabitFlag[] = [];
  const h = cfg.habits;

  // 1 — Visual search for a key: raw latency far above comparable keys
  // (PRD §15.1 measures latency vs neighbours, before finger attribution).
  const meanIkiByKey = new Map<string, number>();
  {
    const byKey = new Map<string, number[]>();
    for (const o of input.observations) {
      if (!/^[a-z]$/.test(o.char)) continue;
      let arr = byKey.get(o.char);
      if (!arr) byKey.set(o.char, (arr = []));
      arr.push(Math.exp(o.logIki));
    }
    for (const [k, ikis] of byKey) {
      if (ikis.length >= 30) meanIkiByKey.set(k, mean(ikis));
    }
  }
  if (meanIkiByKey.size >= 8) {
    const med = median([...meanIkiByKey.values()]);
    const worst = [...meanIkiByKey.entries()]
      .map(([key, ms]) => ({ key, ms, ratio: ms / med }))
      .sort((a, b) => b.ratio - a.ratio)[0];
    if (worst && worst.ratio >= h.visualSearchLatencyRatio) {
      flags.push({
        habit: 'visual_search',
        evidence: `You pause before ${worst.key}. Your average time onto ${worst.key} is ${Math.round(worst.ms)} ms, against ${Math.round(med)} ms for comparable keys. This pattern is consistent with visually searching for the key.`,
        metrics: { key: worst.key.charCodeAt(0), ratio: worst.ratio },
        remedy: {
          findingCause: `key:${worst.key}`,
          blockKind: 'target',
          stage: 0,
          targets: [worst.key],
          minutes: 1.5,
          visibility: 'keyboard_hidden',
          note: `A 90-second ${worst.key} drill with the keyboard hidden.`,
        },
      });
    }
  }

  // 2 — Hand imbalance, sustained over sessions.
  const ratio = handIkiRatio(input.observations);
  if (ratio !== null) {
    const history = [...(input.handRatioHistory ?? []), ratio];
    const sustained = history.slice(-h.handImbalanceSessions);
    if (
      sustained.length >= h.handImbalanceSessions &&
      sustained.every((r) => Math.max(r, 1 / r) >= 1 + h.handImbalancePct)
    ) {
      const slower = ratio > 1 ? 'right' : 'left';
      const pct = Math.round((Math.max(ratio, 1 / ratio) - 1) * 100);
      flags.push({
        habit: 'hand_imbalance',
        evidence: `Your ${slower} hand has run about ${pct}% slower than the other across your last ${sustained.length} sessions.`,
        metrics: { ratio },
        remedy: {
          findingCause: 'class:hand_imbalance',
          blockKind: 'target',
          stage: 1,
          targets: [],
          minutes: 4,
          visibility: 'keyboard_hidden',
          note: `Finger-independence drills weighted toward the ${slower} hand.`,
        },
      });
    }
  }

  // 3 — Backspace thrash.
  if (input.sessionMetrics.backspaceRate >= h.backspaceThrashPer100) {
    flags.push({
      habit: 'backspace_thrash',
      evidence: `You corrected ${Math.round(input.sessionMetrics.backspaceRate)} times per 100 characters this session — enough to cost real time.`,
      metrics: { per100: input.sessionMetrics.backspaceRate },
      remedy: {
        findingCause: 'class:backspace',
        blockKind: 'target',
        stage: 2,
        targets: [],
        minutes: 5,
        visibility: 'keyboard_hidden',
        note: 'Strict-mode precision blocks a touch below your control speed.',
      },
    });
  }

  // 4 — Overdriving: sustained typing above collapse speed.
  if (input.tradeoff.vCollapse > 0 && input.tradeoffPoints && input.tradeoffPoints.length > 200) {
    const above = input.tradeoffPoints.filter((p) => p.localWpm > input.tradeoff.vCollapse).length;
    const share = above / input.tradeoffPoints.length;
    if (share > h.overdrivingKeystrokeShare) {
      flags.push({
        habit: 'overdriving',
        evidence: `${Math.round(share * 100)}% of your typing ran above ${Math.round(input.tradeoff.vCollapse)} WPM, where your accuracy predictably collapses. Pushing speed here is what a plateau feels like from the inside.`,
        metrics: { share, vCollapse: input.tradeoff.vCollapse },
        remedy: {
          findingCause: 'class:overdrive',
          blockKind: 'target',
          stage: 4,
          targets: [],
          minutes: 5,
          visibility: 'keyboard_hidden',
          note: `Precision blocks paced at ${Math.max(20, Math.round(input.tradeoff.vControl - 5))} WPM to rebuild the ceiling from below.`,
        },
      });
    }
  }

  return flags;
}

/** Mean right-hand IKI / mean left-hand IKI over clean observations. */
export function handIkiRatio(obs: readonly Observation[]): number | null {
  const left: number[] = [];
  const right: number[] = [];
  for (const o of obs) {
    if (!o.finger || o.char === ' ') continue;
    (o.finger.startsWith('L') ? left : right).push(Math.exp(o.logIki));
  }
  if (left.length < 50 || right.length < 50) return null;
  return mean(right) / mean(left);
}
