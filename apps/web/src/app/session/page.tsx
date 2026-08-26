"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { qwertyUs } from "@typing-trainer/content";
import {
  analyzeBlock,
  backspaceRate,
  consistencyScore,
  firstAttemptAccuracy,
  netWpm,
  perSecondWpm,
  rawWpm,
} from "@typing-trainer/engine";
import { TypingSurface } from "@/components/typing-surface";
import type { TypingController } from "@/lib/typing/controller";

/** Placeholder passages until the content engine lands (M4). */
const PASSAGES = [
  "The window was open and the evening air moved through the room, carrying the sound of traffic and the smell of rain on warm pavement. She set the letter down and read it again from the beginning.",
  "Good tools disappear. When the interface stops demanding attention, the work itself comes forward, and an hour can pass without a single conscious thought about the machine.",
  "He checked the numbers twice, then a third time, because the result was too clean to trust. Real data has rough edges; when the edges vanish, someone has usually sanded them off.",
  "In the morning the harbour was flat and grey, and the boats sat on their reflections like models in a shop window. By noon the wind had returned and everything was in motion again.",
];

interface Results {
  wpmNet: number;
  wpmRaw: number;
  accuracy: number;
  consistency: number;
  backspaces: number;
  keystrokes: number;
  activeMs: number;
  timingSuspect: boolean;
}

export default function SessionPage() {
  const [run, setRun] = useState(0);
  const [results, setResults] = useState<Results | null>(null);
  const text = useMemo(() => PASSAGES[run % PASSAGES.length]!, [run]);

  const handleComplete = useCallback(
    (controller: TypingController) => {
      const block = analyzeBlock(controller.getKeystrokes(), qwertyUs, text);
      const correctChars = block.keystrokes.filter((k) => k.correct && !k.isCorrection).length;
      const allChars = block.keystrokes.filter((k) => !k.isCorrection).length;
      setResults({
        wpmNet: netWpm(correctChars, block.activeMs),
        wpmRaw: rawWpm(allChars, block.activeMs),
        accuracy: firstAttemptAccuracy(block.keystrokes),
        consistency: consistencyScore(perSecondWpm(block)),
        backspaces: backspaceRate(block.keystrokes),
        keystrokes: block.keystrokes.length,
        activeMs: block.activeMs,
        timingSuspect: block.timingSuspect,
      });
    },
    [text],
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header className="flex items-baseline justify-between">
        <Link href="/" className="text-sm text-muted hover:text-foreground">
          ← typing trainer
        </Link>
        <span className="text-sm text-muted">free mode · qwerty-us</span>
      </header>

      {results === null ? (
        <TypingSurface key={run} targetText={text} onComplete={handleComplete} />
      ) : (
        <section
          className="rounded-lg border border-border bg-surface p-8"
          data-testid="results"
          aria-label="Session results"
        >
          <h1 className="mb-6 text-sm font-medium uppercase tracking-widest text-muted">
            Block complete
          </h1>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 font-mono text-sm sm:grid-cols-3">
            <Stat label="net speed" value={`${results.wpmNet.toFixed(1)} wpm`} big />
            <Stat label="raw speed" value={`${results.wpmRaw.toFixed(1)} wpm`} />
            <Stat label="accuracy" value={`${(results.accuracy * 100).toFixed(1)}%`} />
            <Stat label="consistency" value={`${results.consistency.toFixed(0)}%`} />
            <Stat label="backspaces / 100" value={results.backspaces.toFixed(1)} />
            <Stat label="active time" value={`${(results.activeMs / 1000).toFixed(1)} s`} />
          </div>
          {results.timingSuspect && (
            <p className="mt-4 text-xs text-warn">
              Timing on this block looked unreliable, so it will not be trusted for trends.
            </p>
          )}
          <button
            type="button"
            className="mt-8 rounded-md bg-accent px-5 py-2 text-sm font-medium text-background hover:opacity-90"
            onClick={() => {
              setResults(null);
              setRun((r) => r + 1);
            }}
          >
            Go again
          </button>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={big ? "text-2xl text-foreground" : "text-base text-foreground"}>{value}</div>
    </div>
  );
}
