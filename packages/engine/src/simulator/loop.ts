import type { Layout, TypingProfileId } from '@typing-trainer/content';
import { analyzeBlock, type AnalyzedBlock } from '../capture/analyze';
import { CONFIG, type EngineConfig } from '../config';
import { transitionFrequencies } from '../diagnosis/counterfactual';
import { analyzeSession } from '../diagnosis/snapshot';
import type { FindingCandidate } from '../diagnosis/findings';
import { generate } from '../generators/index';
import { geometricMean, netWpm } from '../metrics/index';
import type { Observation } from '../model/observations';
import { planSession, replanRemaining, type BlockResult, type SessionPlan } from '../planner/index';
import {
  applyReview, buildQueue, createItem, gradeFromObservations, targetIkiFor,
  type SrsItem,
} from '../srs/index';
import type { DiagnosisSnapshot } from '../types';
import { simulateTyping, type TypistProfile } from './index';

/**
 * The whole-loop simulation harness (PRD Appendix C reason #2): run a
 * synthetic typist through N Autopilot sessions in milliseconds — planner,
 * generators, SRS, diagnosis — and observe whether training actually works.
 * Used by regression tests and by the ridge-vs-baseline experiment (§24.2).
 */

export interface LoopOptions {
  typist: TypistProfile;
  layout: Layout;
  sessions: number;
  profile?: TypingProfileId;
  seed: number;
  /** Characters generated per planned minute (scaled down for fast tests). */
  charsPerMinute?: number;
  /** Per-exposure IKI multiplier applied to trained patterns (learning). */
  trainingEffect?: number;
  cfg?: EngineConfig;
}

export interface SessionRecord {
  sessionId: number;
  plan: SessionPlan;
  snapshot: DiagnosisSnapshot;
  speedTestWpm: number;
  trainedPatterns: string[];
}

const DAY_MS = 86_400_000;

export function runTrainingLoop(opts: LoopOptions): SessionRecord[] {
  const cfg = opts.cfg ?? CONFIG;
  const layout = opts.layout;
  const cpm = opts.charsPerMinute ?? 80;
  const profile = opts.profile ?? 'writer';
  const records: SessionRecord[] = [];

  let retained: Observation[] = [];
  let snapshot: DiagnosisSnapshot | null = null;
  let belowBar: FindingCandidate[] = [];
  const srsItems = new Map<string, SrsItem>();
  const exposures = new Map<string, number>();
  const stageByPattern: Record<string, number> = {};

  // Reference corpus for costing: the typist's stage-5 world.
  const refText = generate(
    { stage: 5, targets: [], length: 4000, profile, seed: opts.seed, difficulty: 0.5 },
    cfg,
  ).text;
  const corpusFreqs = transitionFrequencies(refText, layout);

  for (let s = 0; s < opts.sessions; s++) {
    const now = s * DAY_MS;
    const queue = buildQueue(
      {
        items: [...srsItems.values()],
        costs: new Map(snapshot?.findings.flatMap((f) => f.patterns.map((p) => [p, f.estWpmCost] as const)) ?? []),
        newCandidates: [],
        now,
        budget: 8,
      },
      cfg,
    );

    const plan = planSession(
      {
        snapshot,
        belowBar,
        srsQueue: queue,
        stageByPattern: stageByPattern as Record<string, 0 | 1 | 2 | 3 | 4 | 5>,
        profile,
        seed: opts.seed + s * 1000,
      },
      cfg,
    );

    // Skill adjustment from training so far.
    const skillAdjust = new Map<string, number>();
    const effect = opts.trainingEffect ?? 0.94;
    for (const [pattern, count] of exposures) {
      if (pattern.length === 2) {
        skillAdjust.set(pattern, Math.max(0.6, Math.pow(effect, count)));
      }
    }

    const blocks: AnalyzedBlock[] = [];
    const results: BlockResult[] = [];
    let remaining = [...plan.blocks];
    let speedTestWpm = 0;
    const trainedThisSession = new Set<string>();

    while (remaining.length > 0) {
      const block = remaining.shift()!;
      const gen = generate(
        {
          stage: block.stage,
          targets: block.targets,
          length: Math.max(40, Math.round(block.minutes * cpm)),
          profile,
          seed: block.seed,
          difficulty: 0.5,
        },
        cfg,
      );
      const stream = simulateTyping(opts.typist, gen.text, layout, {
        seed: block.seed + 7,
        skillAdjust,
        startT: 1000,
      });
      const analyzed = analyzeBlock(stream, layout, gen.text, cfg);
      blocks.push(analyzed);

      const correctChars = analyzed.keystrokes.filter((k) => k.correct && !k.isCorrection).length;
      const wpm = netWpm(correctChars, analyzed.activeMs);
      if (block.kind === 'test') speedTestWpm = wpm;

      // Grade the block's target patterns and update SRS + exposures.
      let targetMet = true;
      if (block.kind === 'target' || block.kind === 'probe') {
        const globalIkis = analyzed.keystrokes
          .filter((k) => k.iki !== null && !k.excludedFromTiming)
          .map((k) => k.iki!);
        const globalGm = globalIkis.length > 0 ? geometricMean(globalIkis) : 200;
        for (const pattern of block.targets) {
          trainedThisSession.add(pattern);
          exposures.set(pattern, (exposures.get(pattern) ?? 0) + 1);
          const { ikis, errors } = patternObservations(analyzed, pattern);
          const item =
            srsItems.get(pattern) ??
            createItem(pattern, pattern.length === 1 ? 'key' : 'bigram', targetIkiFor(globalGm, 'default', cfg), now);
          const grade = gradeFromObservations(ikis, errors, item.targetIki, cfg);
          if (grade !== null) {
            srsItems.set(pattern, applyReview(item, grade, now, cfg));
            if (grade === 'again') targetMet = false;
          }
        }
      }
      results.push({
        ordinal: block.ordinal,
        kind: block.kind,
        targets: block.targets,
        wpmNet: wpm,
        accuracy: 1,
        targetMet,
      });
      remaining = replanRemaining({ remaining, completed: results }, cfg);
    }

    const analysis = analyzeSession(
      {
        blocks,
        layout,
        sessionId: s + 1,
        corpusFreqs,
        retainedObs: retained,
      },
      cfg,
    );
    retained = [...retained, ...analysis.observations].slice(-6000);
    snapshot = analysis.snapshot;
    belowBar = analysis.belowBar;

    records.push({
      sessionId: s + 1,
      plan,
      snapshot,
      speedTestWpm,
      trainedPatterns: [...trainedThisSession],
    });
  }

  return records;
}

function patternObservations(
  block: AnalyzedBlock,
  pattern: string,
): { ikis: number[]; errors: number } {
  const ikis: number[] = [];
  let errors = 0;
  const kss = block.keystrokes;
  for (let i = 0; i < kss.length; i++) {
    const ks = kss[i]!;
    if (pattern.length === 1) {
      if (ks.expected === pattern) {
        if (ks.errorType !== null) errors++;
        else if (ks.iki !== null && !ks.excludedFromTiming) ikis.push(ks.iki);
      }
    } else if (i > 0) {
      const prev = kss[i - 1]!;
      if (prev.key + ks.expected === pattern || prev.expected + ks.expected === pattern) {
        if (ks.errorType !== null) errors++;
        else if (ks.iki !== null && !ks.excludedFromTiming) ikis.push(ks.iki);
      }
    }
  }
  return { ikis, errors };
}
