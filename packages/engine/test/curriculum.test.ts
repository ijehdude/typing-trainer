import { describe, expect, it } from 'vitest';
import { qwertyUs, unlockOrder, typeableWords } from '@typing-trainer/content';
import {
  applyGate, canUnlockNext, commonBigrams, gateDecision, initialCurriculumState,
  newPatternCandidates, nextUnlockChar, type CharStats,
} from '../src/curriculum/index';

describe('curriculum (PRD §11)', () => {
  it('unlock order starts with the home row and covers all 26 letters', () => {
    const order = unlockOrder(qwertyUs);
    expect(new Set(order).size).toBe(26);
    expect(order.slice(0, 9).sort()).toEqual('asdfghjkl'.split('').sort());
  });

  it('unlock order grows typeable vocabulary quickly (word-coverage greedy)', () => {
    const order = unlockOrder(qwertyUs);
    const at = (n: number) => typeableWords(new Set(order.slice(0, n))).length;
    expect(at(14)).toBeGreaterThan(at(11));
    expect(at(11)).toBeGreaterThan(at(9));
    // e or t (highest coverage letters) should arrive right after home row.
    expect(['e', 't', 'o', 'i', 'n'].includes(order[9]!)).toBe(true);
  });

  it('common bigrams are the real English workhorses', () => {
    const top = commonBigrams(10);
    expect(top).toContain('th');
    expect(top).toContain('he');
  });

  it('promotion gate follows §10.2 exactly', () => {
    const base = {
      recentCorrect: 30, recentTotal: 30, gmIki: 150,
      globalGmIki: 150, sessionsSeen: 2, residualDecile: 4,
    };
    expect(gateDecision(base)).toBe('promote');
    expect(gateDecision({ ...base, recentCorrect: 29 })).toBe('stay');           // 96.7% < 98%
    expect(gateDecision({ ...base, gmIki: 190 })).toBe('stay');                  // 1.27× > 1.20×
    expect(gateDecision({ ...base, sessionsSeen: 1 })).toBe('stay');
    expect(gateDecision({ ...base, residualDecile: 9 })).toBe('stay');
    expect(gateDecision({ ...base, recentTotal: 20, recentCorrect: 18 })).toBe('demote'); // 90% < 93%
  });

  it('demotion is applied and clamped at the real-words floor', () => {
    let state = initialCurriculumState(qwertyUs, true);
    state = applyGate(state, 'io', 'promote');
    expect(state.stageByPattern['io']).toBe(3); // from the minStage entry point
    state = applyGate(state, 'io', 'demote');
    state = applyGate(state, 'io', 'demote');
    state = applyGate(state, 'io', 'demote');
    expect(state.stageByPattern['io']).toBe(2); // never drops into pseudo-words
  });

  it('foundations unlocking requires the §11.2 bar on every unlocked char', () => {
    const good: CharStats[] = 'asdfghjkl'.split('').map((char) => ({
      char, accuracy: 0.98, gmIki: 180, n: 45,
    }));
    expect(canUnlockNext(good, 'asdfghjkl', 160)).toBe(true);
    const slowOne = good.map((s) => (s.char === 'k' ? { ...s, gmIki: 230 } : s));
    expect(canUnlockNext(slowOne, 'asdfghjkl', 160)).toBe(false); // 230 > 1.35×160
    const thinOne = good.map((s) => (s.char === 'j' ? { ...s, n: 20 } : s));
    expect(canUnlockNext(thinOne, 'asdfghjkl', 160)).toBe(false);
  });

  it('next unlock char follows the precomputed order', () => {
    const order = unlockOrder(qwertyUs);
    expect(nextUnlockChar(qwertyUs, order.slice(0, 12).join(''))).toBe(order[12]);
    expect(nextUnlockChar(qwertyUs, order.join(''))).toBeNull();
  });

  it('new-pattern candidates respect unlocked chars in Foundations', () => {
    const state = initialCurriculumState(qwertyUs, false);
    const candidates = newPatternCandidates(state, qwertyUs);
    for (const c of candidates) {
      for (const ch of c) expect(state.unlockedChars).toContain(ch);
    }
  });
});
