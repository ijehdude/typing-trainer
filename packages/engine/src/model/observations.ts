import type { Finger, Layout } from '@typing-trainer/content';
import type { AnalyzedKeystroke } from '../types';

/** One clean IKI measurement with its attribution features (PRD §7.2). */
export interface Observation {
  logIki: number;
  prevChar: string;
  char: string;          // target key b
  finger: Finger | null; // finger of b
  sameHand: boolean;     // hand(a) === hand(b)
  sfb: boolean;          // same finger, different key
  rowJump: 0 | 1 | 2 | 3;
  sessionId: number;     // for confidence gating across sessions
}

/**
 * Extract model observations from analyzed keystrokes: only included IKIs
 * (correct, clean-chain, within timing bounds) become observations.
 */
export function extractObservations(
  keystrokes: readonly AnalyzedKeystroke[],
  layout: Layout,
  sessionId: number,
): Observation[] {
  const out: Observation[] = [];
  let prev: AnalyzedKeystroke | null = null;

  for (const ks of keystrokes) {
    if (ks.iki !== null && !ks.excludedFromTiming && prev !== null) {
      const a = charAttrs(layout, prev.key);
      const b = charAttrs(layout, ks.key);
      if (a && b) {
        const rowJumpRaw = Math.abs((a.row ?? 2) - (b.row ?? 2));
        out.push({
          logIki: Math.log(ks.iki),
          prevChar: prev.key,
          char: ks.key,
          finger: b.finger,
          sameHand: a.hand === b.hand,
          sfb: a.finger === b.finger && prev.key !== ks.key && a.finger !== null,
          rowJump: (rowJumpRaw > 3 ? 3 : rowJumpRaw) as 0 | 1 | 2 | 3,
          sessionId,
        });
      }
    }
    if (ks.correct && !ks.isCorrection && !ks.repeat) prev = ks;
    else prev = null;
  }
  return out;
}

function charAttrs(layout: Layout, char: string) {
  const entry = layout.charIndex[char];
  if (!entry) return null;
  const def = layout.keys[entry.code];
  if (!def) return null;
  return { hand: def.hand, finger: def.finger, row: def.row };
}
