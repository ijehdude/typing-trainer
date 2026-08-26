import { CONFIG, retentionFactor, type EngineConfig } from '../config';
import { clamp, geometricMean } from '../metrics/index';
import type { PatternType } from '../types';

/**
 * Spaced repetition for motor patterns (PRD §9): graded from measured
 * performance (never self-reported), flatter power-law forgetting than
 * declarative SRS, and a hard cap on the post-lapse interval.
 */

export type SrsGrade = 'again' | 'hard' | 'good' | 'easy';
export type SrsState = 'new' | 'learning' | 'review' | 'mastered' | 'relearning';

export interface SrsItem {
  pattern: string;
  patternType: PatternType;
  stability: number;    // S, days
  difficulty: number;   // D, 0..1
  lastReview: number | null; // epoch ms
  dueAt: number;             // epoch ms
  reps: number;
  lapses: number;
  targetIki: number;    // ms
  state: SrsState;
}

const DAY_MS = 86_400_000;
const INITIAL_STABILITY_DAYS = 0.5;

export function createItem(
  pattern: string,
  patternType: PatternType,
  targetIki: number,
  now: number,
): SrsItem {
  return {
    pattern,
    patternType,
    stability: INITIAL_STABILITY_DAYS,
    difficulty: 0.3,
    lastReview: null,
    dueAt: now,
    reps: 0,
    lapses: 0,
    targetIki,
    state: 'new',
  };
}

/** Motor retrievability r(Δ, S) = (1 + Δ/(9S))^−0.4 (PRD §9.4). */
export function retrievability(deltaDays: number, stability: number, cfg: EngineConfig = CONFIG): number {
  const { retrievabilityK, retrievabilityDecay } = cfg.srs;
  if (stability <= 0) return 0;
  return Math.pow(1 + deltaDays / (retrievabilityK * stability), retrievabilityDecay);
}

/**
 * Grade from measured performance (PRD §9.3): any error → again; otherwise
 * by ratio of observed gm IKI to the pattern's target. Requires ≥ 4 clean
 * observations — single-observation noise never triggers a state change.
 */
export function gradeFromObservations(
  ikis: readonly number[],
  errorCount: number,
  targetIki: number,
  cfg: EngineConfig = CONFIG,
): SrsGrade | null {
  if (ikis.length + errorCount < cfg.srs.minObsPerGrade) return null;
  if (errorCount > 0) return 'again';
  if (ikis.length === 0 || targetIki <= 0) return null;
  const ratio = geometricMean([...ikis]) / targetIki;
  if (ratio > cfg.srs.againRatio) return 'again';
  if (ratio > cfg.srs.hardRatio) return 'hard';
  if (ratio > cfg.srs.goodRatio) return 'good';
  return 'easy';
}

/** Target IKI for a pattern: the user's own gm IKI × the class allowance (§9.3). */
export function targetIkiFor(
  globalGmIki: number,
  patternClass: keyof EngineConfig['srs']['targetIkiAllowance'],
  cfg: EngineConfig = CONFIG,
): number {
  return globalGmIki * cfg.srs.targetIkiAllowance[patternClass];
}

/** Apply a review (PRD §9.4). Pure — returns the updated item. */
export function applyReview(
  item: SrsItem,
  grade: SrsGrade,
  now: number,
  cfg: EngineConfig = CONFIG,
): SrsItem {
  const s = cfg.srs;
  const deltaDays = item.lastReview === null ? 0 : (now - item.lastReview) / DAY_MS;
  const r = item.lastReview === null ? 1 : retrievability(deltaDays, item.stability, cfg);

  let S = item.stability;
  let lapses = item.lapses;
  let state: SrsState = item.state;

  switch (grade) {
    case 'again':
      // The ceiling matters: a failed S=40d pattern must not reschedule 8d out.
      S = clamp(S * s.againFactor, s.againFloorDays, s.againCeilDays);
      lapses += 1;
      state = 'relearning';
      break;
    case 'hard':
      S = S * (s.hardBase + s.hardBonus * (1 - r));
      state = item.state === 'new' ? 'learning' : item.state === 'relearning' ? 'learning' : 'review';
      break;
    case 'good':
      S = S * (s.goodBase + s.goodBonus * (1 - r));
      state = item.state === 'new' || item.state === 'relearning' ? 'learning' : 'review';
      break;
    case 'easy':
      S = S * (s.easyBase + s.easyBonus * (1 - r));
      state = 'review';
      break;
  }
  S = Math.min(S, s.stabilityCeilDays);

  const gradeIndex = { again: 0, hard: 1, good: 2, easy: 3 }[grade];
  const difficulty = clamp(item.difficulty + s.difficultyStep * (2 - gradeIndex), 0, 1);

  const effectiveS = S * (1 - s.difficultyIntervalScale * difficulty);
  const intervalDays = Math.min(effectiveS * retentionFactor(cfg), s.intervalCapDays);

  if (state === 'review' && S >= 30 && (grade === 'good' || grade === 'easy')) {
    state = 'mastered';
  }

  return {
    ...item,
    stability: S,
    difficulty,
    lastReview: now,
    dueAt: now + intervalDays * DAY_MS,
    reps: item.reps + 1,
    lapses,
    state,
  };
}

