import { describe, expect, it } from 'vitest';
import { DEFAULT_SIMULATION_CONFIG } from '../config/simulationConfig.js';
import { SimulationClock } from '../core/clock.js';
import { Environment } from './environment.js';

// startHourOfDay = 0 pour que `clockAtHour(h)` désigne bien l'heure h.
const timeConfig = { ...DEFAULT_SIMULATION_CONFIG.time, gameSecondsPerTick: 1, startHourOfDay: 0 };

function clockAtHour(hour: number): SimulationClock {
  const clock = new SimulationClock(timeConfig);
  clock.advance(Math.round(hour * 3600));
  return clock;
}

describe('Environment', () => {
  const environment = new Environment(DEFAULT_SIMULATION_CONFIG.environment);

  it('is dark at night and lit during the day', () => {
    expect(environment.sample(clockAtHour(3)).isDaytime).toBe(false);
    expect(environment.sample(clockAtHour(13)).isDaytime).toBe(true);
    expect(environment.sample(clockAtHour(23)).isDaytime).toBe(false);
  });

  it('puts the sun highest around midday and lowest around midnight', () => {
    const noon = environment.sample(clockAtHour(13)).sunElevation;
    const midnight = environment.sample(clockAtHour(1)).sunElevation;

    expect(noon).toBeGreaterThan(0.9);
    expect(midnight).toBeLessThan(0);
  });

  it('is colder at dawn than in the afternoon', () => {
    const dawn = environment.sample(clockAtHour(5)).ambientTemperatureC;
    const afternoon = environment.sample(clockAtHour(15)).ambientTemperatureC;
    expect(afternoon).toBeGreaterThan(dawn);
  });

  it('is a pure function of the clock', () => {
    const first = environment.sample(clockAtHour(9));
    const second = environment.sample(clockAtHour(9));
    expect(first).toEqual(second);
  });

  it('keeps the sun elevation within its normalized range', () => {
    for (let hour = 0; hour < 24; hour += 0.25) {
      const { sunElevation } = environment.sample(clockAtHour(hour));
      expect(sunElevation).toBeGreaterThanOrEqual(-1);
      expect(sunElevation).toBeLessThanOrEqual(1);
    }
  });

  it('names the seasons in phase with the thermal cycle', () => {
    const seasonAt = (yearProgress: number): string =>
      environment.seasonName(clockWithProgress(yearProgress));

    // Le cycle thermique est le plus froid à 0 et le plus chaud à 0,5.
    expect(seasonAt(0)).toBe('hiver');
    expect(seasonAt(0.3)).toBe('printemps');
    expect(seasonAt(0.6)).toBe('été');
    expect(seasonAt(0.9)).toBe('automne');
  });

  it('exposes the season in the snapshot', () => {
    expect(environment.toSnapshot(clockAtHour(9)).season).toBe('hiver');
  });

  it('integrates the spatial climate when asked for a position', () => {
    // Fournisseur « montagne » (froid) en z < 0, « vallée » (chaud) en z > 0, neutre en z = 0.
    const spatial = new Environment(DEFAULT_SIMULATION_CONFIG.environment, (_x, z) =>
      z > 0 ? 0.8 : z < 0 ? 0.2 : 0.5,
    );

    const peak = spatial.sample(clockAtHour(12), 0, -100);
    const valley = spatial.sample(clockAtHour(12), 0, 100);
    const generic = spatial.sample(clockAtHour(12));

    expect(peak.ambientTemperatureC).toBeLessThan(valley.ambientTemperatureC);
    // Sans position, l'environnement reste global : la moyenne du monde (0,5) ne décale rien.
    expect(generic.ambientTemperatureC).toBe(
      spatial.sample(clockAtHour(12), 0, 0).ambientTemperatureC,
    );
  });
});

function clockWithProgress(yearProgress: number): SimulationClock {
  const clock = new SimulationClock(timeConfig);
  clock.advance(Math.round(yearProgress * 365 * 24 * 3600));
  return clock;
}
