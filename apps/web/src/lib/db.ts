import Dexie, { type EntityTable } from "dexie";
import type {
  DiagnosisSnapshot, Keystroke, Observation, SrsItem,
} from "@typing-trainer/engine";
import { transitionFeatures } from "@typing-trainer/engine";
import { getLayout } from "@typing-trainer/content";
import type { CurriculumState } from "@typing-trainer/engine";

/**
 * Offline-first local store (PRD §19.5): every block is written immediately;
 * an account is never required (§22.2 anonymous mode). Sync (M6) drains the
 * unsynced sessions to the server; the client stays authoritative for raw
 * session data.
 */

export interface SessionRow {
  id: string;               // client-generated UUID (idempotent upsert key)
  startedAt: number;
  endedAt: number | null;
  mode: string;
  plannedMinutes: number;
  engineVersion: string;
  scoreVersion: number;
  configHash: string;
  layoutId: string;
  wpmNet: number | null;
  wpmRaw: number | null;
  accuracy: number | null;
  consistency: number | null;
  rhythm: number | null;
  keystrokes: number | null;
  errors: number | null;
  corrections: number | null;
  activeMs: number | null;
  speedTestWpm: number | null;
  snapshot: DiagnosisSnapshot | null;
  synced: 0 | 1;
}

/** Columnar keystroke storage (PRD §20.2): ~7 bytes/keystroke before gzip. */
export interface KeystrokeColumns {
  t0: number;          // block wall-clock reference
  dt: number[];        // t deltas from t0, ms (rounded)
  keys: string;        // JSON array string of keys
  codes: string;       // JSON array string of codes
  index: number[];
  flags: number[];     // bit0 correct, bit1 correction, bit2 repeat
  mods: number[];
}

export interface BlockRow {
  id: string;
  sessionId: string;
  ordinal: number;
  kind: string;
  stage: number;
  targets: string[];
  visibility: string;
  seed: number;
  text: string;
  wpmNet: number | null;
  accuracy: number | null;
  activeMs: number | null;
  keystrokes: KeystrokeColumns;
}

/** Compact per-session observations for the refit window (PRD §7.2). */
export interface ObservationRow {
  sessionId: string;
  sessionIndex: number;    // 1-based numeric id used by the model
  bigrams: string;         // 2 chars per observation, concatenated
  ikis: number[];          // ms, rounded
}

export interface SrsRow extends SrsItem {
  key: string; // `${patternType}:${pattern}`
}

export interface KvRow {
  key: string;
  value: unknown;
}

export const db = new Dexie("typing-trainer") as Dexie & {
  sessions: EntityTable<SessionRow, "id">;
  blocks: EntityTable<BlockRow, "id">;
  observations: EntityTable<ObservationRow, "sessionId">;
  srs: EntityTable<SrsRow, "key">;
  kv: EntityTable<KvRow, "key">;
};

db.version(1).stores({
  sessions: "id, startedAt, synced",
  blocks: "id, sessionId, [sessionId+ordinal]",
  observations: "sessionId, sessionIndex",
  srs: "key, dueAt, state",
  kv: "key",
});

// --- codecs ---------------------------------------------------------------

export function packKeystrokes(kss: readonly Keystroke[]): KeystrokeColumns {
  const t0 = kss[0]?.t ?? 0;
  return {
    t0,
    dt: kss.map((k) => Math.round(k.t - t0)),
    keys: JSON.stringify(kss.map((k) => k.key)),
    codes: JSON.stringify(kss.map((k) => k.code)),
    index: kss.map((k) => k.index),
    flags: kss.map((k) => (k.correct ? 1 : 0) | (k.isCorrection ? 2 : 0) | (k.repeat ? 4 : 0)),
    mods: kss.map((k) => k.modifiers),
  };
}

export function unpackKeystrokes(cols: KeystrokeColumns, text: string): Keystroke[] {
  const keys = JSON.parse(cols.keys) as string[];
  const codes = JSON.parse(cols.codes) as string[];
  return cols.dt.map((dt, i) => ({
    t: cols.t0 + dt,
    tUp: null,
    code: codes[i]!,
    key: keys[i]!,
    expected: text[cols.index[i]!] ?? "",
    index: cols.index[i]!,
    correct: (cols.flags[i]! & 1) !== 0,
    isCorrection: (cols.flags[i]! & 2) !== 0,
    repeat: (cols.flags[i]! & 4) !== 0,
    modifiers: cols.mods[i]!,
  }));
}

export function packObservations(
  sessionId: string,
  sessionIndex: number,
  obs: readonly Observation[],
): ObservationRow {
  return {
    sessionId,
    sessionIndex,
    bigrams: obs.map((o) => o.prevChar + o.char).join(""),
    ikis: obs.map((o) => Math.round(Math.exp(o.logIki))),
  };
}

export function unpackObservations(row: ObservationRow, layoutId: string): Observation[] {
  const layout = getLayout(layoutId);
  const out: Observation[] = [];
  for (let i = 0; i < row.ikis.length; i++) {
    const bigram = row.bigrams.slice(i * 2, i * 2 + 2);
    const f = transitionFeatures(bigram, layout);
    if (!f) continue;
    out.push({ ...f, logIki: Math.log(Math.max(1, row.ikis[i]!)), sessionId: row.sessionIndex });
  }
  return out;
}

// --- kv helpers -----------------------------------------------------------

export interface AppSettings {
  layoutId: string;
  typingProfile: "developer" | "writer" | "student" | "office" | "data_entry" | "gamer" | "competitive";
  goalWpm: number | null;
  startWpm: number | null;
  coachMode: "full" | "minimal";
  showHud: boolean;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  layoutId: "qwerty-us",
  typingProfile: "writer",
  goalWpm: null,
  startWpm: null,
  coachMode: "full",
  showHud: false,
  onboarded: false,
};

export async function kvGet<T>(key: string): Promise<T | null> {
  const row = await db.kv.get(key);
  return row ? (row.value as T) : null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}

export async function getSettings(): Promise<AppSettings> {
  return { ...DEFAULT_SETTINGS, ...((await kvGet<Partial<AppSettings>>("settings")) ?? {}) };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await getSettings()), ...patch };
  await kvSet("settings", next);
  return next;
}

export async function getCurriculumState(): Promise<CurriculumState | null> {
  return kvGet<CurriculumState>("curriculum");
}

export async function saveCurriculumState(state: CurriculumState): Promise<void> {
  await kvSet("curriculum", state);
}

// --- loading state for a new session --------------------------------------

/** The refit window: observations from the most recent sessions (§7.2). */
export async function loadRetainedObservations(
  layoutId: string,
  maxObs: number,
): Promise<Observation[]> {
  const rows = await db.observations.orderBy("sessionIndex").reverse().limit(12).toArray();
  const out: Observation[] = [];
  for (const row of rows.reverse()) {
    out.push(...unpackObservations(row, layoutId));
  }
  return out.slice(-maxObs);
}

export async function loadSrsItems(): Promise<SrsItem[]> {
  return db.srs.toArray();
}

export async function saveSrsItem(item: SrsItem): Promise<void> {
  await db.srs.put({ ...item, key: `${item.patternType}:${item.pattern}` });
}

export async function completedSessions(): Promise<SessionRow[]> {
  const rows = await db.sessions.orderBy("startedAt").toArray();
  return rows.filter((r) => r.endedAt !== null);
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
