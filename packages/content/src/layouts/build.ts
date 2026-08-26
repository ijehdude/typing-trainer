import { KEY_GEOMETRY } from './geometry';
import type { KeyDef, Layout } from './types';

/**
 * A layout definition is just `code → base char` for printable keys; shift
 * characters are derived (uppercase for letters, the pair table for symbols,
 * overridable per layout for national variants).
 */
export interface LayoutSpec {
  id: string;
  name: string;
  chars: Record<string, string>;
  /** Symbol shift pairs beyond the ANSI-US defaults (e.g. UK Digit2 → "). */
  shiftOverrides?: Record<string, string>;
}

/** ANSI-US symbol shift pairs. */
const SHIFT_PAIRS: Record<string, string> = {
  '`': '~', '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^',
  '7': '&', '8': '*', '9': '(', '0': ')', '-': '_', '=': '+',
  '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"',
  ',': '<', '.': '>', '/': '?', ' ': ' ',
};

export function buildLayout(spec: LayoutSpec): Layout {
  const keys: Record<string, KeyDef> = {};
  const charIndex: Record<string, { code: string; shifted: boolean }> = {};

  for (const [code, char] of Object.entries(spec.chars)) {
    const geo = KEY_GEOMETRY[code];
    if (!geo) throw new Error(`No geometry for code ${code} in layout ${spec.id}`);
    const shiftChar =
      spec.shiftOverrides?.[code] ??
      (/^[a-z]$/.test(char) ? char.toUpperCase() : SHIFT_PAIRS[char] ?? char);
    keys[code] = { code, char, shiftChar, ...geo };
    if (!(char in charIndex)) charIndex[char] = { code, shifted: false };
    if (!(shiftChar in charIndex)) charIndex[shiftChar] = { code, shifted: true };
  }

  return { id: spec.id, name: spec.name, keys, charIndex };
}

/** Helper: assign a row of physical codes to a string of base characters. */
export function rowChars(codes: readonly string[], chars: string): Record<string, string> {
  const out: Record<string, string> = {};
  const cs = [...chars];
  if (cs.length > codes.length) throw new Error('More chars than codes');
  cs.forEach((c, i) => {
    out[codes[i]!] = c;
  });
  return out;
}

export const ROW0 = ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
  'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'] as const;
export const ROW1 = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI',
  'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash'] as const;
export const ROW2 = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK',
  'KeyL', 'Semicolon', 'Quote'] as const;
export const ROW3 = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma',
  'Period', 'Slash'] as const;
