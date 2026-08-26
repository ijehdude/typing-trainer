import { describe, expect, it } from 'vitest';
import { fitTradeoff, type TradeoffPoint } from '../src/model/tradeoff';
import { createRng } from '../src/rand';

describe('speed–accuracy tradeoff curve (PRD §7.5)', () => {
  it('recovers V_control and V_collapse from synthetic logistic data', () => {
    // Ground truth: 3% error at 80 WPM (V_control), 7% at ~94.8 (V_collapse).
    const beta = 0.06;
    const alpha = Math.log(0.03 / 0.97) - beta * 80;
    const rng = createRng(1234);
    const points: TradeoffPoint[] = [];
    for (let i = 0; i < 4000; i++) {
      const wpm = 50 + rng.next() * 60;
      const p = 1 / (1 + Math.exp(-(alpha + beta * wpm)));
      points.push({ localWpm: wpm, isError: rng.next() < p });
    }
    const curve = fitTradeoff(points, 85);
    expect(curve.beta).toBeGreaterThan(0);
    expect(curve.vControl).toBeGreaterThan(72);
    expect(curve.vControl).toBeLessThan(88);
    expect(curve.vCollapse).toBeGreaterThan(curve.vControl);
    expect(curve.vCollapse).toBeGreaterThan(87);
    expect(curve.vCollapse).toBeLessThan(103);
    expect(curve.headroom).toBeCloseTo(curve.vCollapse - 85, 5);
  });

  it('returns an empty curve when there is not enough signal', () => {
    const points: TradeoffPoint[] = Array.from({ length: 50 }, (_, i) => ({
      localWpm: 60 + i,
      isError: false,
    }));
    const curve = fitTradeoff(points, 60);
    expect(curve.vControl).toBe(0);
    expect(curve.r2).toBe(0);
  });

  it('rejects fits where errors do not rise with speed (β ≤ 0)', () => {
    const rng = createRng(7);
    const points: TradeoffPoint[] = [];
    for (let i = 0; i < 2000; i++) {
      const wpm = 50 + rng.next() * 60;
      // Errors concentrated at LOW speed — a degenerate shape.
      points.push({ localWpm: wpm, isError: rng.next() < (wpm < 70 ? 0.1 : 0.01) });
    }
    const curve = fitTradeoff(points, 80);
    expect(curve.vControl).toBe(0);
    expect(curve.vCollapse).toBe(0);
  });
});
