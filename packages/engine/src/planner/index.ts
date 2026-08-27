import type { TypingProfileId } from '@typing-trainer/content';
import { CONFIG, type EngineConfig } from '../config';
import { commonBigrams } from '../curriculum/index';
import type { FindingCandidate } from '../diagnosis/findings';
import type { QueueEntry } from '../srs/index';
import type {
  BlockKind, DiagnosisSnapshot, InputPolicyLike, Stage, TrainingMode, VisibilityMode,
} from './types';

export type { PlannedBlock, SessionPlan, BlockResult } from './types';
import type { PlannedBlock, SessionPlan, BlockResult } from './types';

/**
 * Autopilot: the session planner (PRD §12). One button; the system decides
 * the whole session, adapts at block boundaries (§13.3), and never corrupts
 * the trend metric — the closing speed test is always untargeted.
 */

export interface PlanInput {
  snapshot: DiagnosisSnapshot | null;    // null = cold start
  belowBar?: readonly FindingCandidate[];
  srsQueue?: readonly QueueEntry[];
  stageByPattern?: Readonly<Record<string, Stage>>;
  /** Ladder entry point for patterns with no history (see `stageFloorForWpm`). */
  stageFloor?: Stage;
  profile: TypingProfileId;
  seed: number;
  mode?: TrainingMode;
}

export function planSession(input: PlanInput, cfg: EngineConfig = CONFIG): SessionPlan {
  const findings = input.snapshot?.findings ?? [];
  const primary = findings[0] ?? null;
  const secondary = findings[1] ?? null;
  // A probe spends the whole practice minute, so it must have something
  // trainable to spend it on — class-level candidates (e.g. same-finger
  // bigrams) carry no patterns and would gather nothing.
  const probe =
    (input.belowBar ?? [])
      .filter((c) => c.patterns.some((p) => p.length <= 3))
      .sort((a, b) => b.estWpmCost - a.estWpmCost)[0] ?? null;

  // Untracked patterns enter the ladder at the user's level, not at the
  // bottom (§10.1). A pattern that has been demoted keeps its earned stage —
  // the floor is an entry point, not a clamp.
  const entryStage = Math.max(cfg.content.minStage, input.stageFloor ?? cfg.content.minStage) as Stage;
  const stageFor = (patterns: readonly string[]): Stage => {
    if (patterns.length === 0) return 4;
    const stages = patterns.map((p) => input.stageByPattern?.[p] ?? entryStage);
    return Math.min(...stages) as Stage;
  };

  const patternsOf = (f: { patterns: string[] } | null, fallback: string[]): string[] => {
    const ps = f?.patterns.filter((p) => p.length <= 3) ?? [];
    return ps.length > 0 ? ps.slice(0, 4) : fallback;
  };

  // Cold start: no diagnosis yet — train broad common patterns; the session
  // itself gathers the data the model needs (PRD §12.2 acceptance).
  const coldTargets = commonBigrams(8);
  const primaryTargets = patternsOf(primary, coldTargets.slice(0, 4));
  const secondaryTargets = patternsOf(secondary, coldTargets.slice(4, 8));
  const srsTargets = (input.srsQueue ?? []).map((q) => q.pattern).filter((p) => p.length <= 3);
  if (srsTargets.length > 0) {
    // Due SRS patterns join the primary block's target set (§9.6, §12.1).
    for (const t of srsTargets.slice(0, 3)) {
      if (!primaryTargets.includes(t)) primaryTargets.push(t);
    }
  }

  const blocks: PlannedBlock[] = [];
  let ordinal = 0;
  const push = (
    kind: BlockKind, minutes: number, stage: Stage, targets: string[],
    opts: Partial<Pick<PlannedBlock, 'visibility' | 'policy' | 'scored' | 'label'>> = {},
  ) => {
    blocks.push({
      ordinal: ordinal++,
      kind,
      minutes,
      stage,
      targets,
      visibility: opts.visibility ?? 'keyboard_hidden',
      policy: opts.policy ?? 'free',
      scored: opts.scored ?? true,
      label: opts.label ?? defaultLabel(kind, targets),
      seed: input.seed * 31 + ordinal,
      profile: input.profile,
    });
  };

  // One session, always: a minute of practice then a minute of measurement.
  // Every block is exactly `blockMinutes`; there is no duration choice
  // anywhere in the product. There is no warm-up block — the practice minute
  // serves as one for the speed test, which is the only scored trend metric
  // (§12.2) and stays a full minute because milestones are defined against a
  // 1-minute test (§17.3).
  const m = cfg.planner.sessionMinutes;
  const len = cfg.planner.blockMinutes;
  if (probe && findings.length < 2) {
    // A probe replaces the practice minute rather than adding time (§12.4).
    push('probe', len, entryStage, probe.patterns.filter((p) => p.length <= 3).slice(0, 2), {
      label: 'Quick check',
    });
  } else {
    push('target', len, stageFor(primaryTargets), primaryTargets);
  }
  push('test', len, 5, [], { label: 'Speed test' });

  applyModeOverrides(blocks, input.mode ?? 'autopilot');
  enforceInvariants(blocks, cfg);
  return { blocks, minutes: m, seed: input.seed };
}

