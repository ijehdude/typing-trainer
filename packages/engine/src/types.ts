/** Shared vocabulary types — names follow PRD §5 exactly. */

export type Hand = 'L' | 'R';

/** 8 fingers + thumbs. L/R + Pinky/Ring/Middle/Index/Thumb. */
export type Finger =
  | 'LP' | 'LR' | 'LM' | 'LI' | 'LT'
  | 'RT' | 'RI' | 'RM' | 'RR' | 'RP';

/** Row 0 = number row, 1 = top, 2 = home, 3 = bottom, 4 = space row. */
export type Row = 0 | 1 | 2 | 3 | 4;

export type PatternType = 'key' | 'bigram' | 'trigram' | 'word' | 'class';

export type Stage = 0 | 1 | 2 | 3 | 4 | 5;

export type Track = 'foundations' | 'control' | 'speed' | 'fluency' | 'mastery';

export type VisibilityMode =
  | 'keyboard_visible'
  | 'keyboard_faded'
  | 'keyboard_hidden'
  | 'text_faded'
  | 'blind';

export type TrainingMode =
  | 'autopilot'
  | 'fix_weaknesses'
  | 'speed'
  | 'precision'
  | 'muscle_memory'
  | 'endurance'
  | 'pressure'
  | 'real_world'
  | 'experiment';

export type BlockKind = 'warmup' | 'target' | 'transfer' | 'test' | 'probe';

/** Raw per-keydown record (PRD §6.1). */
export interface Keystroke {
  t: number;             // performance.now() at keydown, ms, float
  tUp: number | null;    // keyup time (dwell), null if never released cleanly
  code: string;          // KeyboardEvent.code — physical key
  key: string;           // KeyboardEvent.key — produced character
  expected: string;      // character the user should have produced
  index: number;         // position in the block's target text
  correct: boolean;
  isCorrection: boolean; // Backspace or correction of a prior error
  repeat: boolean;       // held-key auto-repeat
  modifiers: number;     // bitfield: shift=1|ctrl=2|alt=4|meta=8
}

export const MOD_SHIFT = 1;
export const MOD_CTRL = 2;
export const MOD_ALT = 4;
export const MOD_META = 8;

export type ErrorType =
  | 'substitution'
  | 'transposition'
  | 'insertion'
  | 'omission'
  | 'adjacent_key'
  | 'same_finger'
  | 'mirror';

/** Keystroke enriched at analysis time via the layout map (PRD §6.1, §6.3). */
export interface AnalyzedKeystroke extends Keystroke {
  hand: Hand | null;      // null for keys outside the layout map (e.g. F-keys)
  finger: Finger | null;
  row: Row | null;
  col: number | null;
  /** IKI from the previous correct keydown, ms; null if none / excluded. */
  iki: number | null;
  excludedFromTiming: boolean;
  errorType: ErrorType | null; // null when correct
}

export type Confidence = 'insufficient' | 'low' | 'medium' | 'high';

export interface Finding {
  cause: string;                 // machine-readable cause id, e.g. 'finger:RP'
  label: string;                 // human-readable, e.g. 'Right pinky'
  evidence: string;              // one-sentence evidence summary with numbers
  estWpmCost: number;            // counterfactual ΔWPM (PRD §7.4)
  confidence: Confidence;
  patterns: string[];            // contributing patterns (for prescriptions)
}

export interface Prescription {
  findingCause: string;
  blockKind: BlockKind;
  stage: Stage;
  targets: string[];
  minutes: number;
  visibility: VisibilityMode;
  note: string;
}

export interface PatternStat {
  pattern: string;
  patternType: PatternType;
  n: number;
  ewmaLogIki: number;
  ewmaVar: number;
  accuracy: number;
  lastSeen: number; // epoch ms
}

export interface SkillProfile {
  speed: number;
  accuracy: number;
  consistency: number;
  rhythm: number;
  /** null = not yet measured; excluded from `overall` rather than scored 100. */
  weakKeyControl: number | null;
  /** null = not yet measured. */
  punctuation: number | null;
  overall: number;
  raw: {
    wpmNet: number;
    firstAttemptAccuracy: number;
    cv: number;
    residualMad: number;
    weakKeyRatio: number | null;   // m_med / m_worst
    punctRatio: number | null;     // m_alpha / m_punct
  };
}

export interface SessionMetrics {
  wpmNet: number;
  wpmRaw: number;
  accuracy: number;        // first-attempt, 0..1
  consistency: number;     // 0..100
  rhythm: number;          // 0..100
  hesitationRate: number;  // per 100 keystrokes
  backspaceRate: number;   // corrections per 100 chars
  correctionTimePct: number; // % of active time spent in corrections
  keystrokes: number;
  errors: number;
  corrections: number;
  activeMs: number;
  timingSuspect: boolean;
}

export interface TradeoffCurve {
  alpha: number;
  beta: number;
  vControl: number;   // WPM where predicted accuracy crosses CONTROL threshold
  vCollapse: number;  // WPM where predicted accuracy crosses COLLAPSE threshold
  headroom: number;   // vCollapse − currentWpm
  r2: number;
  n: number;
}

export interface HabitFlag {
  habit: string;        // detector id
  evidence: string;     // hedged, evidence-first copy (PRD §15.4)
  metrics: Record<string, number>;
  remedy: Prescription;
}

/** The single engine output contract (PRD §7.8). */
export interface DiagnosisSnapshot {
  sessionMetrics: SessionMetrics;
  skillProfile: SkillProfile;
  findings: Finding[];            // ranked by estWpmCost desc
  tradeoff: TradeoffCurve;
  bottlenecks: { patterns: PatternStat[] };
  habits: HabitFlag[];
  confidenceNotes: string[];
}
