import { environmentSnapshotSchema } from '@civ/shared';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation.js';

function weatherSimulation(seed: string): Simulation {
  return new Simulation({
    seed,
    spawnInitialPopulation: false,
    systems: [],
    generation: {
      layout: { sizeChunks: 4, terrainResolution: 8 },
      regions: { sizeChunks: 2 },
    },
  });
}

function setGameSeconds(simulation: Simulation, totalGameSeconds: number): void {
  simulation.clock.setState({
    currentTick: Math.floor(totalGameSeconds / simulation.clock.gameSecondsPerTick),
    totalGameSeconds,
    timeScale: 1,
    paused: false,
  });
}

describe('RegionalWeather', () => {
  it('produit des valeurs bornées et un snapshot réseau valide', () => {
    const simulation = weatherSimulation('weather-bounds');
    const snapshot = simulation.world.environmentSnapshot();
    const parsed = environmentSnapshotSchema.parse(snapshot);

    expect(parsed.weather).toBeDefined();
    expect(parsed.weather!.precipitation01).toBeGreaterThanOrEqual(0);
    expect(parsed.weather!.precipitation01).toBeLessThanOrEqual(1);
    expect(parsed.weather!.visibility01).toBeGreaterThanOrEqual(0);
    expect(parsed.weather!.visibility01).toBeLessThanOrEqual(1);
    expect(parsed.ambientTemperatureC).toBeCloseTo(
      simulation.world.environment.sample(simulation.clock, 0, 0).ambientTemperatureC +
        parsed.weather!.temperatureDeltaC,
      2,
    );
    simulation.dispose();
  });

  it('est déterministe pour une même seed, une même région et un même instant', () => {
    const first = weatherSimulation('weather-deterministic');
    const second = weatherSimulation('weather-deterministic');
    setGameSeconds(first, 37 * 3600 + 123);
    setGameSeconds(second, 37 * 3600 + 123);

    expect(first.world.environmentAt(20, 20)).toEqual(second.world.environmentAt(20, 20));
    first.dispose();
    second.dispose();
  });

  it('fait varier le temps entre régions sans synchroniser artificiellement tout le monde', () => {
    const simulation = weatherSimulation('weather-regional');
    setGameSeconds(simulation, 19 * 3600);

    const west = simulation.world.environmentAt(-100, -100).weather;
    const east = simulation.world.environmentAt(100, 100).weather;

    expect({
      precipitation01: west.precipitation01,
      cloudCover01: west.cloudCover01,
      windMps: west.windMps,
      temperatureDeltaC: west.temperatureDeltaC,
    }).not.toEqual({
      precipitation01: east.precipitation01,
      cloudCover01: east.cloudCover01,
      windMps: east.windMps,
      temperatureDeltaC: east.temperatureDeltaC,
    });
    simulation.dispose();
  });

  it('reste continue à la frontière de deux périodes météorologiques', () => {
    const simulation = weatherSimulation('weather-transition');
    const periodSeconds = simulation.config.weather.periodHours * 3600;
    setGameSeconds(simulation, periodSeconds - 1);
    const before = simulation.world.environmentAt(10, 10).weather;
    setGameSeconds(simulation, periodSeconds);
    const after = simulation.world.environmentAt(10, 10).weather;

    expect(Math.abs(before.precipitation01 - after.precipitation01)).toBeLessThan(0.01);
    expect(Math.abs(before.cloudCover01 - after.cloudCover01)).toBeLessThan(0.01);
    expect(Math.abs(before.windMps - after.windMps)).toBeLessThan(0.01);
    simulation.dispose();
  });

  it('retombe sur la même météo après sauvegarde et restauration sans état dédié', () => {
    const source = weatherSimulation('weather-persistence');
    setGameSeconds(source, 73 * 3600 + 777);
    const expected = source.world.environmentAt(-50, 50);
    const snapshot = source.captureSnapshot();
    const restored = weatherSimulation('weather-persistence');
    restored.restoreSnapshot(snapshot);

    expect(restored.world.environmentAt(-50, 50)).toEqual(expected);
    source.dispose();
    restored.dispose();
  });
});
