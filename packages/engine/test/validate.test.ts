import { describe, expect, it } from 'vitest';
import { validateNarration } from '../src/coach/validate';

const SNAPSHOT = {
  sessionMetrics: { wpmNet: 72.4, accuracy: 0.968, backspaceRate: 4.2 },
  findings: [{ label: 'Right pinky', estWpmCost: 4.1 }],
  speedTestWpm: 74.8,
};

describe('LLM narration validator (PRD §19.6)', () => {
  it('accepts output whose numbers all come from the input', () => {
    const text =
      'You finished at 72.4 WPM with 96.8% accuracy. Your right pinky is costing about 4.1 WPM; the next session starts there.';
    expect(validateNarration(text, SNAPSHOT).ok).toBe(true);
  });

  it('accepts rounded display variants of input values', () => {
    const text = 'You finished at 72 WPM and held 97% accuracy on the speed test at 75 WPM.';
    expect(validateNarration(text, SNAPSHOT).ok).toBe(true);
  });

  it('rejects any fabricated number', () => {
    const result = validateNarration(
      'You gained 15 WPM this week and should reach 120 WPM by Friday.',
      SNAPSHOT,
    );
    expect(result.ok).toBe(false);
    expect(result.offending).toContain('15');
    expect(result.offending).toContain('120');
  });

  it('allows small rhetorical counts (two sessions, one thing)', () => {
    const text = 'One session is noise, not a trend — 2 more will confirm the 72.4 WPM baseline.';
    expect(validateNarration(text, SNAPSHOT).ok).toBe(true);
  });

  it('accepts accuracy complements ("dropped 3.2pp" style)', () => {
    // 1 − 0.968 = 3.2%
    const text = 'Your error rate is 3.2% at speed; hold 72 WPM until it settles.';
    expect(validateNarration(text, SNAPSHOT).ok).toBe(true);
  });
});
