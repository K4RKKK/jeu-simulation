import { describe, expect, it } from 'vitest';
import { DEFAULT_SIMULATION_CONFIG } from '../../config/simulationConfig.js';
import { attemptCountForPerseverance, maxSlopeForCaution } from './wanderTraits.js';

const wander = DEFAULT_SIMULATION_CONFIG.wander;

describe('maxSlopeForCaution', () => {
  it('gives cautious individuals a flatter limit than audacious ones', () => {
    const cautious = maxSlopeForCaution(1, wander);
    const audacious = maxSlopeForCaution(0, wander);
    expect(cautious).toBeLessThan(audacious);
  });

  it('stays inside the declared range for every caution value', () => {
    for (let caution = 0; caution <= 1; caution += 0.05) {
      const limit = maxSlopeForCaution(caution, wander);
      expect(limit).toBeGreaterThanOrEqual(wander.cautiousMaxSlope01);
      expect(limit).toBeLessThanOrEqual(wander.audaciousMaxSlope01);
    }
  });

  it('is monotonic in caution', () => {
    expect(maxSlopeForCaution(0.8, wander)).toBeLessThan(maxSlopeForCaution(0.2, wander));
  });
});

describe('attemptCountForPerseverance', () => {
  it('lets perseverant individuals try more destinations', () => {
    const patient = attemptCountForPerseverance(1, wander);
    const resigned = attemptCountForPerseverance(0, wander);
    expect(patient).toBeGreaterThan(resigned);
  });

  it('never returns fewer than one attempt', () => {
    for (let perseverance = 0; perseverance <= 1; perseverance += 0.05) {
      expect(attemptCountForPerseverance(perseverance, wander)).toBeGreaterThanOrEqual(1);
    }
  });

  it('is centered on the configured base at perseverance 0.5', () => {
    const centered = attemptCountForPerseverance(0.5, wander);
    const expectation = Math.round(
      wander.maxTargetAttempts * ((wander.attemptScaleMin + wander.attemptScaleMax) / 2),
    );
    expect(centered).toBe(expectation);
  });
});