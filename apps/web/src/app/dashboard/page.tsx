"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLayout } from "@typing-trainer/content";
import { geometricMean, type DiagnosisSnapshot, type Observation } from "@typing-trainer/engine";
import { SkillBars } from "@/components/skill-bars";
import {
  completedSessions, getSettings, kvGet, loadRetainedObservations, type SessionRow,
} from "@/lib/db";

/** The Typing Health dashboard (PRD §18.4). */
export default function DashboardPage() {
  const [data, setData] = useState<{
    sessions: SessionRow[];
    snapshot: DiagnosisSnapshot | null;
    layoutId: string;
    observations: Observation[];
    loadedAt: number;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      const settings = await getSettings();
      const [sessions, snapshot, observations] = await Promise.all([
        completedSessions(),
        kvGet<DiagnosisSnapshot>("lastSnapshot"),
        loadRetainedObservations(settings.layoutId, 20000),
      ]);
      setData({ sessions, snapshot, layoutId: settings.layoutId, observations, loadedAt: Date.now() });
    })();
  }, []);

  if (!data) return <Shell><p className="text-muted">…</p></Shell>;
  const { sessions, snapshot } = data;
  if (sessions.length === 0 || !snapshot) {
    return (
      <Shell>
        <p className="text-muted">No sessions yet. <Link className="text-accent" href="/">Start one.</Link></p>
      </Shell>
    );
  }

  const withTests = sessions.filter((s) => s.speedTestWpm !== null);
  const current = withTests[withTests.length - 1]?.speedTestWpm ?? snapshot.sessionMetrics.wpmNet;
  const last30 = withTests.filter((s) => s.startedAt > data.loadedAt - 30 * 86_400_000);
  const avg30 = last30.length > 0 ? last30.reduce((a, s) => a + s.speedTestWpm!, 0) / last30.length : current;
  const best = withTests.reduce((m, s) => Math.max(m, s.speedTestWpm!), 0);
  const totalChars = sessions.reduce((a, s) => a + (s.keystrokes ?? 0), 0);

  return (
    <Shell>
      <section className="grid gap-6 sm:grid-cols-2">
        <Card title="Typing performance">
          <dl className="space-y-1.5 font-mono text-sm">
            <Row k="Current speed" v={`${Math.round(current)} WPM`} />
            <Row k="30-day average" v={`${Math.round(avg30)} WPM`} />
            <Row k="Best" v={`${Math.round(best)} WPM`} />
            <Row k="Accuracy" v={`${(snapshot.sessionMetrics.accuracy * 100).toFixed(1)}%`} />
            <Row k="Consistency" v={`${Math.round(snapshot.sessionMetrics.consistency)}%`} />
            <Row k="Characters typed" v={totalChars.toLocaleString()} />
          </dl>
        </Card>

        <Card title="Top bottlenecks">
          {snapshot.findings.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing confirmed yet — findings appear once a pattern has two sessions of evidence.
            </p>
          ) : (
            <ul className="space-y-2 text-sm" data-testid="bottlenecks">
              {snapshot.findings.slice(0, 4).map((f) => (
                <li key={f.cause} className="flex items-center gap-3">
                  <span className="w-32 shrink-0">{f.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-surface-2">
                    <div
                      className="h-full rounded bg-err"
                      style={{ width: `${Math.min(100, f.estWpmCost * 12)}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right font-mono text-err">
                    −{f.estWpmCost.toFixed(1)} WPM
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {snapshot.tradeoff.vControl > 0 && (
        <Card title="Speed–accuracy tradeoff">
          <p className="text-sm">
            You can hold <span className="font-mono">{Math.round(snapshot.tradeoff.vControl)} WPM</span> at
            97% accuracy; above <span className="font-mono">{Math.round(snapshot.tradeoff.vCollapse)} WPM</span> your
            typing degrades faster than it gains.{" "}
            {current > snapshot.tradeoff.vControl
              ? "You are currently typing above your control speed — that's the overdriving zone."
              : "You have headroom before accuracy becomes the limit."}
          </p>
        </Card>
      )}

      <Card title="Keyboard heatmap">
        <Heatmap layoutId={data.layoutId} observations={data.observations} />
      </Card>

      <Card title="Skill profile">
        <SkillBars profile={snapshot.skillProfile} />
      </Card>

      <Card title="Sessions">
        <table className="w-full text-left font-mono text-xs">
          <thead className="text-muted">
            <tr><th className="py-1 font-normal">date</th><th className="font-normal">mode</th><th className="font-normal">test wpm</th><th className="font-normal">accuracy</th></tr>
          </thead>
          <tbody>
            {sessions.slice(-12).reverse().map((s) => (
              <tr key={s.id} className="border-t border-border">
                <td className="py-1.5">{new Date(s.startedAt).toLocaleDateString()}</td>
                <td>{s.mode}</td>
                <td>{s.speedTestWpm !== null ? s.speedTestWpm.toFixed(1) : "—"}</td>
                <td>{s.accuracy !== null ? `${(s.accuracy * 100).toFixed(1)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="text-center">
        <Link href="/stuck" className="btn-primary inline-block">Why am I stuck?</Link>
      </div>
    </Shell>
  );
}

/** Per-key speed heatmap: green = fast for you, red = slow for you. */
function Heatmap({ layoutId, observations }: { layoutId: string; observations: Observation[] }) {
  const layout = getLayout(layoutId);
  const byChar = new Map<string, number[]>();
  for (const o of observations) {
    if (!/^[a-z;,./']$/.test(o.char)) continue;
    let arr = byChar.get(o.char);
    if (!arr) byChar.set(o.char, (arr = []));
    arr.push(Math.exp(o.logIki));
  }
  const gms = new Map<string, number>();
  for (const [ch, ikis] of byChar) {
    if (ikis.length >= 10) gms.set(ch, geometricMean(ikis));
  }
  if (gms.size < 8) {
    return <p className="text-sm text-muted">Not yet measured — a few more sessions will fill this in.</p>;
  }
  const values = [...gms.values()].sort((a, b) => a - b);
  const lo = values[Math.floor(values.length * 0.1)]!;
  const hi = values[Math.floor(values.length * 0.9)]!;

  const rows: Array<Array<{ char: string; gm: number | null }>> = [1, 2, 3].map((row) =>
    Object.values(layout.keys)
      .filter((k) => k.row === row && /^[a-z;,./']$/.test(k.char))
      .sort((a, b) => a.col - b.col)
      .map((k) => ({ char: k.char, gm: gms.get(k.char) ?? null })),
  );

  return (
    <div className="w-fit" data-testid="heatmap">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1 pb-1" style={{ paddingLeft: i * 12 }}>
          {row.map((k) => {
            const t = k.gm === null ? null : Math.max(0, Math.min(1, (k.gm - lo) / Math.max(1, hi - lo)));
            const bg =
              t === null ? "var(--surface-2)" : `color-mix(in oklab, var(--ok) ${Math.round((1 - t) * 70)}%, var(--err) ${Math.round(t * 70)}%)`;
            return (
              <div
                key={k.char}
                title={k.gm !== null ? `${k.char}: ${Math.round(k.gm)} ms` : k.char}
                className="flex h-9 w-9 items-center justify-center rounded border border-border font-mono text-xs"
                style={{ background: bg, color: "var(--background)" }}
              >
                <span style={{ color: t === null ? "var(--muted)" : "var(--background)" }}>{k.char}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
      <header className="flex items-baseline justify-between">
        <Link href="/" className="text-sm text-muted hover:text-foreground">← typing trainer</Link>
        <h1 className="text-sm uppercase tracking-widest text-muted">Typing health</h1>
      </header>
      {children}
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
