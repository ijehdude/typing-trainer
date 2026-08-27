import {
  analyzeBlock, applyGate, applyReview, blockBoundaryMessage, buildQueue, checkFatigue,
  CONFIG, configHash, createItem, ENGINE_VERSION, gateDecision, generate, geometricMean,
  gradeFromObservations, handIkiRatio, initialCurriculumState, LiveAnalyzer, netWpm,
  planSession, replanRemaining, SCORE_VERSION, sessionOpenMessage, stageFloorForWpm,
  targetIkiFor, transitionFrequencies, updateComposite,
  type AnalyzedBlock, type BlockResult, type CurriculumState, type DiagnosisSnapshot,
  type FindingCandidate, type PlannedBlock, type SessionPlan, type SrsItem, type Stage,
} from "@typing-trainer/engine";
import { getLayout } from "@typing-trainer/content";
import { runSessionAnalysis } from "./analysis-client";
import {
  completedSessions, db, getCurriculumState, getSettings, kvGet, kvSet,
  loadRetainedObservations, loadSrsItems, packKeystrokes, packObservations,
  saveCurriculumState, saveSettings, saveSrsItem, uuid, type AppSettings,
} from "./db";
import type { TypingController } from "./typing/controller";

/**
 * Runs one session end-to-end: plan → per-block generation with a lookahead
 * buffer (adaptation appends, never mutates, §13.2) → block grading and
 * mid-session re-planning (§13.3) → whole-session analysis in the worker →
 * persistence (offline-first, §19.5).
 */

export interface BlockOutcome {
  block: PlannedBlock;
  wpmNet: number;
  accuracy: number;
  coachMessage: string | null;
  microRest: boolean;
}

export interface SessionOutcome {
  sessionId: string;
  snapshot: DiagnosisSnapshot;
  speedTestWpm: number | null;
  prevWpm: number | null;
  overall: number;
  prevOverall: number | null;
}

interface PatternWindow {
  correct: number[]; // 1/0 first-attempt outcomes
  ikis: number[];
  sessions: number[];
}

const CHUNK_CHARS = 220;

export class SessionRunner {
  settings!: AppSettings;
  plan!: SessionPlan;
  openMessage = "";
  sessionId = uuid();

  private layoutIdInternal = "qwerty-us";
  private startedAt = 0;
  private blocks: AnalyzedBlock[] = [];
  private blockRows: Array<{ block: PlannedBlock; text: string; controllerData: ReturnType<TypingController["getKeystrokes"]>; wpm: number; accuracy: number; activeMs: number }> = [];
  private results: BlockResult[] = [];
  private remaining: PlannedBlock[] = [];
  private srsItems = new Map<string, SrsItem>();
  private blockWpms: number[] = [];
  private curriculum!: CurriculumState;
  private sessionIndex = 1;
  private live: LiveAnalyzer | null = null;
  private liveTargets: string[] = [];
  private chunkCounter = 0;
  private corpusFreqs: Map<string, number> = new Map();
  private startIkiByPattern = new Map<string, number>();
  /** Test-only override: fixed active-ms budget per block (e2e). */
  blockBudgetMsOverride: number | null = null;

  get layoutId(): string {
    return this.layoutIdInternal;
  }

