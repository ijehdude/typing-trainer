/**
 * Physical key geometry (ANSI + the ISO IntlBackslash key), independent of
 * layout: which hand/finger owns each physical position, its row/column, and
 * its distance from that finger's home position. Character assignment comes
 * from the individual layout files.
 */

export type Hand = 'L' | 'R';
export type Finger =
  | 'LP' | 'LR' | 'LM' | 'LI' | 'LT'
  | 'RT' | 'RI' | 'RM' | 'RR' | 'RP';
export type Row = 0 | 1 | 2 | 3 | 4;

export interface KeyGeometry {
  hand: Hand;
  finger: Finger;
  row: Row;
  col: number;
  /** Distance in key units from the finger's home key (0 for home keys). */
  homeDistance: number;
}

/** Horizontal stagger offset (key units) per row, ANSI. */
const ROW_X_OFFSET: Record<Row, number> = { 0: 0, 1: 0.5, 2: 0.75, 3: 1.25, 4: 0 };

/** Standard finger assignment by physical column, per row. */
const FINGER_BY_ROW_COL: Record<Exclude<Row, 4>, readonly Finger[]> = {
  // ` 1 2 3 4 5 6 7 8 9 0 - =
  0: ['LP', 'LP', 'LR', 'LM', 'LI', 'LI', 'RI', 'RI', 'RM', 'RR', 'RP', 'RP', 'RP'],
  // q w e r t y u i o p [ ] \
  1: ['LP', 'LR', 'LM', 'LI', 'LI', 'RI', 'RI', 'RM', 'RR', 'RP', 'RP', 'RP', 'RP'],
  // a s d f g h j k l ; '
  2: ['LP', 'LR', 'LM', 'LI', 'LI', 'RI', 'RI', 'RM', 'RR', 'RP', 'RP'],
  // z x c v b n m , . /
  3: ['LP', 'LR', 'LM', 'LI', 'LI', 'RI', 'RI', 'RM', 'RR', 'RP'],
};

/** Home key position (row, col) per finger. */
const HOME_POSITION: Partial<Record<Finger, readonly [Row, number]>> = {
  LP: [2, 0], LR: [2, 1], LM: [2, 2], LI: [2, 3],
  RI: [2, 6], RM: [2, 7], RR: [2, 8], RP: [2, 9],
};

const ROW_CODES: Record<Exclude<Row, 4>, readonly string[]> = {
  0: ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6',
      'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'],
  1: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO',
      'KeyP', 'BracketLeft', 'BracketRight', 'Backslash'],
  2: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL',
      'Semicolon', 'Quote'],
  3: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma',
      'Period', 'Slash'],
};

function keyX(row: Row, col: number): number {
  return col + ROW_X_OFFSET[row];
}

function buildGeometry(): Record<string, KeyGeometry> {
  const geo: Record<string, KeyGeometry> = {};
  for (const rowKey of [0, 1, 2, 3] as const) {
    const codes = ROW_CODES[rowKey];
    const fingers = FINGER_BY_ROW_COL[rowKey];
    codes.forEach((code, col) => {
      const finger = fingers[col] ?? (rowKey <= 1 ? 'RP' : 'RP');
      const home = HOME_POSITION[finger];
      const homeDistance = home
        ? Math.hypot(keyX(rowKey, col) - keyX(home[0], home[1]), rowKey - home[0])
        : 0;
      geo[code] = {
        hand: finger.startsWith('L') ? 'L' : 'R',
        finger,
        row: rowKey,
        col,
        homeDistance: Math.round(homeDistance * 100) / 100,
      };
    });
  }
  // ISO extra key (between ShiftLeft and Z), used by UK layout.
  geo['IntlBackslash'] = { hand: 'L', finger: 'LP', row: 3, col: -1, homeDistance: 1.6 };
  geo['Space'] = { hand: 'R', finger: 'RT', row: 4, col: 5, homeDistance: 0 };
  return geo;
}

export const KEY_GEOMETRY: Record<string, KeyGeometry> = buildGeometry();

/** Physical adjacency: keys within ~1.3 key units of each other. */
export function keysAdjacent(codeA: string, codeB: string): boolean {
  const a = KEY_GEOMETRY[codeA];
  const b = KEY_GEOMETRY[codeB];
  if (!a || !b || a.row === 4 || b.row === 4) return false;
  const dist = Math.hypot(keyX(a.row, a.col) - keyX(b.row, b.col), a.row - b.row);
  return dist > 0 && dist <= 1.3;
}

/**
 * Mirror key on the other hand (same row, mirrored column), used for the
 * 'mirror' error class (PRD §6.3). Mirroring is around the physical center
 * of the alpha block for the key's row.
 */
export function mirrorCode(code: string): string | null {
  const g = KEY_GEOMETRY[code];
  if (!g || g.row === 4 || g.col < 0) return null;
  const codes = ROW_CODES[g.row as Exclude<Row, 4>];
  // Mirror within the 10-column alpha core where possible.
  const core = g.row === 0 ? codes.slice(1, 11) : codes.slice(0, 10);
  const idx = core.indexOf(code);
  if (idx < 0) return null;
  return core[core.length - 1 - idx] ?? null;
}
