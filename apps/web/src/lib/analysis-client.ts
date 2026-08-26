import * as Comlink from "comlink";
import {
  analyzeSession,
  type SessionAnalysisInput,
  type SessionAnalysisResult,
} from "@typing-trainer/engine";
import type { AnalysisWorkerApi } from "../../workers/analysis.worker";

/**
 * Client for the analysis worker (PRD §19.4). Degrades gracefully: if the
 * Worker cannot start, analysis runs on the main thread — between blocks
 * only, which is exactly where this is called from.
 */

let worker: Comlink.Remote<AnalysisWorkerApi> | null = null;
let workerFailed = false;

function getWorker(): Comlink.Remote<AnalysisWorkerApi> | null {
  if (workerFailed || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    const w = new Worker(new URL("../../workers/analysis.worker.ts", import.meta.url));
    worker = Comlink.wrap<AnalysisWorkerApi>(w);
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

export async function runSessionAnalysis(
  input: SessionAnalysisInput,
): Promise<SessionAnalysisResult> {
  const remote = getWorker();
  if (remote) {
    try {
      return await remote.analyzeSession(input);
    } catch {
      workerFailed = true; // fall through to main thread
    }
  }
  return analyzeSession(input);
}