  async init(minutes: number, mode = "autopilot"): Promise<void> {
    this.settings = await getSettings();
    this.layoutIdInternal = this.settings.layoutId;
    const layout = getLayout(this.layoutIdInternal);

    this.curriculum =
      (await getCurriculumState()) ?? initialCurriculumState(layout, (this.settings.startWpm ?? 0) >= 50);
    const items = await loadSrsItems();
    for (const item of items) this.srsItems.set(item.pattern, item);

    const sessions = await completedSessions();
    this.sessionIndex = sessions.length + 1;
    const lastSnapshot = await kvGet<DiagnosisSnapshot>("lastSnapshot");
    const belowBar = (await kvGet<FindingCandidate[]>("belowBar")) ?? [];

    const costs = new Map<string, number>(
      lastSnapshot?.findings.flatMap((f) => f.patterns.map((p) => [p, f.estWpmCost] as const)) ?? [],
    );
    const queue = buildQueue({
      items: [...this.srsItems.values()],
      costs,
      newCandidates: [],
      now: Date.now(),
      budget: 8,
    });

    // Enter the ladder at the user's measured level (§10.1): a 70 WPM typist
    // drills real words, not pseudo-words.
    const measuredWpm =
      lastSnapshot?.sessionMetrics.wpmNet ??
      (sessions.length > 0 ? (sessions[sessions.length - 1]!.wpmNet ?? null) : null) ??
      this.settings.startWpm;

    this.plan = planSession({
      minutes,
      snapshot: lastSnapshot,
      belowBar,
      srsQueue: queue,
      stageByPattern: this.curriculum.stageByPattern as Record<string, Stage>,
      stageFloor: stageFloorForWpm(measuredWpm, this.curriculum.track === "foundations"),
      profile: this.settings.typingProfile,
      seed: (Date.now() ^ this.sessionIndex * 7919) >>> 0,
      mode: mode as never,
    });

    // An accepted "Why am I stuck?" plan overrides the primary block (§14.3).
    const activePlan = await kvGet<{
      prescription: { targets: string[]; stage: Stage; minutes: number; note: string };
      sessionsLeft: number;
    }>("activePlan");
    if (activePlan && activePlan.sessionsLeft > 0) {
      const primary = this.plan.blocks.find((b) => b.kind === "target");
      if (primary) {
        if (activePlan.prescription.targets.length > 0) {
          primary.targets = [...activePlan.prescription.targets];
        }
        // A prescription may ask for isolating drills; never go below the
        // real-words floor (§10.1 minStage).
        primary.stage = Math.max(CONFIG.content.minStage, activePlan.prescription.stage) as Stage;
        primary.label = "Plan: " + activePlan.prescription.note.split(".")[0]!.slice(0, 48);
      }
      await kvSet("activePlan", { ...activePlan, sessionsLeft: activePlan.sessionsLeft - 1 });
    }
    this.remaining = [...this.plan.blocks];
    this.startedAt = Date.now();

    this.openMessage = sessionOpenMessage({
      lastFinding: lastSnapshot?.findings[0] ?? null,
      plannedMinutes: minutes,
      sessionsCompleted: sessions.length,
    });

    const ref = generate({
      stage: 5, targets: [], length: 4000,
      profile: this.settings.typingProfile, seed: 12345, difficulty: 0.5,
    });
    this.corpusFreqs = transitionFrequencies(ref.text, layout);

    await db.sessions.put({
      id: this.sessionId,
      startedAt: this.startedAt,
      endedAt: null,
      mode,
      plannedMinutes: minutes,
      engineVersion: ENGINE_VERSION,
      scoreVersion: SCORE_VERSION,
      configHash: configHash(),
      layoutId: this.layoutIdInternal,
      wpmNet: null, wpmRaw: null, accuracy: null, consistency: null, rhythm: null,
      keystrokes: null, errors: null, corrections: null, activeMs: null,
      speedTestWpm: null, snapshot: null, synced: 0,
    });
  }

  get currentBlock(): PlannedBlock | null {
    return this.remaining[0] ?? null;
  }

  get completedCount(): number {
    return this.results.length;
  }

  get totalBlocks(): number {
    return this.results.length + this.remaining.length;
  }

  /** Initial text for the current block: two lookahead chunks (§13.2). */
  blockInitialText(): string {
    const block = this.currentBlock!;
    this.liveTargets = [...block.targets];
    this.chunkCounter = 0;
    this.live =
      block.targets.length > 0
        ? new LiveAnalyzer(block.targets.map((p) => ({ pattern: p, freq: this.corpusFreqs.get(p) ?? 0.01 })))
        : null;
    return this.generateChunk(block) + " " + this.generateChunk(block);
  }

  private generateChunk(block: PlannedBlock): string {
    this.chunkCounter++;
    const allowed =
      this.curriculum.track === "foundations"
        ? new Set([...this.curriculum.unlockedChars])
        : undefined;
    return generate({
      stage: block.stage,
      targets: block.kind === "test" || block.kind === "warmup" ? [] : this.liveTargets,
      length: CHUNK_CHARS,
      profile: block.profile,
      seed: block.seed + this.chunkCounter * 101,
      difficulty: 0.5,
      ...(allowed ? { allowedChars: allowed } : {}),
    }).text;
  }

