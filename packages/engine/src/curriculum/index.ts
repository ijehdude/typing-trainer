import { lexicon, unlockOrder, zipfWeight, type Layout } from '@typing-trainer/content';
import { CONFIG, type EngineConfig } from '../config';
import { geometricMean } from '../metrics/index';
import type { Stage, Track } from '../types';

/**
 * The curriculum (PRD §11): default ordering the Diagnosis Engine may
 * reorder, plus the promotion/demotion gates of §10.2 and Foundations
 * progressive unlocking of §11.2.
 */

export interface CurriculumUnit {
  id: string;
  track: Track;
  label: string;
  /** Target patterns for this unit, resolved against a layout. */
  targets: (layout: Layout) => string[];
}

export interface CurriculumState {
  track: Track;
  unitId: string;
  unlockedChars: string;              // Foundations only; all chars once past it
  stageByPattern: Record<string, Stage>;
  completedUnits: string[];
}

/** Top English bigrams by Zipf-weighted lexicon frequency. */
export function commonBigrams(n: number): string[] {
  const weights = new Map<string, number>();
  lexicon().forEach((w, r) => {
    const zw = zipfWeight(r);
    for (let i = 1; i < w.length; i++) {
      const bg = w[i - 1]! + w[i]!;
      weights.set(bg, (weights.get(bg) ?? 0) + zw);
    }
  });
  return [...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([bg]) => bg);
}

function sfbBigrams(layout: Layout): string[] {
  return commonBigrams(200).filter((bg) => {
    const a = layout.charIndex[bg[0]!];
    const b = layout.charIndex[bg[1]!];
    if (!a || !b) return false;
    const fa = layout.keys[a.code]!.finger;
    const fb = layout.keys[b.code]!.finger;
    return fa === fb && bg[0] !== bg[1];
  }).slice(0, 12);
}

function alternatingBigrams(layout: Layout): string[] {
  return commonBigrams(80).filter((bg) => {
    const a = layout.charIndex[bg[0]!];
    const b = layout.charIndex[bg[1]!];
    if (!a || !b) return false;
    return layout.keys[a.code]!.hand !== layout.keys[b.code]!.hand;
  }).slice(0, 12);
}

function rowJumpBigrams(layout: Layout): string[] {
  return commonBigrams(200).filter((bg) => {
    const a = layout.charIndex[bg[0]!];
    const b = layout.charIndex[bg[1]!];
    if (!a || !b) return false;
    return Math.abs(layout.keys[a.code]!.row - layout.keys[b.code]!.row) >= 2;
  }).slice(0, 12);
}

export const CURRICULUM: readonly CurriculumUnit[] = [
  { id: 'home-row', track: 'foundations', label: 'Home row', targets: (l) => homeRowChars(l) },
  { id: 'top-bottom-rows', track: 'foundations', label: 'Top and bottom rows', targets: (l) => rowChars(l, 1).concat(rowChars(l, 3)) },
  { id: 'no-look', track: 'foundations', label: 'Touch-typing introduction', targets: (l) => homeRowChars(l) },
  { id: 'basic-accuracy', track: 'foundations', label: 'Basic accuracy', targets: () => [] },

  { id: 'weak-keys', track: 'control', label: 'Weak-key remediation', targets: () => [] }, // dynamic: from findings
  { id: 'finger-independence', track: 'control', label: 'Finger independence', targets: (l) => sfbBigrams(l).slice(0, 6) },
  { id: 'hand-alternation', track: 'control', label: 'Hand alternation', targets: (l) => alternatingBigrams(l) },
  { id: 'sfb', track: 'control', label: 'Same-finger bigrams', targets: (l) => sfbBigrams(l) },
  { id: 'row-jumps', track: 'control', label: 'Row jumps', targets: (l) => rowJumpBigrams(l) },

  { id: 'common-bigrams', track: 'speed', label: 'Common bigrams', targets: () => commonBigrams(16) },
  { id: 'word-chunking', track: 'speed', label: 'Word chunking', targets: () => lexicon().slice(0, 20) },
  { id: 'word-boundaries', track: 'speed', label: 'Word-boundary transitions', targets: () => commonBigrams(30).map((bg) => bg[1]!).slice(0, 8).map((c) => ' ' + c) },
  { id: 'rhythm', track: 'speed', label: 'Rhythm', targets: () => [] },
  { id: 'burst', track: 'speed', label: 'Burst speed', targets: () => [] },

  { id: 'sentences', track: 'fluency', label: 'Sentences', targets: () => [] },
  { id: 'punctuation', track: 'fluency', label: 'Punctuation', targets: () => [',', '.', ';', "'", '"', '?', '-', ':'] },
  { id: 'capitals', track: 'fluency', label: 'Capitalization and shift control', targets: () => 'TASWHIMB'.split('') },
  { id: 'numbers-symbols', track: 'fluency', label: 'Numbers and symbols', targets: () => '0123456789$%()'.split('') },
  { id: 'real-world', track: 'fluency', label: 'Real-world text', targets: () => [] },

  { id: 'sustain-80', track: 'mastery', label: '80 WPM sustained', targets: () => [] },
  { id: 'sustain-100', track: 'mastery', label: '100 WPM sustained', targets: () => [] },
  { id: 'sustain-120', track: 'mastery', label: '120 WPM sustained', targets: () => [] },
  { id: 'sustain-140', track: 'mastery', label: '140 WPM sustained', targets: () => [] },
];

