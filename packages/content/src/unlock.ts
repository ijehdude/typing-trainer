import { lexicon, zipfWeight } from './lexicon';
import type { Layout } from './layouts/types';

/**
 * Foundations unlock order (PRD §11.2): starts from the layout's home row
 * and greedily adds the letter that maximizes the Zipf-weighted number of
 * real words that become typeable. Deterministic per layout; cached.
 */

const cache = new Map<string, string[]>();

export function unlockOrder(layout: Layout): readonly string[] {
  const hit = cache.get(layout.id);
  if (hit) return hit;

  const homeRow = Object.values(layout.keys)
    .filter((k) => k.row === 2 && /^[a-z]$/.test(k.char))
    .map((k) => k.char);
  const allLetters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const words = lexicon();

  const unlocked = new Set<string>(homeRow);
  const order: string[] = [...homeRow];
  const remaining = allLetters.filter((c) => !unlocked.has(c));

  const weightIfAdded = (candidate: string): number => {
    let w = 0;
    for (let r = 0; r < words.length; r++) {
      const word = words[r]!;
      let ok = true;
      for (const ch of word) {
        if (ch !== candidate && !unlocked.has(ch)) {
          ok = false;
          break;
        }
      }
      if (ok && word.includes(candidate)) w += zipfWeight(r);
    }
    return w;
  };

  while (remaining.length > 0) {
    let best = remaining[0]!;
    let bestW = -1;
    for (const c of remaining) {
      const w = weightIfAdded(c);
      // Deterministic tie-break: alphabetical.
      if (w > bestW || (w === bestW && c < best)) {
        best = c;
        bestW = w;
      }
    }
    unlocked.add(best);
    order.push(best);
    remaining.splice(remaining.indexOf(best), 1);
  }

  cache.set(layout.id, order);
  return order;
}

/** Words fully typeable with the given unlocked characters. */
export function typeableWords(unlockedChars: ReadonlySet<string>): string[] {
  return lexicon().filter((w) => [...w].every((c) => unlockedChars.has(c)));
}
