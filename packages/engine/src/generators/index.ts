import {
  charProfile, corpusByDomain, lexicon, PROFILE_MIX, zipfWeight,
  type Domain, type TypingProfileId,
} from '@typing-trainer/content';
import { CONFIG, type EngineConfig } from '../config';
import { createRng, type Rng } from '../rand';
import type { Stage } from '../types';

/**
 * The content ladder generators (PRD §10). Deterministic given a seed;
 * stages 0–4 inject targets to a requested density (±20%), stage 5 selects
 * real passages whose natural charProfile matches the targets — selection,
 * not injection.
 */

export interface GeneratorRequest {
  stage: Stage;
  targets: readonly string[];
  allowedChars?: ReadonlySet<string>;
  /** Desired target occurrences per 100 chars (default from config). */
  targetDensity?: number;
  length: number;
  profile?: TypingProfileId;
  difficulty?: number; // 0..1
  seed: number;
}

export interface GeneratedText {
  text: string;
  stage: Stage;
  targetOccurrences: number;
  /** Achieved occurrences per 100 chars. */
  density: number;
}

export function generate(req: GeneratorRequest, cfg: EngineConfig = CONFIG): GeneratedText {
  const rng = createRng(req.seed);
  let text: string;
  switch (req.stage) {
    case 0: text = drillStage(req, rng); break;
    case 1: text = syntheticStage(req, rng, cfg); break;
    case 2: text = wordsStage(req, rng, cfg, false); break;
    case 3: text = wordsStage(req, rng, cfg, true); break;
    case 4: text = sentencesStage(req, rng, cfg); break;
    case 5: text = proseStage(req, rng); break;
  }
  text = text.slice(0, Math.max(req.length, 1)).trimEnd();
  const occ = countOccurrences(text, req.targets);
  return {
    text,
    stage: req.stage,
    targetOccurrences: occ,
    density: text.length > 0 ? (occ / text.length) * 100 : 0,
  };
}

export function countOccurrences(text: string, targets: readonly string[]): number {
  let n = 0;
  const lower = text.toLowerCase();
  for (const t of targets) {
    if (t.length === 0) continue;
    let i = lower.indexOf(t);
    while (i !== -1) {
      n++;
      i = lower.indexOf(t, i + 1);
    }
  }
  return n;
}

// --- Stage 0: drill -------------------------------------------------------

function drillStage(req: GeneratorRequest, rng: Rng): string {
  const targets = req.targets.length > 0 ? req.targets : ['fj'];
  const home = "asdfjkl;".split('').filter((c) => !req.allowedChars || req.allowedChars.has(c));
  const tokens: string[] = [];
  for (const t of targets) {
    const rev = [...t].reverse().join('');
    tokens.push(t, t, rev, t);
    if (home.length > 0) {
      tokens.push(t + rng.pick(home), rng.pick(home) + t);
    }
  }
  const out: string[] = [];
  let len = 0;
  while (len < req.length) {
    const tok = tokens[rng.int(tokens.length)]!;
    out.push(tok);
    len += tok.length + 1;
  }
  return out.join(' ');
}

// --- Stage 1: synthetic pronounceable words -------------------------------

interface BigramModel {
  starts: Map<string, number>;
  next: Map<string, Map<string, number>>;
}

let bigramModelCache: BigramModel | null = null;

function bigramModel(): BigramModel {
  if (bigramModelCache) return bigramModelCache;
  const starts = new Map<string, number>();
  const next = new Map<string, Map<string, number>>();
  for (const word of lexicon()) {
    starts.set(word[0]!, (starts.get(word[0]!) ?? 0) + 1);
    for (let i = 1; i < word.length; i++) {
      const a = word[i - 1]!;
      const b = word[i]!;
      let m = next.get(a);
      if (!m) next.set(a, (m = new Map()));
      m.set(b, (m.get(b) ?? 0) + 1);
    }
  }
  return (bigramModelCache = { starts, next });
}

