import type { Hand, Finger, Row } from './geometry';

/** PRD §6.5: a layout maps KeyboardEvent.code → key definition. */
export interface KeyDef {
  code: string;
  char: string;
  shiftChar: string;
  hand: Hand;
  finger: Finger;
  row: Row;
  col: number;
  homeDistance: number;
}

export interface Layout {
  id: string;
  name: string;
  keys: Readonly<Record<string, KeyDef>>;
  /** char (base or shifted) → { code, shifted } for generator/analysis lookups. */
  charIndex: Readonly<Record<string, { code: string; shifted: boolean }>>;
}
