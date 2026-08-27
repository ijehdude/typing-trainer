import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateNarration } from "@typing-trainer/engine";

/**
 * LLM narration layer (PRD §19.6). The model decides nothing — it receives a
 * fully-computed DiagnosisSnapshot and returns 2–5 sentences of coach prose.
 * Every numeral is validated against the input; failure → template fallback
 * (the client always has a template already rendered, so `text: null` is a
 * complete, valid answer). Without ANTHROPIC_API_KEY the route is a no-op.
 */

export const runtime = "nodejs";

const BodySchema = z.object({
  kind: z.enum(["session", "stuck"]),
  snapshot: z.record(z.string(), z.unknown()),
  /** The deterministic template text, given to the model as grounding. */
  templateText: z.string().max(2000),
});

const VOICE_RULES = `You are the coach voice of a typing trainer for adults. Rewrite the provided template message into 2-5 natural sentences.
Hard rules:
- Every claim must carry a number, and every number you write MUST appear in the provided data. Never invent, derive, or extrapolate a number.
- Never use exclamation marks, emoji, or the words "amazing", "awesome", "incredible".
- At most one criticism, always followed by the concrete prescription.
- No praise without a measured improvement to attach it to.
- If the data is thin, say so plainly.
Tone: specific, quantified, unsentimental, on the user's side. A strength coach, not a cheerleader.`;

// Simple per-IP daily limiter (per-instance; real quota is per-user client-side).
const counts = new Map<string, { day: string; n: number }>();
const DAILY_LIMIT = 20; // CONFIG.coach.llmGenerationsPerDay

export async function POST(req: NextRequest) {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    return NextResponse.json({ text: null, source: "template" });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { kind, snapshot, templateText } = parsed.data;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const day = new Date().toISOString().slice(0, 10);
  const entry = counts.get(ip);
  const n = entry?.day === day ? entry.n : 0;
  if (n >= DAILY_LIMIT) {
    return NextResponse.json({ text: null, source: "template" });
  }
  counts.set(ip, { day, n: n + 1 });

  try {
    const client = new Anthropic({ apiKey });
    // Haiku-class for coach messages; Sonnet-class only for the long-form
    // "Why am I stuck?" narration (PRD §19.6 cost guardrail).
    const model = kind === "stuck" ? "claude-sonnet-5" : "claude-haiku-4-5";
    const response = await client.messages.create({
      model,
      max_tokens: 400,
      system: VOICE_RULES,
      messages: [
        {
          role: "user",
          content:
            `Data (the only permitted source of numbers):\n${JSON.stringify(snapshot)}\n\n` +
            `Template message to rewrite:\n${templateText}`,
        },
      ],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const validation = validateNarration(text, { snapshot, templateText });
    if (!validation.ok || text.length < 10 || /!|amazing|awesome|incredible/i.test(text)) {
      return NextResponse.json({ text: null, source: "template" }); // fall back
    }
    return NextResponse.json({ text, source: "llm" });
  } catch {
    return NextResponse.json({ text: null, source: "template" });
  }
}
