import { CONFIG, type EngineConfig } from '../config';
import { mad } from '../metrics/index';
import type { Observation } from './observations';

/**
 * The additive log-IKI attribution model (PRD §7.2):
 *
 *   log(IKI) = μ + κ_target(b) + φ_finger(f(b)) + η_hand + σ_sfb + ρ_row + δ_bigram + ε
 *
 * Fitted by block-coordinate descent: each one-hot coefficient group has a
 * closed-form ridge update given the residuals of the others, shrunk toward
 * the population prior — `coef = (Σ resid + λ·prior) / (n + λ)`. Fully
 * deterministic, no learning rate, converges in a handful of sweeps.
 */

export interface ModelPrior {
  kappa: Record<string, number>;
  phi: Record<string, number>;
  etaSameHand: number;
  sigmaSfb: number;
  rho: Record<string, number>; // by jump distance '1' | '2' | '3'
}

export const ZERO_PRIOR: ModelPrior = {
  kappa: {}, phi: {}, etaSameHand: 0, sigmaSfb: 0, rho: {},
};

export interface ModelParams {
  mu: number;
  kappa: Record<string, number>;
  phi: Record<string, number>;
  etaSameHand: number;
  sigmaSfb: number;
  rho: Record<string, number>;
  delta: Record<string, number>;       // per-bigram residual coefficient
  se: {
    kappa: Record<string, number>;
    phi: Record<string, number>;
    etaSameHand: number;
    sigmaSfb: number;
    rho: Record<string, number>;
    delta: Record<string, number>;
  };
  counts: {
    kappa: Record<string, number>;
    phi: Record<string, number>;
    etaSameHand: number;
    sigmaSfb: number;
    rho: Record<string, number>;
    delta: Record<string, number>;
    /** distinct sessions contributing per feature family key. */
    sessions: Record<string, number>;
  };
  sigmaEps: number;      // residual std estimate (from MAD, robust)
  residualMad: number;   // MAD of residuals in log space (rhythm input)
  nObs: number;
}

const SWEEPS = 8;

export function fitModel(
  obs: readonly Observation[],
  prior: ModelPrior = ZERO_PRIOR,
  cfg: EngineConfig = CONFIG,
): ModelParams {
  const { lambda, lambdaDelta } = cfg.model;
  const n = obs.length;

  const kappa = new Map<string, number>();
  const phi = new Map<string, number>();
  const rho = new Map<string, number>();
  const delta = new Map<string, number>();
  let mu = 0;
  let eta = 0;
  let sigma = 0;

  const bigramOf = (o: Observation) => o.prevChar + o.char;
  const rhoKeyOf = (o: Observation) => (o.rowJump > 0 ? String(o.rowJump) : null);

  const predictWithout = (o: Observation, skip: string): number => {
    let p = skip === 'mu' ? 0 : mu;
    if (skip !== 'kappa') p += kappa.get(o.char) ?? 0;
    if (skip !== 'phi' && o.finger) p += phi.get(o.finger) ?? 0;
    if (skip !== 'eta' && o.sameHand) p += eta;
    if (skip !== 'sigma' && o.sfb) p += sigma;
    const rk = rhoKeyOf(o);
    if (skip !== 'rho' && rk) p += rho.get(rk) ?? 0;
    if (skip !== 'delta') p += delta.get(bigramOf(o)) ?? 0;
    return p;
  };

  // κ and φ are collinear (every key belongs to exactly one finger), and
  // plain coordinate descent lets whichever updates first absorb shared
  // variance. We identify the decomposition the way the PRD defines it —
  // κ is the *intrinsic* cost of a key beyond its finger's cost — by
  // centering κ within each finger group (count-weighted) after each κ
  // sweep, so finger-level structure flows to φ. φ is likewise centered
  // into μ.
  const fingerOfChar = new Map<string, string>();
  const obsCountByChar = new Map<string, number>();
  for (const o of obs) {
    if (o.finger) fingerOfChar.set(o.char, o.finger);
    obsCountByChar.set(o.char, (obsCountByChar.get(o.char) ?? 0) + 1);
  }

  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    // μ — unpenalized global mean of residuals.
    if (n > 0) {
      let s = 0;
      for (const o of obs) s += o.logIki - predictWithout(o, 'mu');
      mu = s / n;
    }
    updateGroup(obs, kappa, (o) => o.char, predictWithout, 'kappa', lambda, prior.kappa);
    centerWithinGroups(kappa, fingerOfChar, obsCountByChar);
    updateGroup(obs, phi, (o) => o.finger, predictWithout, 'phi', lambda, prior.phi);
    eta = updateScalar(obs, (o) => o.sameHand, predictWithout, 'eta', lambda, prior.etaSameHand);
    sigma = updateScalar(obs, (o) => o.sfb, predictWithout, 'sigma', lambda, prior.sigmaSfb);
    updateGroup(obs, rho, rhoKeyOf, predictWithout, 'rho', lambda, prior.rho);
    updateGroup(obs, delta, bigramOf, predictWithout, 'delta', lambdaDelta, {});
  }

  // Residuals and robust noise scale.
  const residuals = obs.map((o) => o.logIki - predictWithout(o, 'none'));
  const rMad = mad(residuals);
  const sigmaEps = rMad * 1.4826; // MAD → σ under normality

  // Counts and standard errors: SE ≈ σ_ε / √(n_level + λ).
  const counts = {
    kappa: countBy(obs, (o) => o.char),
    phi: countBy(obs, (o) => o.finger),
    etaSameHand: obs.filter((o) => o.sameHand).length,
    sigmaSfb: obs.filter((o) => o.sfb).length,
    rho: countBy(obs, rhoKeyOf),
    delta: countBy(obs, bigramOf),
    sessions: sessionCounts(obs),
  };
  const seOf = (nLevel: number, lam: number) => sigmaEps / Math.sqrt(nLevel + lam);
  const seMap = (cs: Record<string, number>, lam: number) =>
    Object.fromEntries(Object.entries(cs).map(([k, c]) => [k, seOf(c, lam)]));

  return {
    mu,
    kappa: Object.fromEntries(kappa),
    phi: Object.fromEntries(phi),
    etaSameHand: eta,
    sigmaSfb: sigma,
    rho: Object.fromEntries(rho),
    delta: Object.fromEntries(delta),
    se: {
      kappa: seMap(counts.kappa, lambda),
      phi: seMap(counts.phi, lambda),
      etaSameHand: seOf(counts.etaSameHand, lambda),
      sigmaSfb: seOf(counts.sigmaSfb, lambda),
      rho: seMap(counts.rho, lambda),
      delta: seMap(counts.delta, lambdaDelta),
    },
    counts,
    sigmaEps,
    residualMad: rMad,
    nObs: n,
  };
}

