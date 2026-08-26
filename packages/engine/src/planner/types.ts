import type { TypingProfileId } from '@typing-trainer/content';
import type { BlockKind, Stage, TrainingMode, VisibilityMode } from '../types';
import type { DiagnosisSnapshot } from '../types';

export type { BlockKind, Stage, TrainingMode, VisibilityMode, DiagnosisSnapshot };

export type InputPolicyLike = 'free' | 'strict';

export interface PlannedBlock {
  ordinal: number;
  kind: BlockKind;
  minutes: number;
  stage: Stage;
  targets: string[];
  visibility: VisibilityMode;
  policy: InputPolicyLike;
  /** Warm-ups are never scored against the profile (§12.2). */
  scored: boolean;
  label: string;
  seed: number;
  profile: TypingProfileId;
}

export interface SessionPlan {
  blocks: PlannedBlock[];
  minutes: number;
  seed: number;
}

export interface BlockResult {
  ordinal: number;
  kind: BlockKind;
  targets: string[];
  wpmNet: number;
  accuracy: number;
  /** Did the block meet its exit criteria (target-pattern improvement)? */
  targetMet: boolean;
}
