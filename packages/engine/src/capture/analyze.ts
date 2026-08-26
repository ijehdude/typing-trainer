import type { Layout } from '@typing-trainer/content';
import { CONFIG, type EngineConfig } from '../config';
import type { AnalyzedKeystroke, Keystroke } from '../types';
import { classifyError } from './errors';

export interface TimingSegment {
  startT: number;
  endT: number;
  startIdx: number; // index into the keystroke array
  endIdx: number;   // inclusive
}

export interface AnalyzedBlock {
  keystrokes: AnalyzedKeystroke[];
  /** Contiguous typing segments split at pauses > ikiMaxMs (PRD §6.2 rule 4). */
  segments: TimingSegment[];
  /** Elapsed typing time excluding pauses, ms. */
  activeMs: number;
  /** Clock anomalies detected (PRD §21.2): flag, don't discard. */
  timingSuspect: boolean;
}

/**
 * Enrich a raw keystroke stream with layout-derived hand/finger/row/col,
 * IKIs with the §6.2 exclusion rules applied, pause segmentation, and
 * error classification. Pure; the single entry point from raw capture to
 * everything downstream.
 */
export function analyzeBlock(
  raw: readonly Keystroke[],
  layout: Layout,
  targetText: string,
  cfg: EngineConfig = CONFIG,
): AnalyzedBlock {
  const { ikiMinMs, ikiMaxMs } = cfg.timing;
  const keystrokes: AnalyzedKeystroke[] = [];
  let timingSuspect = false;

  let prevT: number | null = null;
  let prevCorrect: { t: number; index: number } | null = null;
  let cleanChain = false; // true when no error/correction since the last correct keystroke

  for (let i = 0; i < raw.length; i++) {
    const ks = raw[i]!;
    const keyDef = layout.charIndex[ks.expected]
      ? layout.keys[layout.charIndex[ks.expected]!.code]
      : undefined;

    if (prevT !== null && ks.t < prevT) timingSuspect = true;

    let iki: number | null = null;
    let excluded = false;

    if (ks.correct && !ks.isCorrection) {
      if (prevCorrect !== null && cleanChain) {
        iki = ks.t - prevCorrect.t;
        if (ks.repeat || iki < ikiMinMs || iki > ikiMaxMs) excluded = true;
        if (iki < 0) {
          timingSuspect = true;
          excluded = true;
        }
      } else {
        excluded = true; // no clean predecessor: first key, or follows an error/correction
      }
    } else {
      excluded = true;
    }
    if (ks.repeat) excluded = true;

    keystrokes.push({
      ...ks,
      hand: keyDef?.hand ?? null,
      finger: keyDef?.finger ?? null,
      row: keyDef?.row ?? null,
      col: keyDef?.col ?? null,
      iki,
      excludedFromTiming: excluded,
      errorType:
        !ks.correct && !ks.isCorrection
          ? classifyError(ks, raw[i + 1], layout, targetText)
          : null,
    });

    if (ks.correct && !ks.isCorrection && !ks.repeat) {
      prevCorrect = { t: ks.t, index: ks.index };
      cleanChain = true;
    } else {
      cleanChain = false;
    }
    prevT = ks.t;
  }

  // Pause segmentation over all keystrokes (any gap > ikiMaxMs splits).
  const segments: TimingSegment[] = [];
  let segStart = 0;
  for (let i = 1; i <= raw.length; i++) {
    const gap = i < raw.length ? raw[i]!.t - raw[i - 1]!.t : Infinity;
    if (gap > ikiMaxMs || i === raw.length) {
      if (i - 1 >= segStart) {
        segments.push({
          startT: raw[segStart]!.t,
          endT: raw[i - 1]!.t,
          startIdx: segStart,
          endIdx: i - 1,
        });
      }
      segStart = i;
    }
  }

  const activeMs = segments.reduce((sum, s) => sum + (s.endT - s.startT), 0);

  return { keystrokes, segments, activeMs, timingSuspect };
}
