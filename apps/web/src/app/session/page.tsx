"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { sessionCloseMessage } from "@typing-trainer/engine";
import { Keyboard } from "@/components/keyboard";
import { SkillBars } from "@/components/skill-bars";
import { TypingSurface } from "@/components/typing-surface";
import { capture } from "@/lib/analytics";
import { completedSessions, kvSet } from "@/lib/db";
import { SessionRunner, type BlockOutcome, type SessionOutcome } from "@/lib/session-runner";
import { drainSync } from "@/lib/sync";
import type { TypingController } from "@/lib/typing/controller";

import type { PlannedBlock } from "@typing-trainer/engine";

type Phase =
  | { name: "loading" }
  | { name: "open" }
  | { name: "block"; text: string; index: number; block: PlannedBlock }
  | { name: "boundary"; outcome: BlockOutcome }
  | { name: "analyzing" }
  | { name: "report"; outcome: SessionOutcome; closeMessage: string };

export default function SessionPage() {
  return (
    <Suspense>
      <SessionFlow />
    </Suspense>
  );
}

function SessionFlow() {
  const params = useSearchParams();
  const router = useRouter();
  const minutes = Number(params.get("minutes") ?? 15);
  const mode = params.get("mode") ?? "autopilot";
  // e2e escape hatch: cap each block's active-time budget (seconds).
  const blockSec = params.get("blockSec");

  const runnerRef = useRef<SessionRunner | null>(null);
  const controllerRef = useRef<TypingController | null>(null);
  const batchFromRef = useRef(0);
  // The runner is mutable; `phase` transitions are what re-render, and we
  // mirror it into state so render never reads a ref.
  const [runner, setRunner] = useState<SessionRunner | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [nextChar, setNextChar] = useState<string | null>(null);
  const [rated, setRated] = useState(false);

  useEffect(() => {
    const r = new SessionRunner();
    if (blockSec) r.blockBudgetMsOverride = Number(blockSec) * 1000;
    runnerRef.current = r;
    let cancelled = false;
    r.init(minutes, mode).then(() => {
      if (!cancelled) {
        setRunner(r);
        setPhase({ name: "open" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [minutes, mode, blockSec]);

  const startNextBlock = useCallback(() => {
    const runner = runnerRef.current!;
    if (runner.isSessionDone) {
      setPhase({ name: "analyzing" });
      void (async () => {
        const outcome = await runner.finishSession();
        const history = await completedSessions();
        const speedPoints = history
          .filter((s) => s.speedTestWpm !== null)
          .map((s) => s.speedTestWpm!) as number[];
        const rate =
          speedPoints.length >= 4
            ? (speedPoints[speedPoints.length - 1]! - speedPoints[0]!) / (speedPoints.length - 1)
            : null;
        const goal = runner.settings.goalWpm;
        const closeMessage = sessionCloseMessage({
          snapshot: outcome.snapshot,
          prevWpm: outcome.prevWpm,
          nextMilestoneWpm: goal ?? nextSpeedMilestone(outcome.speedTestWpm),
          wpmPerSession: rate,
        });
        setPhase({ name: "report", outcome, closeMessage });
        void capture("session_completed", {
          mode,
          minutes,
          wpmNet: outcome.snapshot.sessionMetrics.wpmNet,
          speedTestWpm: outcome.speedTestWpm,
          findings: outcome.snapshot.findings.length,
        });
        void drainSync();
        // LLM narration is an optional enhancement over the template (§19.6):
        // if the route has a key and the output validates, swap the prose in.
        void fetch("/api/coach", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "session",
            snapshot: {
              sessionMetrics: outcome.snapshot.sessionMetrics,
              findings: outcome.snapshot.findings,
              speedTestWpm: outcome.speedTestWpm,
              prevWpm: outcome.prevWpm,
              goal,
            },
            templateText: closeMessage,
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data: { text: string | null } | null) => {
            if (data?.text) {
              setPhase((p) =>
                p.name === "report" ? { ...p, closeMessage: data.text! } : p,
              );
            }
          })
          .catch(() => {});
      })();
      return;
    }
    batchFromRef.current = 0;
    const text = runner.blockInitialText();
    setPhase({ name: "block", text, index: runner.completedCount, block: runner.currentBlock! });
  }, [minutes, mode]);

  // Block driver: lookahead top-up, live loop, time budget (§13).
  const blockIndex = phase.name === "block" ? phase.index : -1;
  useEffect(() => {
    if (blockIndex < 0) return;
    const interval = setInterval(() => {
      const r = runnerRef.current;
      const controller = controllerRef.current;
      if (r && controller && !controller.isDone) {
        batchFromRef.current = r.tick(controller, batchFromRef.current);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [blockIndex]);

  const handleComplete = useCallback((controller: TypingController) => {
    void (async () => {
      const outcome = await runnerRef.current!.completeBlock(controller);
      setPhase({ name: "boundary", outcome });
    })();
  }, []);

  if (phase.name === "loading" || !runner) {
    return <Shell><p className="text-muted">Preparing your session…</p></Shell>;
  }

  if (phase.name === "open") {
    return (
      <Shell>
        <div className="rounded-lg border border-border bg-surface p-8" data-testid="session-open">
          <p className="whitespace-pre-line text-foreground">{runner.openMessage}</p>
          <ol className="mt-6 space-y-1 text-sm text-muted">
            {runner.plan.blocks.map((b) => (
              <li key={b.ordinal} className="flex justify-between gap-8">
                <span>{b.label}</span>
                <span className="font-mono">{b.minutes} min</span>
              </li>
            ))}
          </ol>
          <button type="button" className="btn-primary mt-8" onClick={startNextBlock} autoFocus>
            Start
          </button>
        </div>
      </Shell>
    );
  }

  if (phase.name === "block") {
    const block = phase.block;
    return (
      <Shell>
        <div className="mb-4 flex items-baseline justify-between text-sm text-muted">
          <span>
            {block.label} · block {phase.index + 1} of {runner.totalBlocks}
          </span>
          <span>{block.minutes} min</span>
        </div>
        <TypingSurface
          key={phase.index}
          targetText={phase.text}
          policy={block.policy}
          visibility={block.visibility}
          onController={(c) => {
            controllerRef.current = c;
          }}
          onComplete={handleComplete}
          onProgress={(typed) => {
            const t = controllerRef.current?.targetText ?? "";
            setNextChar(t[typed] ?? null);
          }}
        />
        <Keyboard layoutId={runner.layoutId} visibility={block.visibility} nextChar={nextChar} />
      </Shell>
    );
  }

  if (phase.name === "boundary") {
    const { outcome } = phase;
    return (
      <Shell>
        <div className="rounded-lg border border-border bg-surface p-8" data-testid="block-boundary">
          <div className="flex gap-8 font-mono text-sm">
            <span>{outcome.wpmNet.toFixed(1)} wpm</span>
            <span>{(outcome.accuracy * 100).toFixed(1)}% accuracy</span>
          </div>
          {outcome.coachMessage && (
            <p className="mt-4 whitespace-pre-line text-sm text-foreground">{outcome.coachMessage}</p>
          )}
          {outcome.microRest && <MicroRest />}
          <ArmedButton onClick={startNextBlock}>
            {runner.isSessionDone ? "Finish session" : "Continue"}
          </ArmedButton>
        </div>
      </Shell>
    );
  }

  if (phase.name === "analyzing") {
    return <Shell><p className="text-muted">Analyzing your session…</p></Shell>;
  }

  // report
  const { outcome, closeMessage } = phase;
  const snap = outcome.snapshot;
  return (
    <Shell wide>
      <section className="rounded-lg border border-border bg-surface p-8" data-testid="session-report">
        <h1 className="text-sm font-medium uppercase tracking-widest text-muted">Today&apos;s diagnosis</h1>
        <p className="mt-4 whitespace-pre-line">{closeMessage}</p>

        <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3 font-mono text-sm sm:grid-cols-4">
          <Stat label="speed test" value={outcome.speedTestWpm !== null ? `${outcome.speedTestWpm.toFixed(1)} wpm` : "—"} />
          <Stat label="session net" value={`${snap.sessionMetrics.wpmNet.toFixed(1)} wpm`} />
          <Stat label="accuracy" value={`${(snap.sessionMetrics.accuracy * 100).toFixed(1)}%`} />
          <Stat label="skill score" value={`${Math.round(outcome.overall)} / 100`} />
        </div>

        {snap.findings.length > 0 && (
          <div className="mt-6 border-t border-border pt-5">
            <h2 className="text-xs uppercase tracking-widest text-muted">Top findings</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {snap.findings.slice(0, 3).map((f) => (
                <li key={f.cause} className="flex items-baseline justify-between gap-6">
                  <span>{f.evidence}</span>
                  <span className="whitespace-nowrap font-mono text-err">−{f.estWpmCost.toFixed(1)} wpm</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {snap.habits.length > 0 && (
          <div className="mt-6 rounded-md border border-warn/40 bg-warn/5 p-4 text-sm">
            <p className="text-warn">Possible habit detected</p>
            <p className="mt-1">{snap.habits[0]!.evidence}</p>
          </div>
        )}

        <div className="mt-6 border-t border-border pt-5">
          <SkillBars profile={snap.skillProfile} />
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
          {!rated ? (
            <div className="flex items-center gap-3 text-sm text-muted">
              Was this diagnosis useful?
              <button type="button" className="btn-ghost" onClick={() => rateDiagnosis(outcome, 1, setRated)}>Yes</button>
              <button type="button" className="btn-ghost" onClick={() => rateDiagnosis(outcome, -1, setRated)}>No</button>
            </div>
          ) : (
            <span className="text-sm text-muted">Noted.</span>
          )}
          <button type="button" className="btn-primary" onClick={() => router.push("/")}>Done</button>
        </div>
      </section>
    </Shell>
  );
}

function rateDiagnosis(outcome: SessionOutcome, rating: 1 | -1, setRated: (b: boolean) => void) {
  void kvSet(`diagnosisRating:${outcome.sessionId}`, rating);
  void capture("diagnosis_rated", { rating }); // §4.3 diagnosis usefulness
  setRated(true);
}

function nextSpeedMilestone(wpm: number | null): number | null {
  if (wpm === null) return null;
  for (const m of [40, 60, 80, 100, 120, 140]) if (wpm < m) return m;
  return null;
}

/**
 * Autofocused for keyboard-first flow, but disabled briefly so keystrokes
 * still in flight when a block ends can't accidentally dismiss the boundary.
 */
function ArmedButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 700);
    return () => clearTimeout(t);
  }, []);
  return (
    <button type="button" className="btn-primary mt-6" onClick={onClick} disabled={!armed} autoFocus>
      {children}
    </button>
  );
}

function MicroRest() {
  const [left, setLeft] = useState(30);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return (
    <p className="mt-4 text-sm text-warn">
      Your speed is dipping — {left > 0 ? `take ${left}s` : "good"} to breathe and shake out your hands.
    </p>
  );
}

function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main className={`mx-auto flex min-h-screen ${wide ? "max-w-4xl" : "max-w-3xl"} flex-col justify-center gap-6 px-6 py-12`}>
      <header className="flex items-baseline justify-between">
        <Link href="/" className="text-sm text-muted hover:text-foreground">← typing trainer</Link>
      </header>
      {children}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-base text-foreground">{value}</div>
    </div>
  );
}
