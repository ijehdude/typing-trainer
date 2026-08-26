import { describe, expect, it } from 'vitest';
import { qwertyUs } from '@typing-trainer/content';
import { analyzeBlock } from '../src/capture/analyze';
import type { Keystroke } from '../src/types';

function ks(partial: Partial<Keystroke> & { t: number; key: string; expected: string; index: number }): Keystroke {
  return {
    tUp: partial.t + 70,
    code: 'KeyA',
    correct: partial.key === partial.expected,
    isCorrection: false,
    repeat: false,
    modifiers: 0,
    ...partial,
  };
}

describe('analyzeBlock — timing hygiene (PRD §6.2)', () => {
  it('computes IKI between consecutive correct keydowns', () => {
    const raw = [
      ks({ t: 1000, key: 't', expected: 't', index: 0 }),
      ks({ t: 1200, key: 'h', expected: 'h', index: 1 }),
      ks({ t: 1450, key: 'e', expected: 'e', index: 2 }),
    ];
    const { keystrokes } = analyzeBlock(raw, qwertyUs, 'the');
    expect(keystrokes[0]!.iki).toBeNull();
    expect(keystrokes[0]!.excludedFromTiming).toBe(true); // no predecessor
    expect(keystrokes[1]!.iki).toBe(200);
    expect(keystrokes[1]!.excludedFromTiming).toBe(false);
    expect(keystrokes[2]!.iki).toBe(250);
  });

  it('excludes key-repeat and sub-15ms rollover artifacts but records them', () => {
    const raw = [
      ks({ t: 1000, key: 'a', expected: 'a', index: 0 }),
      ks({ t: 1010, key: 'b', expected: 'b', index: 1 }),            // 10 ms < 15 ms
      ks({ t: 1200, key: 'c', expected: 'c', index: 2, repeat: true }),
    ];
    const { keystrokes } = analyzeBlock(raw, qwertyUs, 'abc');
    expect(keystrokes[1]!.excludedFromTiming).toBe(true);
    expect(keystrokes[1]!.iki).toBe(10); // recorded, just flagged
    expect(keystrokes[2]!.excludedFromTiming).toBe(true);
    expect(keystrokes).toHaveLength(3);
  });

  it('splits segments at pauses > 2000 ms and excludes them from active time', () => {
    const raw = [
      ks({ t: 1000, key: 'a', expected: 'a', index: 0 }),
      ks({ t: 1250, key: 'b', expected: 'b', index: 1 }),
      ks({ t: 4000, key: 'c', expected: 'c', index: 2 }), // 2750 ms gap: user sneezed
      ks({ t: 4250, key: 'd', expected: 'd', index: 3 }),
    ];
    const block = analyzeBlock(raw, qwertyUs, 'abcd');
    expect(block.segments).toHaveLength(2);
    expect(block.activeMs).toBe(250 + 250);
    expect(block.keystrokes[2]!.excludedFromTiming).toBe(true);
  });

  it('breaks the IKI chain across errors and corrections', () => {
    const raw = [
      ks({ t: 1000, key: 'c', expected: 'c', index: 0 }),
      ks({ t: 1200, key: 'x', expected: 'a', index: 1 }),                       // error
      ks({ t: 1400, key: 'Backspace', expected: 'a', index: 1, isCorrection: true, correct: false }),
      ks({ t: 1600, key: 'a', expected: 'a', index: 1 }),                       // retype
      ks({ t: 1800, key: 't', expected: 't', index: 2 }),
    ];
    const { keystrokes } = analyzeBlock(raw, qwertyUs, 'cat');
    expect(keystrokes[3]!.excludedFromTiming).toBe(true);  // follows a correction
    expect(keystrokes[4]!.iki).toBe(200);                  // clean retype → t transition
    expect(keystrokes[4]!.excludedFromTiming).toBe(false);
  });

  it('flags non-monotonic timestamps as timing_suspect', () => {
    const raw = [
      ks({ t: 2000, key: 'a', expected: 'a', index: 0 }),
      ks({ t: 1500, key: 'b', expected: 'b', index: 1 }),
    ];
    expect(analyzeBlock(raw, qwertyUs, 'ab').timingSuspect).toBe(true);
  });

  it('resolves hand/finger/row from the layout, not the produced key', () => {
    const raw = [ks({ t: 1000, key: 'j', expected: 'f', index: 0 })];
    const { keystrokes } = analyzeBlock(raw, qwertyUs, 'f');
    expect(keystrokes[0]!.finger).toBe('LI'); // finger of the *expected* key
    expect(keystrokes[0]!.hand).toBe('L');
    expect(keystrokes[0]!.row).toBe(2);
  });
});

describe('error classification (PRD §6.3)', () => {
  function classify(target: string, strokes: Array<[number, string, string, number]>) {
    const raw = strokes.map(([t, key, expected, index]) => ks({ t, key, expected, index }));
    return analyzeBlock(raw, qwertyUs, target).keystrokes.map((k) => k.errorType);
  }

  it('detects transposition (swapped order)', () => {
    const types = classify('the', [
      [1000, 't', 't', 0],
      [1100, 'e', 'h', 1],
      [1200, 'h', 'e', 2],
    ]);
    expect(types[1]).toBe('transposition');
  });

  it('detects omission (skipped character)', () => {
    const types = classify('the', [
      [1000, 't', 't', 0],
      [1100, 'e', 'h', 1],
      [1200, 'x', 'e', 2],
    ]);
    expect(types[1]).toBe('omission');
  });

  it('detects insertion (repeated previous character)', () => {
    const types = classify('the', [
      [1000, 't', 't', 0],
      [1100, 't', 'h', 1],
    ]);
    expect(types[1]).toBe('insertion');
  });

  it('detects adjacent-key substitution', () => {
    const types = classify('j', [[1000, 'k', 'j', 0]]);
    expect(types[0]).toBe('adjacent_key');
  });

  it('detects same-finger substitution', () => {
    const types = classify('j', [[1000, 'y', 'j', 0]]);
    expect(types[0]).toBe('same_finger');
  });

  it('detects mirror substitution (hand confusion)', () => {
    const types = classify('f', [[1000, 'j', 'f', 0]]);
    expect(types[0]).toBe('mirror');
  });

  it('falls back to substitution', () => {
    const types = classify('a', [[1000, 'p', 'a', 0]]);
    expect(types[0]).toBe('substitution');
  });

  it('correct keystrokes carry no error type', () => {
    const types = classify('a', [[1000, 'a', 'a', 0]]);
    expect(types[0]).toBeNull();
  });
});
