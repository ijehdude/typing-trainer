import { describe, expect, it } from 'vitest';
import { stageFloorForWpm } from '../src/curriculum/index';
import { generate } from '../src/generators/index';
import { planSession } from '../src/planner/index';
import { lexicon } from '@typing-trainer/content';

describe('ladder entry point (PRD §10.1, §11.2)', () => {
  it('places typists on the ladder by measured speed', () => {
    expect(stageFloorForWpm(15, false)).toBe(0);  // true beginner: isolate the motor pattern
    expect(stageFloorForWpm(24, false)).toBe(1);  // word-shaped, no lexical help yet
    expect(stageFloorForWpm(38, false)).toBe(2);  // real words — the dignified path (§3.2)
    expect(stageFloorForWpm(85, false)).toBe(3);  // phrases
  });

  it('keeps Foundations users low regardless of speed', () => {
    expect(stageFloorForWpm(90, true)).toBe(1);
  });

  it('assumes a competent adult when nothing has been measured', () => {
    expect(stageFloorForWpm(null, false)).toBe(2);
  });
});

describe('targeted blocks use real words for competent typists', () => {
  const words = new Set(lexicon());

  function targetBlockTexts(stageFloor: 0 | 1 | 2 | 3) {
    const plan = planSession({
      minutes: 15, snapshot: null, profile: 'writer', seed: 4242, stageFloor,
    });
    return plan.blocks
      .filter((b) => b.kind === 'target')
      .map((b) => ({
        block: b,
        text: generate({
          stage: b.stage, targets: b.targets, length: 200,
          profile: b.profile, seed: b.seed, difficulty: 0.5,
        }).text,
      }));
  }

  it('a 70+ WPM typist drills real English, not pseudo-words', () => {
    const blocks = targetBlockTexts(3);
    expect(blocks.length).toBeGreaterThan(0);
    for (const { block, text } of blocks) {
      expect(block.stage).toBeGreaterThanOrEqual(2);
      const tokens = text.split(/\s+/).filter((w) => w.length > 1);
      const real = tokens.filter((w) => words.has(w.replace(/[^a-z]/g, '')));
      // Overwhelmingly real vocabulary — this is the whole complaint.
      expect(real.length / tokens.length).toBeGreaterThan(0.9);
    }
  });

  it('still targets the pattern it is supposed to fix', () => {
    for (const { block, text } of targetBlockTexts(2)) {
      const hits = block.targets.reduce(
        (n, t) => n + (text.toLowerCase().split(t).length - 1),
        0,
      );
      expect(hits).toBeGreaterThan(3);
    }
  });

  it('a beginner is still given isolating drills', () => {
    const blocks = targetBlockTexts(0);
    expect(blocks.every((b) => b.block.stage === 0)).toBe(true);
  });

  it('a demoted pattern keeps its earned stage — the floor is not a clamp', () => {
    const plan = planSession({
      minutes: 15, snapshot: null, profile: 'writer', seed: 1,
      stageFloor: 3,
      stageByPattern: { th: 1 }, // struggled here, demoted
    });
    const withTh = plan.blocks.find((b) => b.targets.includes('th'));
    expect(withTh!.stage).toBe(1);
  });
});