function homeRowChars(layout: Layout): string[] {
  return Object.values(layout.keys)
    .filter((k) => k.row === 2 && /^[a-z]$/.test(k.char))
    .map((k) => k.char);
}

function rowChars(layout: Layout, row: number): string[] {
  return Object.values(layout.keys)
    .filter((k) => k.row === row && /^[a-z]$/.test(k.char))
    .map((k) => k.char);
}

export function initialCurriculumState(layout: Layout, skipFoundations: boolean): CurriculumState {
  if (skipFoundations) {
    return {
      track: 'control',
      unitId: 'weak-keys',
      unlockedChars: 'abcdefghijklmnopqrstuvwxyz ,.',
      stageByPattern: {},
      completedUnits: CURRICULUM.filter((u) => u.track === 'foundations').map((u) => u.id),
    };
  }
  const order = unlockOrder(layout);
  return {
    track: 'foundations',
    unitId: 'home-row',
    unlockedChars: order.slice(0, homeRowChars(layout).length).join('') + ' ',
    stageByPattern: {},
    completedUnits: [],
  };
}

// --- Promotion / demotion gates (PRD §10.2) -------------------------------

export interface PatternProgress {
  /** Last `promoteObsWindow` first-attempt outcomes for the pattern. */
  recentCorrect: number;
  recentTotal: number;
  gmIki: number;         // over the recent window
  globalGmIki: number;   // the user's overall gm IKI
  sessionsSeen: number;
  /** Residual dispersion decile for the pattern, 0 (best) – 9 (worst). */
  residualDecile: number;
}

export type GateDecision = 'promote' | 'stay' | 'demote';

/** The single most important rule in the content engine. */
export function gateDecision(p: PatternProgress, cfg: EngineConfig = CONFIG): GateDecision {
  const c = cfg.content;
  if (p.recentTotal >= c.demoteObsWindow && p.recentCorrect / p.recentTotal < c.demoteAccuracy) {
    return 'demote';
  }
  if (
    p.recentTotal >= c.promoteObsWindow &&
    p.recentCorrect / p.recentTotal >= c.promoteAccuracy &&
    p.globalGmIki > 0 &&
    p.gmIki <= c.promoteIkiRatio * p.globalGmIki &&
    p.sessionsSeen >= c.promoteMinSessions &&
    p.residualDecile < 9
  ) {
    return 'promote';
  }
  return 'stay';
}

export function applyGate(state: CurriculumState, pattern: string, decision: GateDecision): CurriculumState {
  const current = state.stageByPattern[pattern] ?? 0;
  const next: Stage =
    decision === 'promote'
      ? ((Math.min(5, current + 1)) as Stage)
      : decision === 'demote'
        ? ((Math.max(0, current - 1)) as Stage)
        : (current as Stage);
  if (next === current) return state;
  return { ...state, stageByPattern: { ...state.stageByPattern, [pattern]: next } };
}

// --- Foundations unlocking (PRD §11.2) ------------------------------------

export interface CharStats {
  char: string;
  accuracy: number;   // first-attempt
  gmIki: number;
  n: number;
}

export function canUnlockNext(
  stats: readonly CharStats[],
  unlockedChars: string,
  homeRowBaselineIki: number,
  cfg: EngineConfig = CONFIG,
): boolean {
  const c = cfg.curriculum;
  const letters = [...unlockedChars].filter((ch) => /[a-z]/.test(ch));
  return letters.every((ch) => {
    const s = stats.find((x) => x.char === ch);
    if (!s) return false;
    return (
      s.n >= c.unlockMinObs &&
      s.accuracy >= c.unlockAccuracy &&
      s.gmIki <= c.unlockIkiRatio * homeRowBaselineIki
    );
  });
}

export function nextUnlockChar(layout: Layout, unlockedChars: string): string | null {
  const order = unlockOrder(layout);
  for (const ch of order) {
    if (!unlockedChars.includes(ch)) return ch;
  }
  return null;
}

/** Home-row baseline: gm IKI over the layout's home-row letters. */
export function homeRowBaseline(stats: readonly CharStats[], layout: Layout): number {
  const home = new Set(homeRowChars(layout));
  const ikis = stats.filter((s) => home.has(s.char) && s.n > 0).map((s) => s.gmIki);
  return ikis.length > 0 ? geometricMean(ikis) : 0;
}

/** New-pattern candidates for the SRS queue from the current unit (§9.6). */
export function newPatternCandidates(state: CurriculumState, layout: Layout): string[] {
  const unit = CURRICULUM.find((u) => u.id === state.unitId);
  if (!unit) return [];
  return unit.targets(layout).filter((t) => {
    if (state.track === 'foundations') {
      return [...t].every((c) => state.unlockedChars.includes(c));
    }
    return true;
  });
}

export function advanceUnit(state: CurriculumState): CurriculumState {
  const idx = CURRICULUM.findIndex((u) => u.id === state.unitId);
  const next = CURRICULUM[idx + 1];
  if (!next) return state;
  return {
    ...state,
    track: next.track,
    unitId: next.id,
    completedUnits: [...state.completedUnits, state.unitId],
  };
}
