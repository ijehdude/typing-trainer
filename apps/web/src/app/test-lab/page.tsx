"use client";

import { useCallback, useState } from "react";
import { qwertyUs } from "@typing-trainer/content";
import {
  analyzeBlock, backspaceRate, consistencyScore, firstAttemptAccuracy,
  netWpm, perSecondWpm, rawWpm,
} from "@typing-trainer/engine";
import { TypingSurface } from "@/components/typing-surface";
import type { TypingController } from "@/lib/typing/controller";

/**
 * A bare, dependency-free typing test surface. Exists for the Appendix B
 * timing-fidelity harness (stable markup, no session machinery) and as a
 * quick manual smoke test.
 */

const TEXT =
  "The window was open and the evening air moved through the room, carrying the sound of traffic and the smell of rain on warm pavement. She set the letter down and read it again from the beginning.";

interface Results {
  wpmNet: number;
  wpmRaw: number;
  accuracy: number;
  consistency: number;
  backspaces: number;
}

export default function TestLabPage() {
  const [results, setResults] = useState<Results | null>(null);
  const [run, setRun] = useState(0);

  const handleComplete = useCallback((controller: TypingController) => {
    const block = analyzeBlock(controller.getKeystrokes(), qwertyUs, controller.targetText);
    const correctChars = block.keystrokes.filter((k) => k.correct && !k.isCorrection).length;
    const allChars = block.keystrokes.filter((k) => !k.isCorrection).length;
    setResults({
      wpmNet: netWpm(correctChars, block.activeMs),
      wpmRaw: rawWpm(allChars, block.activeMs),
      accuracy: firstAttemptAccuracy(block.keystrokes),
      consistency: consistencyScore(perSecondWpm(block)),
      backspaces: backspaceRate(block.keystrokes),
    });
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-12">
      <h1 className="text-sm uppercase tracking-widest text-muted">test lab</h1>
      {results === null ? (
        <TypingSurface key={run} targetText={TEXT} onComplete={handleComplete} />
      ) : (
        <section className="rounded-lg border border-border bg-surface p-8" data-testid="results">
          <div className="grid grid-cols-2 gap-4 font-mono text-sm sm:grid-cols-3">
            <div><div className="text-xs text-muted">net speed</div>{results.wpmNet.toFixed(1)} wpm</div>
            <div><div className="text-xs text-muted">raw speed</div>{results.wpmRaw.toFixed(1)} wpm</div>
            <div><div className="text-xs text-muted">accuracy</div>{(results.accuracy * 100).toFixed(1)}%</div>
            <div><div className="text-xs text-muted">consistency</div>{results.consistency.toFixed(0)}%</div>
            <div><div className="text-xs text-muted">backspaces / 100</div>{results.backspaces.toFixed(1)}</div>
          </div>
          <button
            type="button"
            className="btn-primary mt-6"
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
