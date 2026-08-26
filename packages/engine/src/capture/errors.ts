import type { Layout } from '@typing-trainer/content';
import { keysAdjacent, mirrorCode } from '@typing-trainer/content';
import type { ErrorType, Keystroke } from '../types';

/**
 * Classify an error keystroke (PRD §6.3). Computed at analysis time from the
 * layout map. Precedence: transposition > omission > insertion > mirror >
 * adjacent-key > same-finger > substitution.
 */
export function classifyError(
  ks: Keystroke,
  next: Keystroke | undefined,
  layout: Layout,
  targetText: string,
): ErrorType {
  const expectedNext = targetText[ks.index + 1];
  const expectedPrev = ks.index > 0 ? targetText[ks.index - 1] : undefined;

  // Transposition: n and n+1 typed in swapped order.
  if (
    expectedNext !== undefined &&
    ks.key === expectedNext &&
    next !== undefined &&
    !next.isCorrection &&
    next.key === ks.expected
  ) {
    return 'transposition';
  }

  // Omission: the user skipped this character and typed the next one.
  if (expectedNext !== undefined && ks.key === expectedNext) return 'omission';

  // Insertion: repeated the previous character (extra char not in target here).
  if (expectedPrev !== undefined && ks.key === expectedPrev) return 'insertion';

  const typedKey = layout.charIndex[ks.key];
  const expectedKey = layout.charIndex[ks.expected];
  if (typedKey && expectedKey) {
    if (mirrorCode(expectedKey.code) === typedKey.code) return 'mirror';
    if (keysAdjacent(typedKey.code, expectedKey.code)) return 'adjacent_key';
    const typedFinger = layout.keys[typedKey.code]?.finger;
    const expectedFinger = layout.keys[expectedKey.code]?.finger;
    if (typedFinger && typedFinger === expectedFinger) return 'same_finger';
  }

  return 'substitution';
}
