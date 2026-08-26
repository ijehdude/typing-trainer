import { CONFIG, type EngineConfig } from '../config';
import type { AnalyzedKeystroke, TradeoffCurve } from '../types';

/**
 * The speed–accuracy tradeoff curve (PRD §7.5):
 *
 *   P(error) = logistic(α + β · localWPM)
 *
 * Local speed is the rolling WPM over ±localSpeedHalfWindow keystrokes.
 * From the fit we derive Control Speed (predicted accuracy crosses 97%) and
 * Collapse Speed (93%). Fitted by Newton–Raphson on the 2-parameter
 * log-likelihood — deterministic, a dozen iterations.
 */

export interface TradeoffPoint {
  localWpm: number;
  isError: boolean;
}

export function extractTradeoffPoints(
  keystrokes: readonly AnalyzedKeystroke[],
  cfg: EngineConfig = CONFIG,
): TradeoffPoint[] {
  const w = cfg.model.localSpeedHalfWindow;
  // Positions in first-attempt order (corrections excluded).
  const attempts: { t: number; isError: boolean }[] = [];
  const seen = new Set<number>();
  for (const ks of keystrokes) {
    if (ks.isCorrection || ks.repeat) continue;
    if (seen.has(ks.index)) continue;
    seen.add(ks.index);
    attempts.push({ t: ks.t, isError: !ks.correct });
  }

  const out: TradeoffPoint[] = [];
  for (let i = 0; i < attempts.length; i++) {
    const lo = Math.max(0, i - w);
    const hi = Math.min(attempts.length - 1, i + w);
    const span = attempts[hi]!.t - attempts[lo]!.t;
    const chars = hi - lo;
    if (chars < 4 || span <= 0 || span > chars * cfg.timing.ikiMaxMs) continue;
    const wpm = (chars / 5) / (span / 60_000);
    if (wpm > 0 && wpm < 300) out.push({ localWpm: wpm, isError: attempts[i]!.isError });
  }
  return out;
}

export function fitTradeoff(
  points: readonly TradeoffPoint[],
  currentWpm: number,
  cfg: EngineConfig = CONFIG,
): TradeoffCurve {
  const empty: TradeoffCurve = {
    alpha: 0, beta: 0, vControl: 0, vCollapse: 0, headroom: 0, r2: 0, n: points.length,
  };
  const nErrors = points.filter((p) => p.isError).length;
  if (points.length < 100 || nErrors < 8) return empty; // not enough signal

  // Standardize WPM for numeric stability.
  const mu = points.reduce((s, p) => s + p.localWpm, 0) / points.length;
  const sd = Math.sqrt(points.reduce((s, p) => s + (p.localWpm - mu) ** 2, 0) / points.length) || 1;

  let a = Math.log(Math.max(1e-6, nErrors / points.length) / (1 - nErrors / points.length));
  let b = 0;
  for (let iter = 0; iter < 25; iter++) {
    let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
    for (const p of points) {
      const x = (p.localWpm - mu) / sd;
      const eta = a + b * x;
      const pr = 1 / (1 + Math.exp(-eta));
      const y = p.isError ? 1 : 0;
      const wgt = pr * (1 - pr);
      ga += y - pr;
      gb += (y - pr) * x;
      haa += wgt;
      hab += wgt * x;
      hbb += wgt * x * x;
    }
    // Slight ridge on the Hessian keeps it invertible.
    haa += 1e-4; hbb += 1e-4;
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-12) break;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a += da;
    b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-10) break;
  }

  // De-standardize: α + β·wpm = a + b·(wpm − μ)/sd
  const beta = b / sd;
  const alpha = a - (b * mu) / sd;
  if (!(beta > 0)) return { ...empty, alpha, beta }; // error rate must rise with speed

  const wpmAtErrorRate = (pErr: number) =>
    (Math.log(pErr / (1 - pErr)) - alpha) / beta;
  const vControl = wpmAtErrorRate(1 - cfg.model.controlAccuracy);
  const vCollapse = wpmAtErrorRate(1 - cfg.model.collapseAccuracy);

  // McFadden pseudo-R² against the intercept-only model.
  const pBase = nErrors / points.length;
  let llFit = 0;
  let llBase = 0;
  for (const p of points) {
    const pr = 1 / (1 + Math.exp(-(alpha + beta * p.localWpm)));
    const y = p.isError ? 1 : 0;
    llFit += y * Math.log(Math.max(1e-12, pr)) + (1 - y) * Math.log(Math.max(1e-12, 1 - pr));
    llBase += y * Math.log(pBase) + (1 - y) * Math.log(1 - pBase);
  }
  const r2 = llBase === 0 ? 0 : Math.max(0, 1 - llFit / llBase);

  return {
    alpha,
    beta,
    vControl: clampWpm(vControl),
    vCollapse: clampWpm(vCollapse),
    headroom: clampWpm(vCollapse) - currentWpm,
    r2,
    n: points.length,
  };
}

function clampWpm(w: number): number {
  return Math.min(300, Math.max(0, w));
}
