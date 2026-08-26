import { describe, expect, it } from 'vitest';
import { qwertyUs, POPULATION_PRIOR } from '@typing-trainer/content';
import { analyzeBlock } from '../src/capture/analyze';
import { extractObservations } from '../src/model/observations';
import { fitModel, predictLogIki, ZERO_PRIOR } from '../src/model/ridge';
import {
  corpusMeanIki, estimateCost, transitionFrequencies,
} from '../src/diagnosis/counterfactual';
import { median } from '../src/metrics/index';
import { COHORT, defaultProfile, simulateTyping } from '../src/simulator/index';

const TEXT =
  'the quick brown fox jumps over the lazy dog while happy people prepare a proper supper for a sleepy puppy '.repeat(12);

function observationsFor(profileName: keyof typeof COHORT, seed: number, sessionId = 1) {
  const stream = simulateTyping(COHORT[profileName]!, TEXT, qwertyUs, { seed });
  const block = analyzeBlock(stream, qwertyUs, TEXT);
  return extractObservations(block.keystrokes, qwertyUs, sessionId);
}

describe('ridge attribution model (PRD §7.2)', () => {
  it('recovers a planted right-pinky slowdown from simulator ground truth', () => {
    // handImbalanced plants RP ×1.4 ⇒ total log effect ln(1.4) ≈ 0.336.
    // κ (per RP key) and φ_RP are jointly identified; ridge splits the effect,
    // so we assert on the identifiable combination.
    const obs = [...observationsFor('handImbalanced', 5, 1), ...observationsFor('handImbalanced', 6, 2)];
    const params = fitModel(obs, ZERO_PRIOR);

    const fingerPhis = Object.entries(params.phi).filter(([f]) => f !== 'RT' && f !== 'LT');
    const peerMed = median(fingerPhis.filter(([f]) => f !== 'RP').map(([, v]) => v));
    const phiDelta = (params.phi['RP'] ?? 0) - peerMed;

    const rpKeys = ['p'];
    const kappaMed = median(Object.values(params.kappa));
    const kappaDelta = median(rpKeys.map((k) => (params.kappa[k] ?? 0) - kappaMed));

    const totalEffect = phiDelta + kappaDelta;
    expect(phiDelta).toBeGreaterThan(0.08);
    expect(totalEffect).toBeGreaterThan(0.2);
    expect(totalEffect).toBeLessThan(0.5);
  });

  it('recovers planted per-key latencies (visual searcher q/z ×2)', () => {
    const obs = [...observationsFor('visualSearcher', 9, 1), ...observationsFor('visualSearcher', 10, 2)];
    const params = fitModel(obs, ZERO_PRIOR);
    const kappaMed = median(Object.values(params.kappa));
    // q and z share the left pinky with the very common a, so their slowness
    // is identifiable as *key* slowness. p is the only observed right-pinky
    // key, so its slowness is indistinguishable from finger slowness and is
    // attributed to φ_RP — assert that attribution too.
    expect((params.kappa['q'] ?? 0) - kappaMed).toBeGreaterThan(0.3);
    expect((params.kappa['z'] ?? 0) - kappaMed).toBeGreaterThan(0.3);
    const peerMed = median(
      Object.entries(params.phi).filter(([f]) => f !== 'RP' && f !== 'RT' && f !== 'LT').map(([, v]) => v),
    );
    expect((params.phi['RP'] ?? 0) - peerMed).toBeGreaterThan(0.3);
  });

  it('does not hallucinate strong bigram coefficients from a clean typist', () => {
    // δ carries a 4× penalty exactly so noise never earns a coefficient (§7.2).
    const stream = simulateTyping(
      defaultProfile({ noiseSigma: 0.2, hesitationRate: 0, errorRateAtSpeed: () => 0 }),
      TEXT, qwertyUs, { seed: 21 },
    );
    const block = analyzeBlock(stream, qwertyUs, TEXT);
    const params = fitModel(extractObservations(block.keystrokes, qwertyUs, 1), ZERO_PRIOR);
    const bigDeltas = Object.values(params.delta).filter((v) => Math.abs(v) > 0.25);
    expect(bigDeltas.length).toBeLessThan(3);
  });

  it('shrinks toward the population prior when data is thin', () => {
    const stream = simulateTyping(defaultProfile(), TEXT.slice(0, 60), qwertyUs, { seed: 2 });
    const block = analyzeBlock(stream, qwertyUs, TEXT.slice(0, 60));
    const params = fitModel(extractObservations(block.keystrokes, qwertyUs, 1), POPULATION_PRIOR);
    // Unobserved-but-primed effects keep prior-shaped values: sfb penalty positive.
    expect(params.sigmaSfb).toBeGreaterThan(0);
  });

  it('predictions are calibrated: mean predicted IKI ≈ mean observed IKI', () => {
    const obs = observationsFor('plateauedOverdriver', 13);
    const params = fitModel(obs, ZERO_PRIOR);
    const predMean = obs.reduce((s, o) => s + Math.exp(predictLogIki(params, o)), 0) / obs.length;
    const obsMean = obs.reduce((s, o) => s + Math.exp(o.logIki), 0) / obs.length;
    expect(predMean / obsMean).toBeGreaterThan(0.9);
    expect(predMean / obsMean).toBeLessThan(1.1);
  });
});