// --- Intra-session ladder (PRD §9.5) --------------------------------------

export interface LadderEntry {
  pattern: string;
  rung: number;       // 0-based index into ladderMinutes
  dueAtMs: number;    // session-relative ms
}

/**
 * A pattern graded `again` inside a session re-surfaces at +2, +6, +15 min.
 * A `good` or better advances a rung; failure resets to the bottom.
 * Patterns that clear the last rung leave the ladder (handled next session).
 */
export class SessionLadder {
  private entries = new Map<string, LadderEntry>();

  constructor(private readonly cfg: EngineConfig = CONFIG) {}

  fail(pattern: string, nowMs: number): void {
    const rungs = this.cfg.srs.ladderMinutes;
    this.entries.set(pattern, {
      pattern,
      rung: 0,
      dueAtMs: nowMs + rungs[0]! * 60_000,
    });
  }

  succeed(pattern: string, nowMs: number): void {
    const entry = this.entries.get(pattern);
    if (!entry) return;
    const rungs = this.cfg.srs.ladderMinutes;
    const nextRung = entry.rung + 1;
    if (nextRung >= rungs.length) {
      this.entries.delete(pattern); // cleared the ladder for this session
    } else {
      this.entries.set(pattern, {
        pattern,
        rung: nextRung,
        dueAtMs: nowMs + rungs[nextRung]! * 60_000,
      });
    }
  }

  due(nowMs: number): string[] {
    return [...this.entries.values()]
      .filter((e) => e.dueAtMs <= nowMs)
      .sort((a, b) => a.dueAtMs - b.dueAtMs)
      .map((e) => e.pattern);
  }

  all(): LadderEntry[] {
    return [...this.entries.values()];
  }
}

// --- Queue construction (PRD §9.6) ----------------------------------------

export interface QueueInputs {
  items: readonly SrsItem[];
  /** Estimated WPM cost per pattern (from findings), default 0. */
  costs: ReadonlyMap<string, number>;
  /** Ordered new-pattern candidates from the curriculum position. */
  newCandidates: readonly string[];
  now: number;
  /** Total pattern slots to fill for the session. */
  budget: number;
}

export interface QueueEntry {
  pattern: string;
  patternType: PatternType;
  source: 'due' | 'new' | 'mastered';
}

export function buildQueue(inp: QueueInputs, cfg: EngineConfig = CONFIG): QueueEntry[] {
  const s = cfg.srs;
  const nDue = Math.round(inp.budget * s.queueDueShare);
  const nNew = Math.min(Math.round(inp.budget * s.queueNewShare), s.maxNewPerSession);
  const nMastered = inp.budget - nDue - nNew;

  const due = inp.items
    .filter((i) => i.dueAt <= inp.now && i.state !== 'new' && i.state !== 'mastered')
    .map((i) => {
      const overdueDays = (inp.now - i.dueAt) / DAY_MS;
      const interval = Math.max(0.02, i.stability * retentionFactor(cfg));
      const overdueness = 1 + overdueDays / interval;
      const cost = inp.costs.get(i.pattern) ?? 0;
      return { item: i, priority: (cost + 0.1) * overdueness };
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, nDue)
    .map(({ item }) => ({ pattern: item.pattern, patternType: item.patternType, source: 'due' as const }));

  const existing = new Set(inp.items.map((i) => i.pattern));
  const fresh = inp.newCandidates
    .filter((p) => !existing.has(p))
    .slice(0, nNew)
    .map((pattern) => ({ pattern, patternType: inferType(pattern), source: 'new' as const }));

  const mastered = inp.items
    .filter((i) => i.state === 'mastered')
    .sort((a, b) => a.dueAt - b.dueAt) // most-overdue mastered first (retention)
    .slice(0, Math.max(0, nMastered))
    .map((i) => ({ pattern: i.pattern, patternType: i.patternType, source: 'mastered' as const }));

  return [...due, ...fresh, ...mastered];
}

function inferType(pattern: string): PatternType {
  if (pattern.length === 1) return 'key';
  if (pattern.length === 2) return 'bigram';
  if (pattern.length === 3) return 'trigram';
  return pattern.startsWith('class:') ? 'class' : 'word';
}