  /**
   * Drive a running block: top up the lookahead buffer, feed the live
   * analyzer, and end the block when its time budget is spent. Called from
   * the page on a ~500 ms interval — never from the input path.
   */
  tick(controller: TypingController, lastBatchFrom: number): number {
    const block = this.currentBlock;
    if (!block || controller.isDone) return lastBatchFrom;

    // Live loop (§13.1): analyze fresh keystrokes, maybe re-rank targets.
    const count = controller.keystrokeCount;
    if (this.live && count - lastBatchFrom >= CONFIG.live.batchKeystrokes) {
      const layout = getLayout(this.layoutIdInternal);
      const fresh = controller.getKeystrokesSince(lastBatchFrom);
      const analyzed = analyzeBlock(fresh, layout, controller.targetText);
      const signal = this.live.push(analyzed.keystrokes);
      if (signal) {
        // Reorder targets so subsequent chunks emphasize the new top target.
        this.liveTargets = [signal.to, ...this.liveTargets.filter((t) => t !== signal.to)];
      }
      lastBatchFrom = count;
    }

    // Lookahead buffer (§13.2): visible text never mutates, we only append.
    if (controller.remainingChars < CONFIG.live.lookaheadChars + 50) {
      controller.appendText(" " + this.generateChunk(block));
    }

    // Time budget: end at the next word boundary.
    const budget = this.blockBudgetMsOverride ?? block.minutes * 60_000;
    if (controller.activeMs >= budget) {
      controller.requestFinish();
    }
    return lastBatchFrom;
  }

  /** Called when a block's controller reports completion. */
  async completeBlock(controller: TypingController): Promise<BlockOutcome> {
    const block = this.remaining.shift()!;
    const layout = getLayout(this.layoutIdInternal);
    const text = controller.targetText;
    const keystrokes = controller.getKeystrokes();
    const analyzed = analyzeBlock(keystrokes, layout, text);
    this.blocks.push(analyzed);

    const correctChars = analyzed.keystrokes.filter((k) => k.correct && !k.isCorrection).length;
    const attempts = new Map<number, boolean>();
    for (const k of analyzed.keystrokes) {
      if (!k.isCorrection && !attempts.has(k.index)) attempts.set(k.index, k.correct);
    }
    const accuracy =
      attempts.size > 0 ? [...attempts.values()].filter(Boolean).length / attempts.size : 1;
    const wpm = netWpm(correctChars, analyzed.activeMs);
    if (block.scored) this.blockWpms.push(wpm);

    // SRS grading of the block's targets (§9.3) + pattern windows for gates.
    let targetMet = block.targets.length === 0 ? true : false;
    const globalIkis = analyzed.keystrokes
      .filter((k) => k.iki !== null && !k.excludedFromTiming)
      .map((k) => k.iki!);
    const globalGm = globalIkis.length > 0 ? geometricMean(globalIkis) : 200;
    let anyGraded = false;
    let firstTargetDelta: number | null = null;

    if (block.kind === "target" || block.kind === "probe") {
      const windows = (await kvGet<Record<string, PatternWindow>>("patternProgress")) ?? {};
      for (const pattern of block.targets) {
        const { ikis, errors } = patternObs(analyzed, pattern);
        const item =
          this.srsItems.get(pattern) ??
          createItem(pattern, pattern.length === 1 ? "key" : "bigram", targetIkiFor(globalGm, "default"), Date.now());
        const grade = gradeFromObservations(ikis, errors, item.targetIki);
        if (grade !== null) {
          anyGraded = true;
          const updated = applyReview(item, grade, Date.now());
          this.srsItems.set(pattern, updated);
          await saveSrsItem(updated);
          if (grade !== "again") targetMet = true;
        }
        // Gate windows (§10.2).
        const w = windows[pattern] ?? { correct: [], ikis: [], sessions: [] };
        for (let i = 0; i < ikis.length; i++) w.correct.push(1);
        for (let i = 0; i < errors; i++) w.correct.push(0);
        w.ikis.push(...ikis);
        if (!w.sessions.includes(this.sessionIndex)) w.sessions.push(this.sessionIndex);
        w.correct = w.correct.slice(-40);
        w.ikis = w.ikis.slice(-40);
        windows[pattern] = w;
        // Coach evidence: IKI delta vs block start for the first target.
        if (firstTargetDelta === null && ikis.length >= 6) {
          const startGm = this.startIkiByPattern.get(pattern);
          const nowGm = geometricMean(ikis.slice(-Math.ceil(ikis.length / 2)));
          if (startGm === undefined) this.startIkiByPattern.set(pattern, geometricMean(ikis.slice(0, 3)));
          else firstTargetDelta = nowGm - startGm;
        }
      }
      await kvSet("patternProgress", windows);
      if (!anyGraded) targetMet = true; // too few observations to judge — don't punish
    }

    this.results.push({
      ordinal: block.ordinal, kind: block.kind, targets: block.targets,
      wpmNet: wpm, accuracy, targetMet,
    });
    this.remaining = replanRemaining({ remaining: this.remaining, completed: this.results });
    const fatigue = checkFatigue(this.blockWpms);

    await db.blocks.put({
      id: uuid(),
      sessionId: this.sessionId,
      ordinal: block.ordinal,
      kind: block.kind,
      stage: block.stage,
      targets: block.targets,
      visibility: block.visibility,
      seed: block.seed,
      text,
      wpmNet: wpm,
      accuracy,
      activeMs: analyzed.activeMs,
      keystrokes: packKeystrokes(keystrokes),
    });

    const nextBlock = this.remaining[0];
    const coachMessage =
      this.settings.coachMode === "full" && block.scored
        ? blockBoundaryMessage({
            blockLabel: block.label,
            targetPattern: block.targets[0] ?? null,
            ikiDeltaMs: firstTargetDelta,
            nextTarget: nextBlock?.targets[0] ?? null,
          })
        : null;

    return { block, wpmNet: wpm, accuracy, coachMessage, microRest: fatigue.microRest };
  }

