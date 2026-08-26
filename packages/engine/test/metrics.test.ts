import { describe, expect, it } from 'vitest';
import { qwertyUs } from '@typing-trainer/content';
import { analyzeBlock } from '../src/capture/analyze';
import {
  backspaceRate, consistencyScore, firstAttemptAccuracy, geometricMean, mad,
  meanIkiMsFromWpm, median, netWpm, perSecondWpm, rawWpm, rhythmScore,
  wpmFromMeanIkiMs,
} from '../src/metrics/index';
import type { Keystroke } from '../src/types';

function stroke(t: number, key: string, expected: string, index: number, isCorrection = false): Keystroke {
  return {
    t, tUp: t + 70, code: 'KeyA', key, expected, index,
    correct: key === expected && !isCorrection, isCorrection, repeat: false, modifiers: 0,
  };
}

describe('WPM golden fixtures (PRD Appendix A)', () => {
  it('net WPM: 10 correct chars over 2250 active ms → 53.33', () => {
    expect(netWpm(10, 2250)).toBeCloseTo(53.333, 2);
  });

  it('raw vs net: errors count in raw only', () => {
    expect(rawWpm(12, 3000)).toBeCloseTo(48, 5);
    expect(netWpm(10, 3000)).toBeCloseTo(40, 5);
  });

  it('WPM ↔ IKI bridge sanity anchors (PRD §7.3)', () => {
    expect(wpmFromMeanIkiMs(150)).toBeCloseTo(80, 5);
    expect(wpmFromMeanIkiMs(120)).toBeCloseTo(100, 5);
    expect(wpmFromMeanIkiMs(100)).toBeCloseTo(120, 5);
    expect(meanIkiMsFromWpm(80)).toBeCloseTo(150, 5);
  });
});

describe('first-attempt accuracy (PRD §6.4)', () => {
  it('counts errors at first attempt regardless of later correction', () => {
    const raw = [
      stroke(1000, 'c', 'c', 0),
      stroke(1200, 'x', 'a', 1),                 // first attempt wrong
      stroke(1400, 'Backspace', 'a', 1, true),
      stroke(1600, 'a', 'a', 1),                 // corrected — still an error
      stroke(1800, 't', 't', 2),
    ];
    const block = analyzeBlock(raw, qwertyUs, 'cat');
    expect(firstAttemptAccuracy(block.keystrokes)).toBeCloseTo(2 / 3, 10);
  });
});

describe('consistency (PRD §8.2 dim 3)', () => {
  it('constant speed scores 100', () => {
    expect(consistencyScore([60, 60, 60, 60])).toBe(100);
  });

  it('CV of 0.5 scores 50', () => {
    expect(consistencyScore([30, 90])).toBeCloseTo(50, 5);
  });

  it('per-second buckets computed within active segments', () => {
    // 12 correct chars, one every 250 ms → 4 chars/sec for 3 s → 48 WPM each bucket.
    const raw = Array.from({ length: 13 }, (_, i) => stroke(1000 + i * 250, 'a', 'a', i));
    const block = analyzeBlock(raw, qwertyUs, 'a'.repeat(13));
    const series = perSecondWpm(block);
    expect(series).toHaveLength(3);
    for (const wpm of series) expect(wpm).toBeCloseTo(48, 5);
    expect(consistencyScore(series)).toBe(100);
  });
});

describe('rhythm score anchors (PRD §8.2 dim 4)', () => {
  it('matches PRD anchor table', () => {
    expect(rhythmScore(0.10)).toBeCloseTo(88.9, 0);
    expect(rhythmScore(0.14)).toBeCloseTo(84.4, 0);
    expect(rhythmScore(0.20)).toBeCloseTo(77.8, 0);
    expect(rhythmScore(0.35)).toBeCloseTo(61.1, 0);
    expect(rhythmScore(0.60)).toBeCloseTo(33.3, 0);
  });
});

describe('backspace rate', () => {
  it('corrections per 100 typed chars', () => {
    const raw = [
      stroke(1000, 'a', 'a', 0),
      stroke(1200, 'x', 'b', 1),
      stroke(1400, 'Backspace', 'b', 1, true),
      stroke(1600, 'b', 'b', 1),
      stroke(1800, 'c', 'c', 2),
    ];
    const block = analyzeBlock(raw, qwertyUs, 'abc');
    expect(backspaceRate(block.keystrokes)).toBeCloseTo(25, 5); // 1 correction / 4 chars
  });
});

describe('math helpers', () => {
  it('median and MAD', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
  });

  it('geometric mean', () => {
    expect(geometricMean([100, 400])).toBeCloseTo(200, 5);
  });
});
