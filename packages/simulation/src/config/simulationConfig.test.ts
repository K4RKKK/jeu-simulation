import { describe, expect, it } from 'vitest';
import { DEFAULT_SIMULATION_CONFIG, createSimulationConfig } from './simulationConfig.js';

describe('createSimulationConfig', () => {
  it('returns the defaults when nothing is overridden', () => {
    expect(createSimulationConfig()).toEqual(DEFAULT_SIMULATION_CONFIG);
  });

  it('merges overrides section by section without dropping siblings', () => {
    const config = createSimulationConfig({ humans: { initialPopulation: 42 } });

    expect(config.humans.initialPopulation).toBe(42);
    expect(config.humans.meanAgeYears).toBe(DEFAULT_SIMULATION_CONFIG.humans.meanAgeYears);
    expect(config.movement).toEqual(DEFAULT_SIMULATION_CONFIG.movement);
  });

  it('merges nested records such as scheduler intervals', () => {
    const config = createSimulationConfig({ scheduler: { intervals: { slow: 50 } } });

    expect(config.scheduler.intervals.slow).toBe(50);
    expect(config.scheduler.intervals.fast).toBe(
      DEFAULT_SIMULATION_CONFIG.scheduler.intervals.fast,
    );
  });

  it('does not mutate the shared defaults', () => {
    const config = createSimulationConfig({ wander: { minIdleSeconds: 1 } });
    config.wander.maxIdleSeconds = 999;

    expect(DEFAULT_SIMULATION_CONFIG.wander.minIdleSeconds).toBe(20);
    expect(DEFAULT_SIMULATION_CONFIG.wander.maxIdleSeconds).toBe(240);
  });
});
