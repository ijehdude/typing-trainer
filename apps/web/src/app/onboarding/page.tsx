"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getLayout, LAYOUTS, POPULATION_PRIOR } from "@typing-trainer/content";
import {
  analyzeBlock, buildCalibrationText, firstDiagnosisMessage, generate, netWpm,
  transitionFrequencies, type AnalyzedBlock, type DiagnosisSnapshot, type SessionAnalysisResult,
} from "@typing-trainer/engine";
import { TypingSurface } from "@/components/typing-surface";
import { runSessionAnalysis } from "@/lib/analysis-client";
import {
  db, kvSet, packObservations, saveSettings, uuid, type AppSettings,
} from "@/lib/db";
import type { TypingController } from "@/lib/typing/controller";

/**
 * Onboarding (PRD §18.2): profile + layout → 90 s calibration in three parts
 * → the first diagnosis (the aha moment) → straight into the first session.
 * No account, ever, in this flow.
 */

type Step =
  | { name: "welcome" }
  | { name: "calibrate"; part: 0 | 1 | 2 }
  | { name: "analyzing" }
  | { name: "diagnosis"; message: string; snapshot: DiagnosisSnapshot };

const PART_LABELS = ["Ordinary prose", "Letter coverage — this part reads oddly, that's deliberate", "Punctuation, capitals, digits"];

