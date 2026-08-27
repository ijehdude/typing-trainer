import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { db } from "./db";

/**
 * Offline-first sync (PRD §19.5): every block is already in IndexedDB; when
 * Supabase is configured and the user signed in, unsynced sessions drain to
 * /api/session (idempotent by client UUID). Failures queue; reconnect flushes.
 * Without env config this module is inert — anonymous mode is first-class.
 */

let client: SupabaseClient | null = null;

export function syncConfigured(): boolean {
  return Boolean(
    process.env["NEXT_PUBLIC_SUPABASE_URL"] && process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  );
}

export function getSupabase(): SupabaseClient | null {
  if (!syncConfigured()) return null;
  if (!client) {
    client = createClient(
      process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
      process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
    );
  }
  return client;
}

async function gzipBase64(data: string): Promise<string> {
  if (typeof CompressionStream === "undefined") return btoa(unescape(encodeURIComponent(data)));
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function textHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

let draining = false;

/** Flush all completed, unsynced sessions. Safe to call repeatedly. */
export async function drainSync(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase || draining) return;
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return;

  draining = true;
  try {
    const unsynced = await db.sessions.where("synced").equals(0).toArray();
    for (const s of unsynced) {
      if (s.endedAt === null) continue;
      const blocks = await db.blocks.where("sessionId").equals(s.id).toArray();
      const payload = {
        id: s.id,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        mode: s.mode,
        plannedMinutes: s.plannedMinutes,
        engineVersion: s.engineVersion,
        scoreVersion: s.scoreVersion,
        configHash: s.configHash || "00000000",
        layoutId: s.layoutId,
        wpmNet: s.wpmNet, wpmRaw: s.wpmRaw, accuracy: s.accuracy,
        consistency: s.consistency, rhythm: s.rhythm,
        keystrokes: s.keystrokes, errors: s.errors, corrections: s.corrections,
        activeMs: s.activeMs, speedTestWpm: s.speedTestWpm,
        snapshot: s.snapshot as Record<string, unknown> | null,
        blocks: await Promise.all(
          blocks.map(async (b) => ({
            id: b.id,
            ordinal: b.ordinal,
            kind: b.kind,
            stage: b.stage,
            targets: b.targets,
            visibility: b.visibility,
            seed: b.seed,
            textHash: await textHash(b.text),
            wpmNet: b.wpmNet,
            accuracy: b.accuracy,
            activeMs: b.activeMs,
            keystrokesBlob: await gzipBase64(JSON.stringify(b.keystrokes)),
          })),
        ),
      };
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        await db.sessions.update(s.id, { synced: 1 });
      } else if (res.status !== 503) {
        break; // transient failure: stop and retry on the next drain
      }
    }
  } finally {
    draining = false;
  }
}

let listenersInstalled = false;

/** Install reconnect-driven flushing (call once from any page). */
export function ensureSyncListeners(): void {
  if (listenersInstalled || typeof window === "undefined" || !syncConfigured()) return;
  listenersInstalled = true;
  window.addEventListener("online", () => void drainSync());
  void drainSync();
}