function samplePlausibleChar(
  prev: string | null,
  rng: Rng,
  allowed?: ReadonlySet<string>,
): string | null {
  const model = bigramModel();
  const dist = prev === null ? model.starts : model.next.get(prev) ?? model.starts;
  const entries = [...dist.entries()].filter(([c]) => !allowed || allowed.has(c));
  if (entries.length === 0) return null;
  const idx = rng.weightedIndex(entries.map(([, w]) => w));
  return entries[idx]![0];
}

/** A pronounceable pseudo-word containing `target`, grown by the n-gram model. */
export function syntheticWord(
  target: string,
  length: number,
  rng: Rng,
  allowed?: ReadonlySet<string>,
): string {
  let word = target;
  let guard = 0;
  while (word.length < length && guard++ < 20) {
    const growLeft = rng.next() < 0.35 && word.length < length;
    if (growLeft) {
      // Pick a char that plausibly precedes the current start.
      const model = bigramModel();
      const candidates: Array<[string, number]> = [];
      for (const [a, m] of model.next) {
        if (allowed && !allowed.has(a)) continue;
        const w = m.get(word[0]!);
        if (w) candidates.push([a, w]);
      }
      if (candidates.length === 0) break;
      word = candidates[rng.weightedIndex(candidates.map(([, w]) => w))]![0] + word;
    } else {
      const c = samplePlausibleChar(word[word.length - 1]!, rng, allowed);
      if (!c) break;
      word = word + c;
    }
  }
  return word;
}

function syntheticStage(req: GeneratorRequest, rng: Rng, cfg: EngineConfig): string {
  const targets = req.targets.length > 0 ? req.targets : ['th'];
  const density = req.targetDensity ?? cfg.content.defaultTargetDensity;
  const out: string[] = [];
  let len = 0;
  let occ = 0;
  while (len < req.length) {
    const needed = (density / 100) * len;
    const behind = occ <= needed;
    const wordLen = 3 + rng.int(4);
    let word: string;
    if (behind) {
      word = syntheticWord(targets[rng.int(targets.length)]!, wordLen, rng, req.allowedChars);
    } else {
      // Filler pseudo-word without forcing a target.
      let w = samplePlausibleChar(null, rng, req.allowedChars) ?? 'a';
      while (w.length < wordLen) {
        const c = samplePlausibleChar(w[w.length - 1]!, rng, req.allowedChars);
        if (!c) break;
        w += c;
      }
      word = w;
    }
    out.push(word);
    occ += countOccurrences(word, targets);
    len += word.length + 1;
  }
  return out.join(' ');
}

// --- Stages 2–3: real words / phrases -------------------------------------

function wordPools(req: GeneratorRequest) {
  const words = lexicon();
  const build = (restrict: boolean) => {
    const targetWords: Array<{ w: string; weight: number }> = [];
    const fillerWords: Array<{ w: string; weight: number }> = [];
    words.forEach((w, r) => {
      if (restrict && req.allowedChars && ![...w].every((c) => req.allowedChars!.has(c))) return;
      const entry = { w, weight: zipfWeight(r) };
      if (req.targets.some((t) => w.includes(t))) targetWords.push(entry);
      else fillerWords.push(entry);
    });
    return { targetWords, fillerWords };
  };

  const restricted = build(true);
  // If the unlocked alphabet admits no real words at all, relax the unlock
  // constraint rather than the guarantee that practice text is real language.
  if (restricted.targetWords.length + restricted.fillerWords.length === 0) return build(false);
  return restricted;
}

function pickWord(
  pool: Array<{ w: string; weight: number }>,
  rng: Rng,
  recent: string[],
  cfg: EngineConfig,
): string | null {
  const window = cfg.content.wordRepeatWindow;
  const eligible = pool.filter((e) => !recent.slice(-window).includes(e.w));
  const source = eligible.length > 0 ? eligible : pool;
  if (source.length === 0) return null;
  return source[rng.weightedIndex(source.map((e) => e.weight))]!.w;
}