/** Deterministic (seeded); safe to build once at module scope. */
const CALIBRATION = buildCalibrationText(getLayout("qwerty-us"), 20260826);

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: "welcome" });
  const [profile, setProfile] = useState<AppSettings["typingProfile"]>("writer");
  const [layoutId, setLayoutId] = useState("qwerty-us");
  const [detected, setDetected] = useState(false);
  const blocksRef = useRef<AnalyzedBlock[]>([]);

  // Layout auto-detection (§6.5): navigator.keyboard where available.
  useEffect(() => {
    const nav = navigator as Navigator & {
      keyboard?: { getLayoutMap(): Promise<Map<string, string>> };
    };
    nav.keyboard?.getLayoutMap().then((map) => {
      const q = map.get("KeyQ");
      const s = map.get("Semicolon");
      let id = "qwerty-us";
      if (q === "'") id = "dvorak";
      else if (map.get("KeyE") === "f") id = "colemak";
      else if (map.get("KeyT") === "g" && map.get("KeyG") === "m") id = "colemak-dh";
      else if (q === "q" && s === ";") id = "qwerty-us"; // UK differs only on symbol keys we can't probe here
      setLayoutId(id);
      setDetected(true);
    }).catch(() => {});
  }, []);

  const handlePartComplete = useCallback(
    (part: 0 | 1 | 2) => async (controller: TypingController) => {
      const text = CALIBRATION.parts[part]!;
      blocksRef.current.push(analyzeBlock(controller.getKeystrokes(), getLayout(layoutId), text));
      if (part < 2) {
        setStep({ name: "calibrate", part: (part + 1) as 1 | 2 });
        return;
      }
      setStep({ name: "analyzing" });
      const layout = getLayout(layoutId);
      const ref = generate({ stage: 5, targets: [], length: 4000, profile, seed: 12345, difficulty: 0.5 });
      const result: SessionAnalysisResult = await runSessionAnalysis({
        blocks: blocksRef.current,
        layout,
        sessionId: 1,
        corpusFreqs: transitionFrequencies(ref.text, layout),
        prior: POPULATION_PRIOR,
      });
      const snap = result.snapshot;

      // Early estimate framing (§7.7 honesty + §18.2 aha): one session can't
      // clear the medium bar, so we show the strongest below-bar candidate
      // hedged, plus measured slow transitions.
      const slowTransitions = snap.bottlenecks.patterns.slice(0, 3).map((p) => p.pattern);
      const topCandidate = result.belowBar[0] ?? null;
      const message = firstDiagnosisMessage({
        wpm: snap.sessionMetrics.wpmNet,
        accuracy: snap.sessionMetrics.accuracy,
        slowTransitions,
        estTopCostWpm: topCandidate ? topCandidate.estWpmCost : null,
        topCostLabel: topCandidate ? topCandidate.label : null,
      });

      // Persist calibration as session 1 (offline-first, no account).
      const sessionId = uuid();
      const totalActive = blocksRef.current.reduce((s, b) => s + b.activeMs, 0);
      const correct = blocksRef.current.flatMap((b) => b.keystrokes).filter((k) => k.correct && !k.isCorrection).length;
      await db.sessions.put({
        id: sessionId, startedAt: Date.now() - totalActive, endedAt: Date.now(),
        mode: "calibration", plannedMinutes: 2,
        engineVersion: "0.1.0", scoreVersion: 1, configHash: "", layoutId,
        wpmNet: snap.sessionMetrics.wpmNet, wpmRaw: snap.sessionMetrics.wpmRaw,
        accuracy: snap.sessionMetrics.accuracy, consistency: snap.sessionMetrics.consistency,
        rhythm: snap.sessionMetrics.rhythm, keystrokes: snap.sessionMetrics.keystrokes,
        errors: snap.sessionMetrics.errors, corrections: snap.sessionMetrics.corrections,
        activeMs: totalActive,
        speedTestWpm: netWpm(correct, totalActive),
        snapshot: snap, synced: 0,
      });
      await db.observations.put(packObservations(sessionId, 1, result.observations));
      await kvSet("lastSnapshot", snap);
      await kvSet("belowBar", result.belowBar);
      await saveSettings({
        layoutId, typingProfile: profile, onboarded: true,
        startWpm: Math.round(snap.sessionMetrics.wpmNet),
        goalWpm: Math.round(snap.sessionMetrics.wpmNet + 20),
      });
      setStep({ name: "diagnosis", message, snapshot: snap });
    },
    [layoutId, profile],
  );

  if (step.name === "welcome") {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold">Let&apos;s measure how you actually type.</h1>
        <p className="mt-2 max-w-lg text-muted">
          A 90-second calibration, then a diagnosis. No account needed — nothing leaves your browser.
        </p>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted">What do you mostly type?</span>
            <select
              className="mt-1 w-full rounded-md border border-border bg-surface p-2"
              value={profile}
              onChange={(e) => setProfile(e.target.value as AppSettings["typingProfile"])}
            >
              <option value="developer">Code (developer)</option>
              <option value="writer">Prose (writer)</option>
              <option value="student">Coursework (student)</option>
              <option value="office">Email and documents (office)</option>
              <option value="data_entry">Data entry</option>
              <option value="gamer">Chat (gamer)</option>
              <option value="competitive">Competitive typing</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted">Keyboard layout {detected ? "(auto-detected)" : ""}</span>
            <select
              className="mt-1 w-full rounded-md border border-border bg-surface p-2"
              value={layoutId}
              onChange={(e) => setLayoutId(e.target.value)}
            >
              {Object.values(LAYOUTS).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className="btn-primary mt-8" onClick={() => setStep({ name: "calibrate", part: 0 })}>
          Start the calibration
        </button>
      </Shell>
    );
  }

  if (step.name === "calibrate") {
    const part = step.part;
    return (
      <Shell>
        <div className="mb-4 flex items-baseline justify-between text-sm text-muted">
          <span>Calibration · part {part + 1} of 3</span>
          <span>{PART_LABELS[part]}</span>
        </div>
        <TypingSurface
          key={part}
          targetText={CALIBRATION.parts[part]!}
          onComplete={handlePartComplete(part)}
        />
      </Shell>
    );
  }

  if (step.name === "analyzing") {
    return <Shell><p className="text-muted">Building your first diagnosis…</p></Shell>;
  }

  return (
    <Shell>
      <section className="rounded-lg border border-border bg-surface p-8" data-testid="first-diagnosis">
        <h1 className="text-sm font-medium uppercase tracking-widest text-muted">First diagnosis</h1>
        <p className="mt-4 whitespace-pre-line text-lg leading-relaxed">{step.message}</p>
        <button
          type="button"
          className="btn-primary mt-8"
          onClick={() => router.push("/session?minutes=15")}
          autoFocus
        >
          Start the session
        </button>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
      {children}
    </main>
  );
}
