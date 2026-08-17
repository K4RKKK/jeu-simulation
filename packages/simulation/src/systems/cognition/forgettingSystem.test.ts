import { describe, expect, it } from 'vitest';
import { CognitiveMemory } from '../../components/index.js';
import { Simulation } from '../../simulation.js';
import { ForgettingSystem } from './forgettingSystem.js';

function forgettingSimulation(seed: string): Simulation {
  return new Simulation({
    seed,
    population: 1,
    config: { time: { gameSecondsPerTick: 1 } },
    systems: [new ForgettingSystem()],
  });
}

describe('ForgettingSystem', () => {
  it("fait décroître la confiance d'un souvenir spatial non revu, après une longue période", () => {
    const simulation = forgettingSimulation('forgetting-decay');
    const [human] = simulation.humanIds();
    if (human === undefined) throw new Error('aucun humain');

    const memory = simulation.entities.getComponentOrThrow(human, CognitiveMemory);
    const config = simulation.config.cognition;
    memory.spatial.push({
      id: 0,
      kind: 'water',
      x: 0,
      z: 0,
      lastSeenTick: 0,
      confidence01: config.freshSpatialConfidence01,
      precisionM: config.freshSpatialPrecisionM,
      source: 'selfExperience',
    });
    memory.nextMemoryId = 1;

    // Une demi-vie complète, en ticks (gameSecondsPerTick = 1 ici).
    simulation.step(Math.ceil(config.spatialConfidenceHalfLifeSeconds));

    expect(memory.spatial).toHaveLength(1);
    expect(memory.spatial[0]!.confidence01).toBeLessThan(config.freshSpatialConfidence01);
    expect(memory.spatial[0]!.confidence01).toBeCloseTo(0.5, 1);
    expect(memory.spatial[0]!.precisionM).toBeGreaterThan(config.freshSpatialPrecisionM);
    simulation.dispose();
  });

  it('purge un souvenir spatial tombé sous la confiance minimale', () => {
    const simulation = forgettingSimulation('forgetting-prune');
    const [human] = simulation.humanIds();
    if (human === undefined) throw new Error('aucun humain');

    const memory = simulation.entities.getComponentOrThrow(human, CognitiveMemory);
    const config = simulation.config.cognition;
    memory.spatial.push({
      id: 0,
      kind: 'water',
      x: 0,
      z: 0,
      lastSeenTick: 0,
      confidence01: config.freshSpatialConfidence01,
      precisionM: config.freshSpatialPrecisionM,
      source: 'selfExperience',
    });
    memory.nextMemoryId = 1;

    // Largement au-delà du seuil de purge.
    simulation.step(Math.ceil(config.spatialConfidenceHalfLifeSeconds * 10));

    expect(memory.spatial).toHaveLength(0);
    simulation.dispose();
  });

  it('ne touche pas aux humains sans souvenir (aucun coût sur une mémoire vide)', () => {
    const simulation = forgettingSimulation('forgetting-empty');
    expect(() => simulation.step(1000)).not.toThrow();
    simulation.dispose();
  });
});
