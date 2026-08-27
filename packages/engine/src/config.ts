/**
 * Every tunable constant in the product (marked ⚙️ in the PRD) lives here and
 * nowhere else (PRD Appendix D). The object is deep-frozen; `configHash()` is
 * stored on every session so historical comparisons stay honest after tuning.
 */

export const ENGINE_VERSION = '0.1.0';
export const SCORE_VERSION = 1;

export const CONFIG = deepFreeze({
  timing: {
    /** IKIs below this are key-rollover/hardware artifacts — excluded. §6.2 */
    ikiMinMs: 15,
    /** Gaps above this are pauses: excluded from IKI stats and elapsed time. §6.2 */
    ikiMaxMs: 2000,
  },

  model: {
    /** Ridge L2 penalty for all coefficients. §7.2 */
    lambda: 1.0,
    /** Stronger penalty for per-bigram residual coefficients δ. §7.2 */
    lambdaDelta: 4.0,
    /** Batch refit window: most recent retained IKIs. §7.2 */
    refitWindow: 20_000,
    /** Rolling window (keystrokes each side) for local speed. §7.5 */
    localSpeedHalfWindow: 8,
    /** Predicted accuracy defining Control Speed. §7.5 */
    controlAccuracy: 0.97,
    /** Predicted accuracy defining Collapse Speed. §7.5 */
    collapseAccuracy: 0.93,
    /** Residual > this many MADs ⇒ hesitation. §7.6 */
    hesitationMadThreshold: 2.5,
  },

  confidence: {
    /** §7.7 */
    lowMinObs: 30,
    mediumMinObs: 100,
    mediumMinSessions: 2,
    mediumMinSe: 2,
    highMinObs: 300,
    highMinSessions: 4,
    highMinSe: 3,
  },

  skill: {
    /** Trailing sessions window and EWMA weight. §8.2 */
    windowSessions: 10,
    ewmaAlpha: 0.25,
    /** Speed score anchors: piecewise-linear WPM → score. §8.2 */
    speedAnchors: [
      [20, 10], [40, 30], [60, 50], [80, 70], [100, 85], [120, 95], [140, 100],
    ] as ReadonlyArray<readonly [number, number]>,
    accuracyFloor: 0.90,
    accuracyExponent: 0.65,
    /** Rhythm divisor — the least-grounded constant in the PRD; recalibrate at ~500 sessions. §8.2 */
    rhythmMadDivisor: 0.90,
    /** Weak-key control: worst-N keys vs own median. §8.2 */
    weakKeyWorstN: 5,
    weakKeyMinObs: 20,
    /** Composite weights. §8.3 */
    weights: {
      speed: 0.30,
      accuracy: 0.25,
      consistency: 0.15,
      rhythm: 0.10,
      weakKeyControl: 0.12,
      punctuation: 0.08,
    },
    /** Max composite movement from a single session. §8.4 */
    maxCompositeDeltaPerSession: 3,
  },

  srs: {
    /** Grade thresholds on ratio = observedIki / targetIki. §9.3 */
    againRatio: 1.6,
    hardRatio: 1.25,
    goodRatio: 1.0,
    /** Minimum observations of a pattern in a block before grading. §9.3 */
    minObsPerGrade: 4,
    /** Retrievability r(Δ,S) = (1 + Δ/(k·S))^decay. §9.4 */
    retrievabilityK: 9,
    retrievabilityDecay: -0.4,
    /** Stability updates. §9.4 */
    againFactor: 0.20,
    againFloorDays: 0.02,
    againCeilDays: 3.0,
    hardBase: 1.15, hardBonus: 0.10,
    goodBase: 2.10, goodBonus: 0.60,
    easyBase: 3.00, easyBonus: 1.00,
    stabilityCeilDays: 365,
    difficultyStep: 0.12,
    difficultyIntervalScale: 0.5,
    targetRetention: 0.85,
    intervalCapDays: 180,
    /** Intra-session ladder rungs, minutes. §9.5 */
    ladderMinutes: [2, 6, 15] as readonly number[],
    /** Queue mix. §9.6 */
    queueDueShare: 0.50,
    queueNewShare: 0.30,
    queueMasteredShare: 0.20,
    maxNewPerSession: 4,
    /** Class-difficulty allowances on targetIki (multiplier over global gm IKI). §9.3 */
    targetIkiAllowance: { default: 1.0, sfb: 1.35, rowJump: 1.2, shifted: 1.25 },
  },

  content: {
    /** Promotion gate. §10.2 */
    promoteAccuracy: 0.98,
    promoteObsWindow: 30,
    promoteIkiRatio: 1.20,
    promoteMinSessions: 2,
    /** Demotion gate. §10.2 */
    demoteAccuracy: 0.93,
    demoteObsWindow: 20,
    /**
     * The lowest stage anything is ever scheduled at. Stages 0–1 (drills and
     * synthetic pseudo-words) remain implemented for ladder completeness, but
     * we never put a person in front of text that isn't real language: even
     * home-row-only Foundations has real words (`a as had all has half sad`),
     * which beats `iol iop` on both dignity and transfer. Demotion, probes,
     * and prescriptions all clamp here.
     */
    minStage: 2,
    /**
     * Where a pattern *enters* the ladder, by measured net WPM. Someone who
     * already types 70 WPM should start on phrases — the same principle as
     * §11.2 skipping Foundations at 50+. Promotion moves them on from here.
     */
    stageFloorByWpm: [
      [0, 2], [70, 3],
    ] as ReadonlyArray<readonly [number, number]>,
    /** Used when no measurement exists yet. */
    defaultStageFloor: 2,
    /** Generator target density: occurrences per 100 chars, ±tolerance. §10.3 */
    defaultTargetDensity: 18,
    densityTolerance: 0.20,
    wordRepeatWindow: 6,
    /** Stage-5 passage length bounds, chars. §10.4 */
    passageMinChars: 40,
    passageMaxChars: 400,
  },

  curriculum: {
    /** Foundations unlock bar. §11.2 */
    unlockAccuracy: 0.97,
    unlockIkiRatio: 1.35,
    unlockMinObs: 40,
  },

  planner: {
    sessionMinutes: [5, 10, 15, 25] as readonly number[],
    defaultSessionMinutes: 15,
    /** Fatigue: within-session decline from peak across 2 blocks. §12.3 */
    fatigueDeclinePct: 0.08,
    microRestSeconds: 30,
    dailyCapMinutes: 45,
    restDayAfterConsecutive: 6,
    probeMinSeconds: 45,
    probeMaxSeconds: 90,
  },

  live: {
    /** Analyzer batch size (keystrokes). §13.1 */
    batchKeystrokes: 8,
    /** Re-target when top target's cost drops below runner-up by this much. §13.1 */
    retargetMargin: 0.10,
    /** Lookahead buffer: visible text never mutates. §13.2 */
    lookaheadLines: 3,
    lookaheadChars: 200,
  },

  plateau: {
    /** §14.3 */
    windowSessions: 10,
    minSpanDays: 14,
    projectedGainWpm: 1.5,
  },

  stuck: {
    /** "Why am I stuck?" detection thresholds. §14.3 */
    accDropQuartilePp: 3,
    backspaceTimePct: 0.06,
    classGapPoints: 15,
    hiddenGapPct: 0.12,
    minSessionsPerWeek: 3,
  },

  habits: {
    /** §15.1 */
    visualSearchLatencyRatio: 1.8,
    visualSearchVisibleGapPct: 0.25,
    handImbalancePct: 0.10,
    handImbalanceSessions: 3,
    rhythmKneeMinSamples: 200,
    backspaceThrashPer100: 8,
    wordBoundaryHesitationRatio: 1.5,
    burstStallGapPoints: 20,
    shiftHandLatencyRatio: 1.6,
    lookAheadBoundaryRatio: 2.0,
    overdrivingKeystrokeShare: 0.20,
    suppressionDays: 30,
    maxAlertsPerSession: 1,
  },

  modes: {
    /** §16.1 */
    speedAccuracyFloor: 0.95,
    precisionAccuracyTarget: 0.995,
  },

  visibility: {
    /** Touch-typing confidence needs this many paired blocks in 14 days. §16.2 */
    ttcMinPairedBlocks: 3,
    ttcWindowDays: 14,
    fadingSessionsPerStep: 3,
  },

  calibration: {
    /** Coverage engineering for the 90 s calibration test. §18.2 */
    minPerLetter: 8,
    topBigrams: 60,
    minPerBigram: 4,
  },

  coach: {
    llmGenerationsPerDay: 20,
  },

  retention: {
    rawBlobDays: 90,
    rawBlobSessions: 200,
    kAnonymity: 50,
  },

  ui: {
    fontSizePx: 18,
  },
} as const);

export type EngineConfig = typeof CONFIG;

/** Derived, not guessed (PRD §9.4): dueAt = lastReview + effectiveS · RETENTION_FACTOR. */
export function retentionFactor(cfg: EngineConfig = CONFIG): number {
  const { retrievabilityK: k, retrievabilityDecay, targetRetention } = cfg.srs;
  return k * (Math.pow(targetRetention, 1 / retrievabilityDecay) - 1);
}

/**
 * FNV-1a 32-bit over a canonical (sorted-key) JSON encoding. Stored on every
 * session; any constant change bumps the hash (PRD Appendix D, §19.7).
 */
export function configHash(cfg: EngineConfig = CONFIG): string {
  const json = canonicalJson(cfg);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj as object)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}
