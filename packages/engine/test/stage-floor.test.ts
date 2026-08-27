import { describe, expect, it } from 'vitest';
import { CORPUS, lexicon, qwertyUs, unlockOrder } from '@typing-trainer/content';
import { CONFIG } from '../src/config';
import { applyGate, initialCurriculumState, stageFloorForWpm } from '../src/curriculum/index';
import { generate } from '../src/generators/index';
import { planSession, replanRemaining } from '../src/planner/index';
import type { BlockResult } from '../src/planner/index';

// Real language = the drill lexicon (stages 2–3) plus every word that appears
// in the shipped corpora (stages 4–5). Anything outside this is invented.
const WORDS = new Set([
  ...lexicon(),
  ...CORPUS.flatMap((c) => c.text.toLowerCase().match(/[a-z']+/g) ?? []),
]);
const isReal = (token: string) => WORDS.has(token.toLowerCase().replace(/[^a-z']/g, ''));

/** Share of tokens that are real words rather than generated strings. */
function realWordShare(text: string): number {
  const tokens = text.split(/\s+/).filter((w) => /[a-z]{2,}/i.test(w));
  if (tokens.length === 0) return 0;
  return tokens.filter(isReal).length / tokens.length;
}

describe('nobody is ever shown pseudo-words (§10.1 minStage)', () => {
  it('the ladder floor is real words, at every skill level', () => {
    for (const wpm of [0, 12, 25, 38, 55, 72, 110]) {
      expect(stageFloorForWpm(wpm, false), `${wpm} wpm`).toBeGreaterThanOrEqual(CONFIG.content.minStage);
    }
    expect(stageFloorForWpm(null, false)).toBeGreaterThanOrEqual(CONFIG.content.minStage);
    expect(stageFloorForWpm(90, true)).toBeGreaterThanOrEqual(CONFIG.content.minStage);
  });

  it('fast typists still start higher up the ladder', () => {
    expect(stageFloorForWpm(85, false)).toBe(3); // phrases
    expect(stageFloorForWpm(45, false)).toBe(2); // words
  });

  it('every planned block, at every level, renders real language', () => {
    for (const wpm of [15, 38, 72, 120]) {
      const floor = stageFloorForWpm(wpm, false);
      for (const minutes of [5, 10, 15, 25]) {
        const plan = planSession({ minutes, snapshot: null, profile: 'writer', seed: 4242, stageFloor: floor });
        for (const b of plan.blocks) {
          expect(b.stage, `${wpm}wpm ${minutes}min "${b.label}"`).toBeGreaterThanOrEqual(CONFIG.content.minStage);
          const text = generate({
            stage: b.stage, targets: b.targets, length: 220,
            profile: b.profile, seed: b.seed, difficulty: 0.5,
          }).text;
          expect(text.length).toBeGreaterThan(40);
          expect(realWordShare(text), `${wpm}wpm "${b.label}": ${text.slice(0, 60)}`).toBeGreaterThan(0.9);
        }
      }
    }
  });

  it('probe blocks are real words too, not isolating drills', () => {
    const plan = planSession({
      minutes: 15,
      snapshot: {
        sessionMetrics: {
          wpmNet: 70, wpmRaw: 76, accuracy: 0.97, consistency: 88, rhythm: 80,
          hesitationRate: 4, backspaceRate: 3, correctionTimePct: 0.03,
          keystrokes: 4000, errors: 90, corrections: 80, activeMs: 600_000, timingSuspect: false,
        },
        skillProfile: {
          speed: 65, accuracy: 79, consistency: 88, rhythm: 80, weakKeyControl: 70,
          punctuation: 60, overall: 72,
          raw: { wpmNet: 70, firstAttemptAccuracy: 0.97, cv: 0.12, residualMad: 0.18, weakKeyRatio: 0.7, punctRatio: 0.6 },
        },
        findings: [{ cause: 'bigram:io', label: 'i → o', evidence: 'costs 4 WPM', estWpmCost: 4, confidence: 'medium', patterns: ['io'] }],
        tradeoff: { alpha: -8, beta: 0.06, vControl: 68, vCollapse: 84, headroom: 12, r2: 0.1, n: 3000 },
        bottlenecks: { patterns: [] },
        habits: [],
        confidenceNotes: [],
      },
      belowBar: [{
        cause: 'finger:RP', label: 'Right pinky', evidence: '', estWpmCost: 3,
        confidence: 'insufficient', patterns: ['p', ';'], shown: false,
      }],
      profile: 'writer', seed: 9, stageFloor: 3,
    });
    const probe = plan.blocks.find((b) => b.kind === 'probe');
    expect(probe).toBeDefined();
    expect(probe!.stage).toBeGreaterThanOrEqual(CONFIG.content.minStage);
  });

  it('repeated failure eases difficulty without falling into pseudo-words', () => {
    const remaining = planSession({
      minutes: 15, snapshot: null, profile: 'writer', seed: 3, stageFloor: 2,
    }).blocks.filter((b) => b.kind === 'target');
    const failed = (o: number, targets: string[]): BlockResult => ({
      ordinal: o, kind: 'target', targets, wpmNet: 60, accuracy: 0.9, targetMet: false,
    });
    const t = remaining[0]!.targets;
    const replanned = replanRemaining({
      remaining, completed: [failed(1, t), failed(2, t)],
    });
    for (const b of replanned) {
      expect(b.stage).toBeGreaterThanOrEqual(CONFIG.content.minStage);
    }
  });

  it('demotion stops at the real-words floor', () => {
    let state = initialCurriculumState(qwertyUs, true);
    state = applyGate(state, 'io', 'demote');
    state = applyGate(state, 'io', 'demote');
    state = applyGate(state, 'io', 'demote');
    expect(state.stageByPattern['io'] ?? CONFIG.content.minStage).toBeGreaterThanOrEqual(
      CONFIG.content.minStage,
    );
  });

  it('a demoted pattern still keeps its earned stage below the entry point', () => {
    const plan = planSession({
      minutes: 15, snapshot: null, profile: 'writer', seed: 1,
      stageFloor: 4, stageByPattern: { th: 2 }, // struggled at phrases, back to words
    });
    const withTh = plan.blocks.find((b) => b.targets.includes('th'));
    expect(withTh!.stage).toBe(2);
  });
});

describe('Foundations gets real words within its unlocked alphabet', () => {
  it('home-row-only practice is real English, restricted to unlocked keys', () => {
    const order = unlockOrder(qwertyUs);
    const unlocked = new Set([...order.slice(0, 9), ' ']);
    const text = generate({
      stage: CONFIG.content.minStage as 2,
      targets: ['a', 's'],
      length: 160,
      allowedChars: unlocked,
      seed: 7,
    }).text;
    expect(text.length).toBeGreaterThan(40);
    for (const ch of text) expect(unlocked.has(ch), `char ${JSON.stringify(ch)}`).toBe(true);
    expect(realWordShare(text)).toBe(1);
  });

  it('falls back to real words rather than gibberish if the alphabet admits none', () => {
    const text = generate({
      stage: 2, targets: ['q'], length: 120, allowedChars: new Set(['q', 'z', ' ']), seed: 4,
    }).text;
    expect(text.length).toBeGreaterThan(40);
    expect(realWordShare(text)).toBeGreaterThan(0.9);
  });
});