  get isSessionDone(): boolean {
    return this.remaining.length === 0;
  }

  async finishSession(): Promise<SessionOutcome> {
    const layout = getLayout(this.layoutIdInternal);
    const retained = await loadRetainedObservations(this.layoutIdInternal, CONFIG.model.refitWindow);
    const handRatioHistory = (await kvGet<number[]>("handRatioHistory")) ?? [];

    const result = await runSessionAnalysis({
      blocks: this.blocks,
      layout,
      sessionId: this.sessionIndex,
      corpusFreqs: this.corpusFreqs,
      retainedObs: retained,
      handRatioHistory,
    });
    const snap = result.snapshot;

    // Speed test WPM: the only trend metric (§12.2 invariant).
    const testResult = this.results.find((r) => r.kind === "test");
    const speedTestWpm = testResult?.wpmNet ?? null;

    const prevSessions = await completedSessions();
    const prevWpm = prevSessions.length > 0 ? prevSessions[prevSessions.length - 1]!.speedTestWpm : null;
    const prevOverall = (await kvGet<number>("overall")) ?? null;
    const overall = updateComposite(prevOverall, snap.skillProfile.overall);

    // Curriculum gates (§10.2).
    const windows = (await kvGet<Record<string, PatternWindow>>("patternProgress")) ?? {};
    let curriculum = this.curriculum;
    for (const [pattern, w] of Object.entries(windows)) {
      if (w.correct.length < 20) continue;
      const decision = gateDecision({
        recentCorrect: w.correct.reduce((a, b) => a + b, 0),
        recentTotal: w.correct.length,
        gmIki: w.ikis.length > 0 ? geometricMean(w.ikis) : 0,
        globalGmIki: 12000 / Math.max(1, snap.sessionMetrics.wpmNet),
        sessionsSeen: w.sessions.length,
        residualDecile: 5,
      });
      if (decision !== "stay") {
        curriculum = applyGate(curriculum, pattern, decision);
        windows[pattern] = { correct: [], ikis: [], sessions: w.sessions };
      }
    }
    await kvSet("patternProgress", windows);
    await saveCurriculumState(curriculum);

    // Persist session + observations + rolling state.
    await db.sessions.update(this.sessionId, {
      endedAt: Date.now(),
      wpmNet: snap.sessionMetrics.wpmNet,
      wpmRaw: snap.sessionMetrics.wpmRaw,
      accuracy: snap.sessionMetrics.accuracy,
      consistency: snap.sessionMetrics.consistency,
      rhythm: snap.sessionMetrics.rhythm,
      keystrokes: snap.sessionMetrics.keystrokes,
      errors: snap.sessionMetrics.errors,
      corrections: snap.sessionMetrics.corrections,
      activeMs: snap.sessionMetrics.activeMs,
      speedTestWpm,
      snapshot: snap,
    });
    await db.observations.put(packObservations(this.sessionId, this.sessionIndex, result.observations));
    await kvSet("lastSnapshot", snap);
    await kvSet("belowBar", result.belowBar);
    await kvSet("overall", overall);

    const ratio = handIkiRatio(result.observations);
    if (ratio !== null) {
      await kvSet("handRatioHistory", [...handRatioHistory, ratio].slice(-6));
    }
    if (this.settings.startWpm === null && speedTestWpm !== null) {
      await saveSettings({ startWpm: Math.round(speedTestWpm) });
    }

    return { sessionId: this.sessionId, snapshot: snap, speedTestWpm, prevWpm, overall, prevOverall };
  }
}

function patternObs(block: AnalyzedBlock, pattern: string): { ikis: number[]; errors: number } {
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
      if (prev.expected + ks.expected === pattern) {
        if (ks.errorType !== null) errors++;
        else if (ks.iki !== null && !ks.excludedFromTiming) ikis.push(ks.iki);
      }
    }
  }
  return { ikis, errors };
}
