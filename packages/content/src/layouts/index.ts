import { buildLayout, rowChars, ROW0, ROW1, ROW2, ROW3 } from './build';
import type { Layout } from './types';

export type { Layout, KeyDef } from './types';
export { KEY_GEOMETRY, keysAdjacent, mirrorCode } from './geometry';
export type { Hand, Finger, Row, KeyGeometry } from './geometry';

const SPACE = { Space: ' ' };

export const qwertyUs: Layout = buildLayout({
  id: 'qwerty-us',
  name: 'QWERTY (US)',
  chars: {
    ...rowChars(ROW0, '`1234567890-='),
    ...rowChars(ROW1, 'qwertyuiop[]\\'),
    ...rowChars(ROW2, "asdfghjkl;'"),
    ...rowChars(ROW3, 'zxcvbnm,./'),
    ...SPACE,
  },
});

export const qwertyUk: Layout = buildLayout({
  id: 'qwerty-uk',
  name: 'QWERTY (UK)',
  chars: {
    ...rowChars(ROW0, '`1234567890-='),
    ...rowChars(ROW1, 'qwertyuiop[]'),
    Backslash: '#',
    IntlBackslash: '\\',
    ...rowChars(ROW2, "asdfghjkl;'"),
    ...rowChars(ROW3, 'zxcvbnm,./'),
    ...SPACE,
  },
  shiftOverrides: {
    Backquote: '¬', Digit2: '"', Digit3: '£',
    Quote: '@', Backslash: '~', IntlBackslash: '|',
  },
});

export const dvorak: Layout = buildLayout({
  id: 'dvorak',
  name: 'Dvorak',
  chars: {
    ...rowChars(ROW0, '`1234567890[]'),
    ...rowChars(ROW1, "',.pyfgcrl/=\\"),
    ...rowChars(ROW2, 'aoeuidhtns-'),
    ...rowChars(ROW3, ';qjkxbmwvz'),
    ...SPACE,
  },
});

export const colemak: Layout = buildLayout({
  id: 'colemak',
  name: 'Colemak',
  chars: {
    ...rowChars(ROW0, '`1234567890-='),
    ...rowChars(ROW1, 'qwfpgjluy;[]\\'),
    ...rowChars(ROW2, "arstdhneio'"),
    ...rowChars(ROW3, 'zxcvbkm,./'),
    ...SPACE,
  },
});

export const colemakDh: Layout = buildLayout({
  id: 'colemak-dh',
  name: 'Colemak-DH',
  chars: {
    ...rowChars(ROW0, '`1234567890-='),
    ...rowChars(ROW1, 'qwfpbjluy;[]\\'),
    ...rowChars(ROW2, "arstgmneio'"),
    ...rowChars(ROW3, 'zxcdvkh,./'),
    ...SPACE,
  },
});

export const LAYOUTS: Readonly<Record<string, Layout>> = Object.freeze({
  'qwerty-us': qwertyUs,
  'qwerty-uk': qwertyUk,
  dvorak,
  colemak,
  'colemak-dh': colemakDh,
});

export function getLayout(id: string): Layout {
  const layout = LAYOUTS[id];
  if (!layout) throw new Error(`Unknown layout: ${id}`);
  return layout;
}
