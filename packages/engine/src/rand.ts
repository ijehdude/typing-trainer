/**
 * Seeded PRNG (mulberry32). The engine contains no unseeded randomness —
 * every stochastic component takes an explicit Rng (PRD §19.2, §19.7).
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Standard normal (Box–Muller). */
  gaussian(): number;
  /** Pick a uniform random element. */
  pick<T>(arr: readonly T[]): T;
  /** Pick an index by weight. */
  weightedIndex(weights: readonly number[]): number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spareGaussian: number | null = null;
  return {
    next,
    int: (n) => Math.floor(next() * n),
    gaussian: () => {
      if (spareGaussian !== null) {
        const g = spareGaussian;
        spareGaussian = null;
        return g;
      }
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      const r = Math.sqrt(-2 * Math.log(u));
      spareGaussian = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    },
    pick: (arr) => {
      if (arr.length === 0) throw new Error('pick from empty array');
      return arr[Math.floor(next() * arr.length)]!;
    },
    weightedIndex: (weights) => {
      let total = 0;
      for (const w of weights) total += w;
      let x = next() * total;
      for (let i = 0; i < weights.length; i++) {
        x -= weights[i]!;
        if (x <= 0) return i;
      }
      return weights.length - 1;
    },
  };
}
