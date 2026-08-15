import type { RegionCoordinate, ResourceSpawn } from '@civ/procedural';
import { describe, expect, it } from 'vitest';
import { Transform } from '../components/index.js';
import { Simulation } from '../simulation.js';
import { beginResourceInteraction } from './resourceInteraction.js';

function smallSimulation(seed: string, population = 0): Simulation {
  return new Simulation({
    seed,
    population,
    spawnInitialPopulation: population > 0,
    systems: [],
    generation: {
      layout: { sizeChunks: 4, terrainResolution: 8 },
      regions: { sizeChunks: 2 },
      resources: { globalDensity: 2, maxPerChunk: 256 },
    },
  });
}

function populatedRegion(simulation: Simulation): {
  coordinate: RegionCoordinate;
  spawn: ResourceSpawn;
} {
  for (const coordinate of [
    { x: -1, z: -1 },
    { x: 0, z: -1 },
    { x: -1, z: 0 },
    { x: 0, z: 0 },
  ]) {
    for (const chunkCoordinate of simulation.world.regions.chunkCoordinates(coordinate)) {
      const spawn = simulation.world.generator.generateChunk(chunkCoordinate).resources[0];
      if (spawn) return { coordinate, spawn };
    }
  }
  throw new Error('La petite carte de test ne contient aucune ressource');
}

describe('RegionAggregator', () => {
  it('agrège les chunks, le terrain, les biomes, l’eau et les ressources de base', () => {
    const simulation = smallSimulation('region-static');
    const stats = simulation.world.regions.staticStats({ x: 0, z: 0 });

    expect(stats.chunkKeys).toEqual(['0:0', '1:0', '0:1', '1:1']);
    expect(stats.chunkCount).toBe(4);
    expect(stats.sampleCount).toBe(4 * 8 * 8);
    expect(stats.elevationMinM).toBeLessThanOrEqual(stats.elevationMeanM);
    expect(stats.elevationMeanM).toBeLessThanOrEqual(stats.elevationMaxM);
    expect(stats.biomeSampleCounts.reduce((sum, count) => sum + (count ?? 0), 0)).toBe(
      stats.sampleCount,
    );
    expect(Object.values(stats.resourceCounts).reduce((sum, count) => sum + count, 0)).toBe(
      stats.resourceCount,
    );
    for (const ratio of [
      stats.slopeMean01,
      stats.temperatureMean01,
      stats.moistureMean01,
      stats.fertilityMean01,
      stats.rockinessMean01,
      stats.vegetationMean01,
      stats.walkableRatio,
      stats.waterCoverage01,
    ]) {
      expect(ratio).toBeGreaterThanOrEqual(0);
      expect(ratio).toBeLessThanOrEqual(1);
    }
    // Le coût procédural est payé une seule fois par région.
    expect(simulation.world.regions.staticStats({ x: 0, z: 0 })).toBe(stats);
    simulation.dispose();
  });

  it('dérive les ressources restantes depuis WorldDelta sans altérer les stats statiques', () => {
    const simulation = smallSimulation('region-resources');
    const { coordinate, spawn } = populatedRegion(simulation);
    const beforeStatic = simulation.world.regions.staticStats(coordinate);
    const beforeDynamic = simulation.world.regions.dynamicStats(coordinate);

    simulation.world.harvestResource(
      spawn.id,
      spawn.ownerChunkKey,
      spawn.localId,
      spawn.harvestServings,
      spawn.x,
      spawn.z,
      10,
    );
    const after = simulation.world.regions.dynamicStats(coordinate);

    expect(simulation.world.regions.staticStats(coordinate)).toBe(beforeStatic);
    expect(after.resourceRemainingEquivalent).toBeCloseTo(
      beforeDynamic.resourceRemainingEquivalent - 1 / spawn.harvestServings,
    );
    if (spawn.harvestServings === 1) {
      expect(after.resourceDepletedCount).toBe(1);
      expect(after.resourceAvailableCount).toBe(beforeDynamic.resourceAvailableCount - 1);
    } else {
      expect(after.resourceModifiedCount).toBe(1);
      expect(after.resourceAvailableCount).toBe(beforeDynamic.resourceAvailableCount);
    }
    simulation.dispose();
  });

  it('compte la population, les ressources interactives et l’usure des sentiers', () => {
    const simulation = smallSimulation('region-dynamic-ecs', 1);
    const { spawn } = populatedRegion(simulation);
    const coordinate = simulation.world.regionAt(spawn.x, spawn.z);
    const human = simulation.humanIds()[0]!;
    const transform = simulation.entities.getComponentOrThrow(human, Transform);
    transform.x = spawn.x;
    transform.z = spawn.z;
    transform.y = spawn.y;
    beginResourceInteraction(
      simulation.entities,
      simulation.world,
      human,
      spawn.id,
      spawn.ownerChunkKey,
      5,
    );
    simulation.world.recordFootTraffic(spawn.x, spawn.z, spawn.x + 5, spawn.z);

    const stats = simulation.world.regions.dynamicStats(coordinate, simulation.entities);

    expect(stats.humanCount).toBe(1);
    expect(stats.interactiveResourceCount).toBe(1);
    expect(stats.trailWornCellCount).toBeGreaterThan(0);
    expect(stats.trailMeanWear01).toBeGreaterThan(0);
    simulation.dispose();
  });

  it('retrouve les mêmes statistiques dynamiques après sauvegarde et restauration', () => {
    const source = smallSimulation('region-persistence', 1);
    const { coordinate, spawn } = populatedRegion(source);
    const human = source.humanIds()[0]!;
    const transform = source.entities.getComponentOrThrow(human, Transform);
    transform.x = coordinate.x * 128 + 10;
    transform.z = coordinate.z * 128 + 10;
    transform.y = source.world.heightAt(transform.x, transform.z);
    source.world.harvestResource(
      spawn.id,
      spawn.ownerChunkKey,
      spawn.localId,
      spawn.harvestServings,
      spawn.x,
      spawn.z,
      20,
    );
    source.world.recordFootTraffic(transform.x, transform.z, transform.x + 5, transform.z);
    const expected = source.world.regions.dynamicStats(coordinate, source.entities);
    const snapshot = source.captureSnapshot();

    const restored = smallSimulation('region-persistence');
    restored.restoreSnapshot(snapshot);

    expect(restored.world.regions.dynamicStats(coordinate, restored.entities)).toEqual(expected);
    source.dispose();
    restored.dispose();
  });

  it('refuse clairement une région entièrement hors du monde', () => {
    const simulation = smallSimulation('region-outside');
    expect(() => simulation.world.regions.staticStats({ x: 99, z: 99 })).toThrow(
      'outside world bounds',
    );
    simulation.dispose();
  });
});
