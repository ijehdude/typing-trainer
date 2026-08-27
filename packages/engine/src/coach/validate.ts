/**
 * LLM narration validator (PRD §19.6): no number may appear in coach output
 * that is not present in the input snapshot (within formatting tolerance).
 * Validation failure → the caller falls back to templates. This is the hard
 * guarantee behind "the model decides nothing, it only speaks."
 */

/** Collect every numeric value reachable in the input, plus display variants. */
export function collectNumbers(value: unknown, out = new Set<number>()): Set<number> {
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.add(value);
    out.add(Math.round(value));
    out.add(Math.round(value * 10) / 10);
    // Fractions are usually displayed as percentages.
    if (Math.abs(value) <= 1) {
      out.add(Math.round(value * 100));
      out.add(Math.round(value * 1000) / 10);
    }
    // Differences from 100% ("dropped 1.9pp") are common; allow complements.
    if (value > 0 && value <= 1) {
      out.add(Math.round((1 - value) * 100));
      out.add(Math.round((1 - value) * 1000) / 10);
    }
  } else if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectNumbers(v, out);
  }
  return out;
}

const NUMBER_RE = /-?\d+(?:[.,]\d+)?/g;

export interface NarrationValidation {
  ok: boolean;
  offending: string[];
}

export function validateNarration(text: string, input: unknown): NarrationValidation {
  const allowed = collectNumbers(input);
  // Small counting numbers appear naturally in prose ("two more sessions",
  // "one thing"); digits 0–12 are allowed as rhetorical counts.
  for (let i = 0; i <= 12; i++) allowed.add(i);

  const offending: string[] = [];
  for (const match of text.matchAll(NUMBER_RE)) {
    const raw = match[0]!.replace(',', '.');
    const num = Number(raw);
    if (Number.isNaN(num)) continue;
    const tolerated = [...allowed].some(
      (a) => Math.abs(a - num) <= Math.max(0.05, Math.abs(a) * 0.005),
    );
    if (!tolerated) offending.push(match[0]!);
  }
  return { ok: offending.length === 0, offending };
}