/** Training modes (PRD §16.1) reshape the Autopilot template, not replace it. */
function applyModeOverrides(blocks: PlannedBlock[], mode: TrainingMode): void {
  for (const b of blocks) {
    if (b.kind === 'warmup' || b.kind === 'test') continue;
    switch (mode) {
      case 'speed':
        b.stage = Math.max(4, b.stage) as Stage; // shorter, easier, real text
        break;
      case 'precision':
        b.policy = 'strict';
        break;
      case 'muscle_memory':
        b.visibility = 'keyboard_hidden';
        b.stage = Math.min(2, b.stage) as Stage;
        break;
      case 'real_world':
        b.kind = 'transfer';
        b.stage = 5;
        b.label = 'Real-world typing';
        break;
      case 'fix_weaknesses':
        if (b.kind === 'transfer') {
          b.kind = 'target';
          b.stage = 2;
          b.label = 'Weakness drill';
        }
        break;
      default:
        break;
    }
  }
}

/** Hard invariants (PRD §12.2). Throws in dev; the planner must never emit these. */
function enforceInvariants(blocks: readonly PlannedBlock[], cfg: EngineConfig): void {
  const test = blocks[blocks.length - 1];
  if (!test || test.kind !== 'test' || test.targets.length > 0 || test.stage !== 5) {
    throw new Error('planner invariant: last block must be an untargeted stage-5 speed test');
  }
  if (blocks.some((b) => b.minutes !== cfg.planner.blockMinutes)) {
    throw new Error('planner invariant: every block is exactly blockMinutes long');
  }
  if (blocks.reduce((s, b) => s + b.minutes, 0) !== cfg.planner.sessionMinutes) {
    throw new Error('planner invariant: the session is exactly sessionMinutes long');
  }
  const belowMin = blocks.find((b) => b.stage < cfg.content.minStage);
  if (belowMin) {
    throw new Error(
      `planner invariant: no block may use non-word content (block "${belowMin.label}" at stage ${belowMin.stage})`,
    );
  }
}

function defaultLabel(kind: BlockKind, targets: readonly string[]): string {
  switch (kind) {
    case 'warmup': return 'Warm-up';
    case 'test': return 'Speed test';
    case 'probe': return 'Quick check';
    case 'transfer': return 'Real-world transfer';
    case 'target':
      return targets.length > 0 ? `Fix ${targets.slice(0, 3).map(printable).join(', ')}` : 'Targeted drill';
  }
}

function printable(p: string): string {
  return p === ' ' ? 'space' : p.length === 2 ? `${p[0]} → ${p[1]}` : p;
}

// --- Mid-session re-planning (PRD §13.3) ----------------------------------

export interface ReplanContext {
  remaining: PlannedBlock[];
  completed: BlockResult[];
}

/**
 * Two consecutive failed blocks on the same pattern must trigger a change of
 * strategy, not a third block; targets met early promote a stage.
 */
export function replanRemaining(ctx: ReplanContext, cfg: EngineConfig = CONFIG): PlannedBlock[] {
  const { remaining, completed } = ctx;
  if (remaining.length === 0 || completed.length === 0) return [...remaining];
  const last = completed[completed.length - 1]!;
  const prev = completed[completed.length - 2];

  return remaining.map((block) => {
    if (block.kind === 'test' || block.kind === 'warmup') return block; // never touched
    const sharesTarget = block.targets.some((t) => last.targets.includes(t));
    if (!sharesTarget) return block;

    if (last.targetMet && block.kind === 'target') {
      // Met early → promote a stage (§13.3).
      return { ...block, stage: Math.min(5, block.stage + 1) as Stage };
    }
    const lastFailed = !last.targetMet;
    const prevFailedSame =
      prev !== undefined && !prev.targetMet && prev.targets.some((t) => last.targets.includes(t));
    if (lastFailed && prevFailedSame) {
      // Change of strategy: drop a stage; if already at the bottom, swap to
      // an adjacent pattern (first differing target drops out).
      if (block.stage > cfg.content.minStage) {
        return { ...block, stage: (block.stage - 1) as Stage, label: `${block.label} (easier)` };
      }
      const swapped = block.targets.slice(1);
      return {
        ...block,
        targets: swapped.length > 0 ? swapped : block.targets,
        label: `${block.label} (new angle)`,
      };
    }
    return block;
  });
}

// --- Fatigue and load management (PRD §12.3) ------------------------------

export interface FatigueDecision {
  microRest: boolean;
  reduceDifficulty: boolean;
}

export function checkFatigue(blockWpms: readonly number[], cfg: EngineConfig = CONFIG): FatigueDecision {
  if (blockWpms.length < 3) return { microRest: false, reduceDifficulty: false };
  const peak = Math.max(...blockWpms);
  const lastTwo = blockWpms.slice(-2);
  const declined = lastTwo.every((w) => w < peak * (1 - cfg.planner.fatigueDeclinePct));
  return { microRest: declined, reduceDifficulty: declined };
}
