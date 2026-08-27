import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Retention prune (PRD §20.2, §20.3): raw keystroke blobs older than 90 days
 * are dropped; aggregates and session rows stay forever. Runs on Vercel Cron.
 */

export const runtime = "nodejs";

const RETENTION_DAYS = 90; // CONFIG.retention.rawBlobDays

export async function GET(req: NextRequest) {
  const cronSecret = process.env["CRON_SECRET"];
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !serviceKey) {
    return NextResponse.json({ skipped: "sync disabled" });
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const { error, count } = await supabase
    .from("session_blocks")
    .update({ keystrokes_blob: null }, { count: "exact" })
    .lt("created_at", cutoff)
    .not("keystrokes_blob", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pruned: count ?? 0 });
}
