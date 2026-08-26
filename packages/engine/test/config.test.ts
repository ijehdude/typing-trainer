import { describe, expect, it } from 'vitest';
import { CONFIG, configHash, retentionFactor } from '../src/config';

describe('config', () => {
  it('is deep-frozen', () => {
    expect(Object.isFrozen(CONFIG)).toBe(true);
    expect(Object.isFrozen(CONFIG.srs)).toBe(true);
    expect(Object.isFrozen(CONFIG.skill.weights)).toBe(true);
  });

  it('configHash is a stable 8-hex string', () => {
    const h1 = configHash();
    const h2 = configHash();
    expect(h1).toMatch(/^[0-9a-f]{8}$/);
    expect(h1).toBe(h2);
  });

  it('composite weights sum to 1', () => {
    const w = CONFIG.skill.weights;
    const sum = w.speed + w.accuracy + w.consistency + w.rhythm + w.weakKeyControl + w.punctuation;
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('RETENTION_FACTOR is the derived ≈4.51 (PRD §9.4)', () => {
    expect(retentionFactor()).toBeCloseTo(4.51, 1);
  });
});
