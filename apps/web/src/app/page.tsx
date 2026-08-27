"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  buildQueue, planSession, type DiagnosisSnapshot, type FindingCandidate,
  type SessionPlan, type Stage,
} from "@typing-trainer/engine";
import {
  completedSessions, getCurriculumState, getSettings, kvGet, loadSrsItems,
  type AppSettings,
} from "@/lib/db";
import { formatDuration } from "@/lib/format";
import { ensureSyncListeners } from "@/lib/sync";

/** The home screen (PRD §18.3): the decision is made for you. */
export default function Home() {
  const [state, setState] = useState<{
    settings: AppSettings;
    plan: SessionPlan | null;
    lastWpm: number | null;
    sessions: number;
  } | null>(null);
  const [mode, setMode] = useState("autopilot");
  const [showModes, setShowModes] = useState(false);

  useEffect(() => {
    ensureSyncListeners();
    void (async () => {
      const settings = await getSettings();
      if (!settings.onboarded) {
        setState({ settings, plan: null, lastWpm: null, sessions: 0 });
        return;
      }
      const [snapshot, belowBar, items, curriculum, sessions] = await Promise.all([
        kvGet<DiagnosisSnapshot>("lastSnapshot"),
        kvGet<FindingCandidate[]>("belowBar"),
        loadSrsItems(),
        getCurriculumState(),
        completedSessions(),
      ]);
      const queue = buildQueue({
        items, costs: new Map(), newCandidates: [], now: Date.now(), budget: 8,
      });
      const plan = planSession({
        snapshot,
        belowBar: belowBar ?? [],
        srsQueue: queue,
        stageByPattern: (curriculum?.stageByPattern ?? {}) as Record<string, Stage>,
        profile: settings.typingProfile,
        seed: new Date().getDate() * 977, // stable preview for the day
      });
      const withTests = sessions.filter((s) => s.speedTestWpm !== null);
      setState({
        settings,
        plan,
        lastWpm: withTests.length > 0 ? withTests[withTests.length - 1]!.speedTestWpm : null,
        sessions: sessions.length,
      });
    })();
  }, []);

  if (!state) {
    return <main className="flex min-h-screen items-center justify-center text-muted">…</main>;
  }

  if (!state.settings.onboarded) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Typing Trainer</h1>
        <p className="max-w-md text-muted">
          Not another typing test. Measure where your time actually goes, get a
          diagnosis in WPM, and train exactly what holds you back.
        </p>
        <Link href="/onboarding" className="btn-primary">Start typing</Link>
        <p className="text-xs text-muted">No account needed. Nothing leaves your browser.</p>
      </main>
    );
  }

  const { settings, plan, lastWpm } = state;
  const greeting = timeGreeting();
  const start = settings.startWpm ?? 40;
  const goal = settings.goalWpm ?? start + 20;
  const current = lastWpm ?? start;
  const progress = Math.max(0, Math.min(1, (current - start) / Math.max(1, goal - start)));

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-12">
      <header>
        <h1 className="text-lg text-muted">{greeting}.</h1>
        {lastWpm !== null && goal > current && (
          <p className="mt-1 text-2xl font-medium">
            You&apos;re {Math.max(1, Math.round(goal - current))} WPM away from your goal.
          </p>
        )}
      </header>

      <div data-testid="journey-bar">
        <div className="flex justify-between font-mono text-sm text-muted">
          <span>{start} WPM</span>
          <span className="text-foreground">{Math.round(current)}</span>
          <span>{goal} WPM</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded bg-surface-2">
          <div className="h-full rounded bg-accent" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      <section className="rounded-lg border border-border bg-surface p-6" data-testid="todays-workout">
        <h2 className="text-xs font-medium uppercase tracking-widest text-muted">Today&apos;s workout</h2>
        <ol className="mt-4 space-y-1.5 text-sm">
          {plan?.blocks.map((b) => (
            <li key={b.ordinal} className="flex justify-between gap-8">
              <span>{b.label}</span>
              <span className="font-mono text-muted">{formatDuration(b.minutes)}</span>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
          <span className="font-mono text-xs text-muted">
            TOTAL {plan?.minutes ?? 2} min
          </span>
          <Link href={`/session?mode=${mode}`} className="btn-primary" data-testid="start-session">
            Start
          </Link>
        </div>
      </section>

      <div className="text-center">
        <button type="button" className="text-sm text-muted hover:text-foreground" onClick={() => setShowModes((s) => !s)}>
          Choose a different mode →
        </button>
        {showModes && (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {[
              ["autopilot", "Autopilot"], ["fix_weaknesses", "Fix weaknesses"], ["speed", "Speed"],
              ["precision", "Precision"], ["muscle_memory", "Muscle memory"], ["real_world", "Real world"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id!)}
                className={`rounded-md border px-3 py-1 text-sm ${mode === id ? "border-accent text-accent" : "border-border text-muted hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <nav className="flex justify-center gap-6 text-sm text-muted">
        <Link href="/dashboard" className="hover:text-foreground">Dashboard</Link>
        <Link href="/stuck" className="hover:text-foreground">Why am I stuck?</Link>
        <Link href="/settings" className="hover:text-foreground">Settings</Link>
      </nav>
    </main>
  );
}

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
