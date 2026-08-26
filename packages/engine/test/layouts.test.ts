import { describe, expect, it } from 'vitest';
import {
  LAYOUTS, qwertyUs, qwertyUk, dvorak, colemak, colemakDh,
  keysAdjacent, mirrorCode,
} from '@typing-trainer/content';

const ALL = Object.values(LAYOUTS);

describe('layouts (PRD §6.5)', () => {
  it('ships exactly the five V1 layouts', () => {
    expect(Object.keys(LAYOUTS).sort()).toEqual(
      ['colemak', 'colemak-dh', 'dvorak', 'qwerty-uk', 'qwerty-us'].sort(),
    );
  });

  it.each(ALL.map((l) => [l.id, l] as const))('%s covers a–z, 0–9, space', (_id, layout) => {
    for (const c of 'abcdefghijklmnopqrstuvwxyz0123456789 ') {
      expect(layout.charIndex[c], `missing ${JSON.stringify(c)}`).toBeDefined();
    }
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      expect(layout.charIndex[c]?.shifted).toBe(true);
    }
  });

  it.each(ALL.map((l) => [l.id, l] as const))('%s finger/hand are consistent', (_id, layout) => {
    for (const def of Object.values(layout.keys)) {
      expect(def.hand).toBe(def.finger.startsWith('L') ? 'L' : 'R');
      expect(def.homeDistance).toBeGreaterThanOrEqual(0);
    }
  });

  it('resolves QWERTY-US home row correctly', () => {
    expect(qwertyUs.keys['KeyF']).toMatchObject({
      char: 'f', shiftChar: 'F', hand: 'L', finger: 'LI', row: 2, homeDistance: 0,
    });
    expect(qwertyUs.keys['Semicolon']).toMatchObject({ char: ';', shiftChar: ':', finger: 'RP' });
    expect(qwertyUs.charIndex['A']).toEqual({ code: 'KeyA', shifted: true });
  });

  it('resolves Dvorak remapping (physical KeyF produces u)', () => {
    expect(dvorak.keys['KeyF']!.char).toBe('u');
    expect(dvorak.keys['Quote']!.char).toBe('-');
    expect(dvorak.charIndex["'"]!.code).toBe('KeyQ');
    // Physical geometry is unchanged: whatever char lives on KeyF is left index.
    expect(dvorak.keys['KeyF']!.finger).toBe('LI');
  });

  it('resolves Colemak and Colemak-DH home rows', () => {
    expect(colemak.keys['KeyS']!.char).toBe('r');
    expect(colemak.keys['KeyN']!.char).toBe('k');
    expect(colemakDh.keys['KeyH']!.char).toBe('m');
    expect(colemakDh.keys['KeyB']!.char).toBe('v');
  });

  it('QWERTY-UK national variants', () => {
    expect(qwertyUk.charIndex['"']).toEqual({ code: 'Digit2', shifted: true });
    expect(qwertyUk.charIndex['@']).toEqual({ code: 'Quote', shifted: true });
    expect(qwertyUk.charIndex['£']).toEqual({ code: 'Digit3', shifted: true });
    expect(qwertyUk.keys['Backslash']!.char).toBe('#');
    expect(qwertyUk.keys['IntlBackslash']!.char).toBe('\\');
  });

  it('adjacency and mirror helpers', () => {
    expect(keysAdjacent('KeyJ', 'KeyK')).toBe(true);
    expect(keysAdjacent('KeyJ', 'KeyU')).toBe(true);
    expect(keysAdjacent('KeyA', 'KeyP')).toBe(false);
    expect(mirrorCode('KeyF')).toBe('KeyJ');
    expect(mirrorCode('KeyA')).toBe('Semicolon');
    expect(mirrorCode('KeyQ')).toBe('KeyP');
  });
});
