"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { whyAmIStuck, type DiagnosisSnapshot, type StuckReport } from "@typing-trainer/engine";
import { completedSessions, kvGet, kvSet } from "@/lib/db";

/** "Why am I stuck?" (PRD §14.3) — a diagnosis you can act on with one click. */
export default function StuckPage() {
  const router = useRouter();
  const [report, setReport] = useState<StuckReport | null | "empty">(null);

  useEffect(() => {
    void (async () => {
      const snapshot = await kvGet<DiagnosisSnapshot>("lastSnapshot");
      const sessions = await completedSessions();
      if (!snapshot || sessions.length === 0) {
        setReport("empty");
        return;
      }
      const history = sessions
        .filter((s) => s.speedTestWpm !== null)
        .map((s) => ({ endedAt: s.endedAt ?? s.startedAt, wpm: s.speedTestWpm! }));
      const weekAgo = Date.now() - 7 * 86_400_000;
      setReport(
        whyAmIStuck({
          snapshot,
          history,
          sessionsLast7Days: sessions.filter((s) => s.startedAt > weekAgo).length,
        }),
      );
    })();
  }, []);

  if (report === null) return <Shell><p className="text-muted">…</p></Shell>;
  if (report === "empty") {
    return (
      <Shell>
        <p className="text-muted">
          There&apos;s nothing to diagnose yet — complete a session first.{" "}
          <Link href="/" className="text-accent">Go back.</Link>
        </p>
      </Shell>
    );
  }

  const top = report.causes[0];

  return (
    <Shell>
      <section className="rounded-lg border border-border bg-surface p-8" data-testid="stuck-report">
        <h1 className="text-sm font-medium uppercase tracking-widest text-muted">
          Why you&apos;re at {Math.round(report.currentWpm)} WPM
        </h1>

        {!report.plateau.plateaued && report.plateau.n >= 5 && (
          <p className="mt-3 text-sm text-ok">
            For what it&apos;s worth: you&apos;re not actually plateaued — you&apos;re gaining about{" "}
            {report.plateau.slopePerSession.toFixed(1)} WPM per session.
          </p>
        )}

        {top ? (
          <>
            <p className="mt-4 text-lg">{top.headline}</p>
            <p className="mt-2 text-sm text-muted">{top.detail}</p>
            <p className="mt-3 font-mono text-sm text-err">
              Estimated cost: −{top.estWpmCost.toFixed(1)} WPM
            </p>

            {report.causes.length > 1 && (
              <div className="mt-6 border-t border-border pt-4">
                <h2 className="text-xs uppercase tracking-widest text-muted">Also in play</h2>
                <ul className="mt-2 space-y-2 text-sm">
                  {report.causes.slice(1, 4).map((c) => (
                    <li key={c.id} className="flex items-baseline justify-between gap-6">
                      <span>{c.headline}</span>
                      <span className="whitespace-nowrap font-mono text-muted">−{c.estWpmCost.toFixed(1)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-6 border-t border-border pt-5">
              <h2 className="text-xs uppercase tracking-widest text-muted">What to do</h2>
              <p className="mt-2 text-sm">{top.prescription.note}</p>
              <p className="mt-1 text-sm text-muted">
                {top.prescription.minutes} minutes inside each of your next {top.prescription.sessions} sessions.
              </p>
              <button
                type="button"
                className="btn-primary mt-5"
                data-testid="start-plan"
                onClick={() => {
                  void kvSet("activePlan", {
                    prescription: top.prescription,
                    sessionsLeft: top.prescription.sessions,
                    startedAt: Date.now(),
                  }).then(() => router.push("/session?minutes=15"));
                }}
              >
                Start this plan
              </button>
            </div>
          </>
        ) : (
          <p className="mt-4 text-sm text-muted">
            Nothing stands out from the data yet. Two or three more sessions will sharpen the picture.
          </p>
        )}
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-12">
      <header>
        <Link href="/" className="text-sm text-muted hover:text-foreground">← typing trainer</Link>
      </header>
      {children}
    </main>
  );
}