describe('counterfactual cost (PRD §7.4)', () => {
  it('matches the closed form ΔWPM ≈ WPM·f·(k−1) for a single planted effect', () => {
    // A typist whose right-pinky keys are 1.5× slower, RP corpus share 10%.
    const params = {
      mu: Math.log(150),
      kappa: {}, phi: { RP: Math.log(1.5) },
      etaSameHand: 0, sigmaSfb: 0, rho: {}, delta: {},
      se: { kappa: {}, phi: {}, etaSameHand: 0, sigmaSfb: 0, rho: {}, delta: {} },
      counts: { kappa: {}, phi: {}, etaSameHand: 0, sigmaSfb: 0, rho: {}, delta: {}, sessions: {} },
      sigmaEps: 0.2, residualMad: 0.13, nObs: 1000,
    };
    // 'vp': v→p targets RP (alternating hands, no sfb, row jump 1... use e→p).
    const freqs = new Map<string, number>([
      ['ep', 0.10], // target key p = RP
      ['th', 0.45],
      ['he', 0.45],
    ]);
    // Neutralize non-φ features for exactness: e→p rowJump 1 — zero rho anyway.
    const mActual = corpusMeanIki(params, freqs, qwertyUs);
    const wpmActual = 12 / (mActual / 1000);
    const delta = estimateCost({ type: 'finger', finger: 'RP' }, params, freqs, qwertyUs);
    const closedForm = wpmActual * 0.10 * (1.5 - 1);
    expect(delta).toBeCloseTo(closedForm, 1);
    expect(delta).toBeGreaterThan(0);
  });

  it('PRD §7.4 sanity: single-finger claims stay single-digit for plausible inputs', () => {
    // 72-WPM-class typist, pinky 1.96× slower, 8% share ⇒ ~5.5 WPM, never 10+.
    const params = {
      mu: Math.log(160),
      kappa: {}, phi: { RP: Math.log(1.96) },
      etaSameHand: 0, sigmaSfb: 0, rho: {}, delta: {},
      se: { kappa: {}, phi: {}, etaSameHand: 0, sigmaSfb: 0, rho: {}, delta: {} },
      counts: { kappa: {}, phi: {}, etaSameHand: 0, sigmaSfb: 0, rho: {}, delta: {}, sessions: {} },
      sigmaEps: 0.2, residualMad: 0.13, nObs: 1000,
    };
    const freqs = new Map<string, number>([['ep', 0.08], ['th', 0.46], ['he', 0.46]]);
    const cost = estimateCost({ type: 'finger', finger: 'RP' }, params, freqs, qwertyUs);
    expect(cost).toBeGreaterThan(3);
    expect(cost).toBeLessThan(10);
  });

  it('transitionFrequencies normalizes over layout-covered bigrams', () => {
    const freqs = transitionFrequencies('ababa', qwertyUs);
    expect(freqs.get('ab')).toBeCloseTo(0.5, 10);
    expect(freqs.get('ba')).toBeCloseTo(0.5, 10);
    let sum = 0;
    for (const v of freqs.values()) sum += v;
    expect(sum).toBeCloseTo(1, 10);
  });
});
