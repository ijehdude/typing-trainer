import { describe, expect, it } from 'vitest';
import { retentionFactor } from '../src/config';
import {
  applyReview, buildQueue, createItem, gradeFromObservations, retrievability,
  SessionLadder, targetIkiFor, type SrsItem,
} from '../src/srs/index';

const DAY_MS = 86_400_000;

function freshItem(overrides: Partial<SrsItem> = {}): SrsItem {
  return {
    pattern: 'io',
    patternType: 'bigram',
    stability: 0.5,
    difficulty: 0,
    lastReview: 0,
    dueAt: 0,
    reps: 0,
    lapses: 0,
    targetIki: 150,
    state: 'learning',
    ...overrides,
  };
}

describe('SRS scheduler — §9.4 worked trajectory (reference fixture)', () => {
  it('matches the PRD trajectory: S₀=0.5, D=0, all good, reviewed on time', () => {
    const expected = [
      { s: 1.10, interval: 4.9 },
      { s: 2.40, interval: 10.8 },
      { s: 5.25, interval: 23.7 },
      { s: 11.5, interval: 51.8 },
      { s: 25.2, interval: 113 },
      { s: 55.2, interval: 180 }, // capped
    ];
    let item = freshItem();
    let now = 0.5 * retentionFactor() * DAY_MS; // first due time
    for (const { s, interval } of expected) {
      item = applyReview(item, 'good', now);
      expect(Math.abs(item.stability - s) / s).toBeLessThan(0.02);
      const gotInterval = (item.dueAt - now) / DAY_MS;
      expect(Math.abs(gotInterval - interval) / interval).toBeLessThan(0.02);
      now = item.dueAt;
    }
    expect(item.state).toBe('mastered'); // six clean reviews → effectively permanent
  });

  it('retrievability at the scheduled due time equals the 0.85 target', () => {
    const s = 5;
    const dueDelta = s * retentionFactor();
    expect(retrievability(dueDelta, s)).toBeCloseTo(0.85, 3);
  });

  it('caps the post-lapse interval hard: a failed S=40d pattern is not stable', () => {
    const item = freshItem({ stability: 40, state: 'review', lastReview: 0, difficulty: 0 });
    const updated = applyReview(item, 'again', 40 * DAY_MS);
    expect(updated.stability).toBeLessThanOrEqual(3.0); // §9.4 ceiling, not 40·0.2=8
    expect(updated.state).toBe('relearning');
    expect(updated.lapses).toBe(1);
    expect((updated.dueAt - 40 * DAY_MS) / DAY_MS).toBeLessThanOrEqual(3.0 * retentionFactor());
  });

  it('difficulty scales the interval down', () => {
    const easyItem = applyReview(freshItem({ difficulty: 0 }), 'good', DAY_MS);
    const hardItem = applyReview(freshItem({ difficulty: 0.8 }), 'good', DAY_MS);
    expect(hardItem.dueAt - DAY_MS).toBeLessThan(easyItem.dueAt - DAY_MS);
  });
});

describe('measured grading (PRD §9.3)', () => {
  it('grades by observed/target IKI ratio', () => {
    expect(gradeFromObservations([150, 150, 150, 150], 0, 150)).toBe('easy');
    expect(gradeFromObservations([170, 175, 180, 172], 0, 150)).toBe('good'); // ratio ~1.16
    expect(gradeFromObservations([210, 215, 220, 218], 0, 150)).toBe('hard'); // ratio ~1.44
    expect(gradeFromObservations([260, 270, 250, 255], 0, 150)).toBe('again'); // ratio > 1.6
  });

  it('any error forces again', () => {
    expect(gradeFromObservations([140, 150, 145], 1, 150)).toBe('again');
  });

  it('never grades below 4 observations — noise cannot trigger state changes', () => {
    expect(gradeFromObservations([500, 500, 500], 0, 150)).toBeNull();
    expect(gradeFromObservations([], 2, 150)).toBeNull();
  });

  it('target IKI rises from the user’s own speed with class allowances', () => {
    expect(targetIkiFor(150, 'default')).toBe(150);
    expect(targetIkiFor(150, 'sfb')).toBeCloseTo(202.5, 5); // SFBs get more allowance
  });
});

describe('intra-session ladder (PRD §9.5)', () => {
  it('failed patterns re-surface at +2, +6, +15 min and clear on 3 successes', () => {
    const ladder = new SessionLadder();
    ladder.fail('io', 0);
    expect(ladder.due(60_000)).toEqual([]);          // not yet
    expect(ladder.due(2 * 60_000)).toEqual(['io']);  // +2 min
    ladder.succeed('io', 2 * 60_000);
    expect(ladder.due(8 * 60_000)).toEqual(['io']);  // +6 min
    ladder.succeed('io', 8 * 60_000);
    expect(ladder.due(23 * 60_000)).toEqual(['io']); // +15 min
    ladder.succeed('io', 23 * 60_000);
    expect(ladder.all()).toEqual([]);                // cleared
  });

  it('failure resets to the bottom rung', () => {
    const ladder = new SessionLadder();
    ladder.fail('rt', 0);
    ladder.succeed('rt', 2 * 60_000);
    ladder.fail('rt', 8 * 60_000); // failed the +6 rung
    expect(ladder.all()[0]!.rung).toBe(0);
    expect(ladder.due(10 * 60_000)).toEqual(['rt']); // back at +2
  });
});

describe('queue construction (PRD §9.6)', () => {
  it('builds a 50/30/20 mix with the new-pattern cap', () => {
    const now = 100 * DAY_MS;
    const items: SrsItem[] = [];
    for (let i = 0; i < 10; i++) {
      items.push(freshItem({
        pattern: `d${i}`, state: 'review',
        dueAt: now - (i + 1) * DAY_MS, stability: 2 + i,
      }));
    }
    for (let i = 0; i < 5; i++) {
      items.push(freshItem({ pattern: `m${i}`, state: 'mastered', dueAt: now + i * DAY_MS, stability: 60 }));
    }
    const costs = new Map<string, number>([['d3', 5], ['d1', 2]]);
    const queue = buildQueue({
      items, costs,
      newCandidates: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'],
      now, budget: 10,
    });
    const bySource = { due: 0, new: 0, mastered: 0 };
    for (const q of queue) bySource[q.source]++;
    expect(bySource.due).toBe(5);
    expect(bySource.new).toBe(3);
    expect(bySource.mastered).toBe(2);
    // Highest cost × overdueness first.
    expect(queue[0]!.pattern).toBe('d3');
  });

  it('caps new patterns at 4 per session regardless of budget', () => {
    const queue = buildQueue({
      items: [], costs: new Map(),
      newCandidates: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      now: 0, budget: 30,
    });
    expect(queue.filter((q) => q.source === 'new')).toHaveLength(4);
  });
});
