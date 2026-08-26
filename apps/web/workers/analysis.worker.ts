import * as Comlink from "comlink";
import {
  analyzeSession,
  type SessionAnalysisInput,
  type SessionAnalysisResult,
} from "@typing-trainer/engine";

/**
 * The analysis worker (PRD §19.4): ridge refit, diagnosis, and snapshot
 * assembly run here so the main thread's input path is never blocked.
 */
const api = {
  analyzeSession(input: SessionAnalysisInput): SessionAnalysisResult {
    return analyzeSession(input);
  },
};

export type AnalysisWorkerApi = typeof api;

Comlink.expose(api);
