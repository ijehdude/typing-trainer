/**
 * Population prior for the attribution model (PRD §7.2 cold start).
 * Log-space multiplicative effects, derived from published keystroke-dynamics
 * regularities (pinky/ring slowness, SFB penalty, row-reach costs, symbol
 * costs). Ridge shrinks a thin-data user toward these values; they are
 * replaced by aggregated anonymous data once we have volume.
 */
export interface PopulationPrior {
  kappa: Record<string, number>;
  phi: Record<string, number>;
  etaSameHand: number;
  sigmaSfb: number;
  rho: Record<string, number>;
}

export const POPULATION_PRIOR: PopulationPrior = {
  phi: {
    LP: 0.10, RP: 0.12,
    LR: 0.05, RR: 0.06,
    LM: 0.0, RM: 0.0,
    LI: -0.03, RI: -0.03,
    LT: 0.0, RT: 0.0,
  },
  kappa: {
    q: 0.15, z: 0.20, x: 0.12, j: 0.08,
    ';': 0.18, "'": 0.15, '/': 0.15, '\\': 0.35,
    '[': 0.35, ']': 0.35, '-': 0.20, '=': 0.28,
    '0': 0.28, '1': 0.25, '2': 0.24, '3': 0.24, '4': 0.26, '5': 0.26,
    '6': 0.28, '7': 0.27, '8': 0.25, '9': 0.25,
    '`': 0.40,
  },
  etaSameHand: 0.03,
  sigmaSfb: 0.30,
  rho: { '1': 0.03, '2': 0.10, '3': 0.15 },
};
