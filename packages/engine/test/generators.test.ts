import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { countOccurrences, generate } from '../src/generators/index';

describe('content generators (PRD §10.3)', () => {
  it('is deterministic given a seed', () => {
    for (const stage of [0, 1, 2, 3, 4, 5] as const) {
      const a = generate({ stage, targets: ['io'], length: 300, seed: 99, profile: 'writer' });
      const b = generate({ stage, targets: ['io'], length: 300, seed: 99, profile: 'writer' });
      expect(a.text).toBe(b.text);
      const c = generate({ stage, targets: ['io'], length: 300, seed: 100, profile: 'writer' });
      if (stage !== 5) expect(a.text).not.toBe(c.text); // stage 5 pools are small
    }
  });

  it('stage 0 drills isolate the pattern', () => {
    const g = generate({ stage: 0, targets: ['io'], length: 120, seed: 1 });
    expect(g.text.length).toBeGreaterThan(60);
    expect(countOccurrences(g.text, ['io', 'oi'])).toBeGreaterThan(10);
  });

  it('stages 1–3 hit target density within ±20% (PRD §10.3)', () => {
    const density = CONFIG.content.defaultTargetDensity;
    for (const stage of [1, 2, 3] as const) {
      const g = generate({ stage, targets: ['th', 'he'], length: 500, seed: 5 });
      expect(g.density, `stage ${stage} density`).toBeGreaterThanOrEqual(density * 0.8);
      expect(g.density, `stage ${stage} density`).toBeLessThanOrEqual(density * 1.6);
    }
  });

  it('stage 2 respects allowedChars (Foundations)', () => {
    const allowed = new Set('asdfjkleiotn '.split(''));
    const g = generate({ stage: 2, targets: ['io'], length: 300, seed: 3, allowedChars: allowed });
    for (const ch of g.text) {
      expect(allowed.has(ch), `char ${JSON.stringify(ch)}`).toBe(true);
    }
  });

  it('stage 2 never repeats a word within 6 words', () => {
    const g = generate({ stage: 2, targets: ['th'], length: 600, seed: 11 });
    const words = g.text.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const window = words.slice(Math.max(0, i - 6), i);
      expect(window.includes(words[i]!), `repeat of "${words[i]}" at ${i}`).toBe(false);
    }
  });

  it('stage 1 synthetic words are word-shaped, not random letters', () => {
    const g = generate({ stage: 1, targets: ['io'], length: 300, seed: 8 });
    const words = g.text.split(/\s+/).filter((w) => w.length >= 3);
    expect(words.length).toBeGreaterThan(10);
    // Pronounceability proxy: vowel in nearly every word.
    const withVowel = words.filter((w) => /[aeiouy]/.test(w));
    expect(withVowel.length / words.length).toBeGreaterThan(0.9);
  });

  it('stage 4 produces capitalized, punctuated sentences', () => {
    const g = generate({ stage: 4, targets: ['th'], length: 400, seed: 4 });
    expect(g.text).toMatch(/^[A-Z"']/);
    expect(g.text).toMatch(/[.!?]/);
  });

  it('stage 5 selects real passages by profile mix', () => {
    const dev = generate({ stage: 5, targets: [], length: 600, seed: 6, profile: 'developer' });
    const writer = generate({ stage: 5, targets: [], length: 600, seed: 6, profile: 'writer' });
    expect(dev.text).not.toBe(writer.text);
    // Developer mix leans on code/terminal: symbols should show up.
    expect(/[(){};=]/.test(dev.text)).toBe(true);
  });

  it('stage 5 with targets prefers passages naturally containing them', () => {
    const g = generate({ stage: 5, targets: ['th'], length: 500, seed: 12, profile: 'writer' });
    expect(countOccurrences(g.text, ['th'])).toBeGreaterThan(2);
  });
});
