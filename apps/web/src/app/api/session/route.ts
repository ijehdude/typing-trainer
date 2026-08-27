import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

/**
 * Session ingest (PRD §19.5, §22.4): validate with Zod, reject implausible
 * sessions, upsert idempotently by client-generated UUID. The client remains
 * authoritative for raw data; scores are recomputed from the snapshot.
 * Requires Supabase env + a user access token; otherwise 503 (sync disabled).
 */

export const runtime = "nodejs";

const BlockSchema = z.object({
  id: z.string().uuid(),
  ordinal: z.number().int().min(0).max(50),
  kind: z.enum(["warmup", "target", "transfer", "test", "probe"]),
  stage: z.number().int().min(0).max(5),
  targets: z.array(z.string().max(8)).max(16),
  visibility: z.string().max(32),
  seed: z.number(),
  textHash: z.string().max(64),
  wpmNet: z.number().min(0).max(400).nullable(),
  accuracy: z.number().min(0).max(1).nullable(),
  activeMs: z.number().min(0).max(3_600_000).nullable(),
  keystrokesBlob: z.string().max(2_000_000), // base64 gzip columnar (§20.2)
});

const SessionSchema = z.object({
  id: z.string().uuid(),
  startedAt: z.number(),
  endedAt: z.number(),
  mode: z.string().max(32),
  plannedMinutes: z.number().int().min(1).max(60),
  engineVersion: z.string().max(16),
  scoreVersion: z.number().int(),
  configHash: z.string().max(16),
  layoutId: z.string().max(32),
  wpmNet: z.number().min(0).max(400).nullable(),
  wpmRaw: z.number().min(0).max(500).nullable(),
  accuracy: z.number().min(0).max(1).nullable(),
  consistency: z.number().min(0).max(100).nullable(),
  rhythm: z.number().min(0).max(100).nullable(),
  keystrokes: z.number().int().min(0).max(200_000).nullable(),
  errors: z.number().int().min(0).nullable(),
  corrections: z.number().int().min(0).nullable(),
  activeMs: z.number().min(0).max(7_200_000).nullable(),
  speedTestWpm: z.number().min(0).max(400).nullable(),
  snapshot: z.record(z.string(), z.unknown()).nullable(),
  blocks: z.array(BlockSchema).max(50),
});

export async function POST(req: NextRequest) {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "sync disabled" }, { status: 503 });
  }

  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: userData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = userData.user.id;

  const parsed = SessionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid session", details: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }
  const s = parsed.data;

  // Plausibility (§22.4): flag-and-reject rather than store silently.
  if (s.endedAt < s.startedAt || (s.wpmNet !== null && s.wpmNet > 350)) {
    return NextResponse.json({ error: "implausible session" }, { status: 422 });
  }

  await supabase.from("profiles").upsert({ id: userId }, { onConflict: "id" });

  const { error: sessionError } = await supabase.from("sessions").upsert(
    {
      id: s.id,
      user_id: userId,
      started_at: new Date(s.startedAt).toISOString(),
      ended_at: new Date(s.endedAt).toISOString(),
      mode: s.mode,
      planned_minutes: s.plannedMinutes,
      engine_version: s.engineVersion,
      score_version: s.scoreVersion,
      config_hash: s.configHash,
      layout_id: s.layoutId,
      wpm_net: s.wpmNet,
      wpm_raw: s.wpmRaw,
      accuracy: s.accuracy,
      consistency: s.consistency,
      rhythm: s.rhythm,
      keystrokes: s.keystrokes,
      errors: s.errors,
      corrections: s.corrections,
      active_ms: s.activeMs,
      speed_test_wpm: s.speedTestWpm,
      snapshot: s.snapshot,
    },
    { onConflict: "id" },
  );
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }

  if (s.blocks.length > 0) {
    const { error: blocksError } = await supabase.from("session_blocks").upsert(
      s.blocks.map((b) => ({
        id: b.id,
        session_id: s.id,
        user_id: userId,
        ordinal: b.ordinal,
        kind: b.kind,
        stage: b.stage,
        targets: b.targets,
        visibility: b.visibility,
        generator_seed: b.seed,
        text_hash: b.textHash,
        wpm_net: b.wpmNet,
        accuracy: b.accuracy,
        active_ms: b.activeMs,
        keystrokes_blob: b.keystrokesBlob,
      })),
      { onConflict: "id" },
    );
    if (blocksError) {
      return NextResponse.json({ error: blocksError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