/** Predicted log-IKI for a transition under fitted params. */
export function predictLogIki(
  params: ModelParams,
  o: Pick<Observation, 'prevChar' | 'char' | 'finger' | 'sameHand' | 'sfb' | 'rowJump'>,
): number {
  let p = params.mu;
  p += params.kappa[o.char] ?? 0;
  if (o.finger) p += params.phi[o.finger] ?? 0;
  if (o.sameHand) p += params.etaSameHand;
  if (o.sfb) p += params.sigmaSfb;
  if (o.rowJump > 0) p += params.rho[String(o.rowJump)] ?? 0;
  p += params.delta[o.prevChar + o.char] ?? 0;
  return p;
}

export function residualsOf(params: ModelParams, obs: readonly Observation[]): number[] {
  return obs.map((o) => o.logIki - predictLogIki(params, o));
}

// --- fitting helpers ------------------------------------------------------

function updateGroup(
  obs: readonly Observation[],
  coefs: Map<string, number>,
  keyOf: (o: Observation) => string | null,
  predictWithout: (o: Observation, skip: string) => number,
  skip: string,
  lam: number,
  prior: Record<string, number>,
): void {
  const sums = new Map<string, { s: number; n: number }>();
  for (const o of obs) {
    const k = keyOf(o);
    if (k === null) continue;
    const e = sums.get(k) ?? { s: 0, n: 0 };
    e.s += o.logIki - predictWithout(o, skip);
    e.n += 1;
    sums.set(k, e);
  }
  coefs.clear();
  for (const [k, { s, n }] of sums) {
    coefs.set(k, (s + lam * (prior[k] ?? 0)) / (n + lam));
  }
}

function updateScalar(
  obs: readonly Observation[],
  active: (o: Observation) => boolean,
  predictWithout: (o: Observation, skip: string) => number,
  skip: string,
  lam: number,
  prior: number,
): number {
  let s = 0;
  let n = 0;
  for (const o of obs) {
    if (!active(o)) continue;
    s += o.logIki - predictWithout(o, skip);
    n += 1;
  }
  return (s + lam * prior) / (n + lam);
}

/** Remove the count-weighted mean of each group from its members' coefficients. */
function centerWithinGroups(
  coefs: Map<string, number>,
  groupOf: Map<string, string>,
  countOf: Map<string, number>,
): void {
  const acc = new Map<string, { s: number; n: number }>();
  for (const [key, v] of coefs) {
    const g = groupOf.get(key);
    if (!g) continue;
    const w = countOf.get(key) ?? 1;
    const e = acc.get(g) ?? { s: 0, n: 0 };
    e.s += v * w;
    e.n += w;
    acc.set(g, e);
  }
  for (const [key, v] of coefs) {
    const g = groupOf.get(key);
    if (!g) continue;
    const e = acc.get(g)!;
    if (e.n > 0) coefs.set(key, v - e.s / e.n);
  }
}

function countBy(
  obs: readonly Observation[],
  keyOf: (o: Observation) => string | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of obs) {
    const k = keyOf(o);
    if (k !== null) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Distinct session count per feature key ('key:a', 'finger:RP', 'bigram:io', …). */
function sessionCounts(obs: readonly Observation[]): Record<string, number> {
  const sets = new Map<string, Set<number>>();
  const add = (k: string, s: number) => {
    let set = sets.get(k);
    if (!set) sets.set(k, (set = new Set()));
    set.add(s);
  };
  for (const o of obs) {
    add(`key:${o.char}`, o.sessionId);
    if (o.finger) add(`finger:${o.finger}`, o.sessionId);
    add(`bigram:${o.prevChar + o.char}`, o.sessionId);
    if (o.sfb) add('class:sfb', o.sessionId);
    if (o.sameHand) add('class:same_hand', o.sessionId);
    if (o.rowJump > 0) add(`class:row_jump_${o.rowJump}`, o.sessionId);
  }
  const out: Record<string, number> = {};
  for (const [k, s] of sets) out[k] = s.size;
  return out;
}