function wordsStage(req: GeneratorRequest, rng: Rng, cfg: EngineConfig, phrases: boolean): string {
  const density = req.targetDensity ?? cfg.content.defaultTargetDensity;
  const { targetWords, fillerWords } = wordPools(req);
  const out: string[] = [];
  const recent: string[] = [];
  let len = 0;
  let occ = 0;
  let guard = 0;
  while (len < req.length && guard++ < 500) {
    const needed = (density / 100) * len;
    const behind = occ <= needed && targetWords.length > 0;
    const pool = behind ? targetWords : fillerWords.length > 0 ? fillerWords : targetWords;
    const word = pickWord(pool, rng, recent, cfg);
    if (!word) break;
    out.push(word);
    recent.push(word);
    occ += countOccurrences(word, req.targets);
    len += word.length + 1;
    if (phrases && out.length % (2 + rng.int(2)) === 0) {
      // Phrase boundary: nothing typed differently, but grouping shapes rhythm.
    }
  }
  return out.join(' ');
}

// --- Stage 4: sentences ---------------------------------------------------

function sentencesStage(req: GeneratorRequest, rng: Rng, cfg: EngineConfig): string {
  // Prefer real corpus sentences containing targets; fall back to
  // capitalized word-stage lines with punctuation.
  const sentences = [...corpusByDomain('prose'), ...corpusByDomain('general')]
    .flatMap((c) => c.text.split(/(?<=[.!?])\s+/))
    .filter((s) => s.length >= 25 && s.length <= 200);
  const scored = sentences
    .map((s) => ({ s, score: countOccurrences(s, req.targets) / s.length }))
    .sort((a, b) => b.score - a.score);

  const out: string[] = [];
  let len = 0;
  const used = new Set<number>();
  // Take the best-matching half deterministically, shuffled by seed.
  const top = scored.slice(0, Math.max(6, Math.ceil(scored.length / 2)));
  while (len < req.length && used.size < top.length) {
    const idx = rng.int(top.length);
    if (used.has(idx)) continue;
    used.add(idx);
    const s = top[idx]!.s;
    out.push(s);
    len += s.length + 1;
  }
  if (len < req.length) {
    const filler = wordsStage({ ...req, length: req.length - len }, rng, cfg, false);
    if (filler.length > 0) out.push(filler.charAt(0).toUpperCase() + filler.slice(1) + '.');
  }
  return out.join(' ');
}

// --- Stage 5: real-world prose (selection, not injection) -----------------

function proseStage(req: GeneratorRequest, rng: Rng): string {
  const mix = PROFILE_MIX[req.profile ?? 'writer'];
  const domains = Object.entries(mix) as Array<[Domain, number]>;
  const out: string[] = [];
  let len = 0;
  const usedTexts = new Set<string>();
  let guard = 0;
  while (len < req.length && guard++ < 40) {
    const domain = domains[rng.weightedIndex(domains.map(([, w]) => w))]![0];
    const items = corpusByDomain(domain).filter((c) => !usedTexts.has(c.text));
    if (items.length === 0) continue;
    // Natural emphasis: prefer passages whose charProfile contains targets.
    const scored = items.map((c) => {
      const prof = charProfile(c.text);
      let score = 1;
      for (const t of req.targets) {
        score += (t.length === 2 ? prof.bigrams.get(t) ?? 0 : 0) + (t.length === 1 && prof.chars.has(t) ? 1 : 0);
      }
      return { c, score };
    });
    const chosen = scored[rng.weightedIndex(scored.map((s) => s.score))]!.c;
    usedTexts.add(chosen.text);
    out.push(chosen.text);
    len += chosen.text.length + 1;
  }
  return out.join('\n');
}
