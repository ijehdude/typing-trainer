import { kvGet, kvSet, uuid } from "./db";

/**
 * Product metrics (PRD §4.3) via PostHog's capture endpoint. Entirely absent
 * unless NEXT_PUBLIC_POSTHOG_KEY is set — no analytics in anonymous default.
 * Events carry aggregates only, never keystroke data (§22.1).
 */

let distinctId: string | null = null;

async function getDistinctId(): Promise<string> {
  if (distinctId) return distinctId;
  let id = await kvGet<string>("analyticsId");
  if (!id) {
    id = uuid();
    await kvSet("analyticsId", id);
  }
  return (distinctId = id);
}

export function analyticsEnabled(): boolean {
  return Boolean(process.env["NEXT_PUBLIC_POSTHOG_KEY"]);
}

export async function capture(event: string, properties: Record<string, unknown> = {}): Promise<void> {
  if (!analyticsEnabled() || typeof window === "undefined") return;
  try {
    const host = process.env["NEXT_PUBLIC_POSTHOG_HOST"] ?? "https://us.i.posthog.com";
    await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: process.env["NEXT_PUBLIC_POSTHOG_KEY"],
        event,
        distinct_id: await getDistinctId(),
        properties,
      }),
      keepalive: true,
    });
  } catch {
    // Analytics must never affect the product.
  }
}
