import { parseChunkKey, type ResourceSpawn } from '@civ/procedural';
import { describe, expect, it } from 'vitest';
import type { SimulationSnapshot } from '../persistence/simulationSnapshot.js';
import { Simulation } from '../simulation.js';
import { EcologySystem } from './ecologySystem.js';

function ecologySimulation(seed: string): Simulation {
  return new Simulation({
    seed,
    spawnInitialPopulation: false,
    systems: [new EcologySystem()],
    config: {
      ecology: {
        minRegrowthDays: 0,
        maxRegrowthDays: 0,
        minGrowthPotential01: 0,
        maxRegrowthPerUpdate: 4,
      },
    },
    generation: {
      layout: { sizeChunks: 4, terrainResolution: 8 },
      regions: { sizeChunks: 2 },
      resources: { globalDensity: 2, maxPerChunk: 256 },
    },
  });
}

function firstResource(simulation: Simulation): ResourceSpawn {
  for (const coordinate of simulation.world.bounds.allChunks()) {
    const spawn = simulation.world.generator.generateChunk(coordinate).resources[0];
    if (spawn) return spawn;
  }
  throw new Error('Aucune ressource dans le monde de test');
}

/**
 * Certaines ressources par défaut (pierre, arbres, bois mort…) portent maintenant
 * `renewalMode: 'none'` et ne repoussent jamais (voir `defaultResources.ts`) — les tests
 * qui vérifient la repousse elle-même ont besoin d'une ressource qui repousse
 * effectivement, pas de la première trouvée au hasard.
 */
function firstRenewableResource(simulation: Simulation): ResourceSpawn {
  for (const coordinate of simulation.world.bounds.allChunks()) {
    const spawn = simulation.world.generator
      .generateChunk(coordinate)
      .resources.find((candidate) => candidate.renewalMode === 'regrowWhenDepleted');
    if (spawn) return spawn;
  }
  throw new Error('Aucune ressource renouvelable dans le monde de test');
}

/** Symétrique de `firstRenewableResource` : une ressource qui ne repousse jamais. */
function firstNonRenewableResource(simulation: Simulation): ResourceSpawn {
  for (const coordinate of simulation.world.bounds.allChunks()) {
    const spawn = simulation.world.generator
      .generateChunk(coordinate)
      .resources.find((candidate) => candidate.renewalMode === 'none');
    if (spawn) return spawn;
  }
  throw new Error('Aucune ressource non renouvelable dans le monde de test');
}

describe('EcologySystem', () => {
  it('fait réellement repousser une ressource épuisée et journalise resource:added', () => {
    const simulation = ecologySimulation('ecology-regrowth');
    const spawn = firstRenewableResource(simulation);
    simulation.world.recordResourceRemoval(
      spawn.id,
      spawn.ownerChunkKey,
      spawn.localId,
      spawn.x,
      spawn.z,
      0,
    );
    simulation.world.journal.consumeRemovals();

    const ecologyInterval = simulation.config.scheduler.intervals.verySlow;
    simulation.step(ecologyInterval);

    expect(simulation.world.delta.has(spawn.id)).toBe(false);
    expect(simulation.world.findResourceById(spawn.id, spawn.ownerChunkKey)).not.toBeNull();
    expect(simulation.world.journal.consumeResourceAdditions()).toEqual([
      {
        resourceId: spawn.id,
        ownerChunkKey: spawn.ownerChunkKey,
        localId: spawn.localId,
        changedFields: { remainingFraction01: 1 },
        tick: ecologyInterval,
      },
    ]);
    simulation.dispose();
  });

  it('ne fait jamais repousser une ressource dont renewalMode vaut "none"', () => {
    const simulation = ecologySimulation('ecology-no-renewal');
    const spawn = firstNonRenewableResource(simulation);
    simulation.world.recordResourceRemoval(
      spawn.id,
      spawn.ownerChunkKey,
      spawn.localId,
      spawn.x,
      spawn.z,
      0,
    );
    simulation.world.journal.consumeRemovals();

    simulation.step(simulation.config.scheduler.intervals.verySlow * 10);

    expect(simulation.world.delta.get(spawn.id)?.state).toBe('depleted');
    expect(simulation.world.journal.consumeResourceAdditions()).toEqual([]);
    simulation.dispose();
  });

  it('ne fait jamais repousser une ressource supprimée définitivement', () => {
    const simulation = ecologySimulation('ecology-removed');
    const spawn = firstResource(simulation);
    simulation.world.delta.markRemoved(spawn.id, spawn.ownerChunkKey, spawn.localId, 0);

    simulation.step(1_000);

    expect(simulation.world.delta.get(spawn.id)?.state).toBe('removed');
    expect(simulation.world.journal.consumeResourceAdditions()).toEqual([]);
    simulation.dispose();
  });

  it('régénère aussi une ressource seulement partiellement récoltée', () => {
    const simulation = ecologySimulation('ecology-partial-regrowth');
    const spawn = firstRenewableResource(simulation);
    simulation.world.delta.patch(
      spawn.id,
      spawn.ownerChunkKey,
      spawn.localId,
      { remainingFraction01: 0.5 },
      0,
    );

    simulation.step(simulation.config.scheduler.intervals.verySlow);

    expect(simulation.world.delta.has(spawn.id)).toBe(false);
    expect(simulation.world.journal.consumeResourceUpdates()).toEqual([
      expect.objectContaining({
        resourceId: spawn.id,
        changedFields: { remainingFraction01: 1 },
      }),
    ]);
    simulation.dispose();
  });

  it('reflète la pression humaine dans l’état écologique régional', () => {
    const simulation = ecologySimulation('ecology-pressure');
    const spawn = firstResource(simulation);
    const owner = parseChunkKey(spawn.ownerChunkKey);
    const chunkSize = simulation.world.generator.config.layout.chunkSizeMeters;
    const coordinate = simulation.world.regionAt(
      (owner.x + 0.5) * chunkSize,
      (owner.z + 0.5) * chunkSize,
    );
    const before = simulation.world.ecology.sample(coordinate);
    simulation.world.recordResourceRemoval(
      spawn.id,
      spawn.ownerChunkKey,
      spawn.localId,
      spawn.x,
      spawn.z,
      0,
    );
    const after = simulation.world.ecology.sample(coordinate);

    expect(after.resourceRemainingRatio01).toBeLessThan(before.resourceRemainingRatio01);
    expect(after.disturbance01).toBeGreaterThan(before.disturbance01);
    expect(after.growthPotential01).toBeLessThanOrEqual(before.growthPotential01);
    simulation.dispose();
  });

  it('accepte encore l’empreinte des sauvegardes v9 antérieures à l’écologie', () => {
    const source = ecologySimulation('ecology-legacy-save');
    const captured = source.captureSnapshot();
    const legacyFingerprint = (
      source as unknown as { legacyConfigFingerprint(): string }
    ).legacyConfigFingerprint();
    const legacy: SimulationSnapshot = {
      ...captured,
      configFingerprint: legacyFingerprint,
      ecologyVersion: undefined,
    };
    const restored = ecologySimulation('ecology-legacy-save');

    expect(() => restored.restoreSnapshot(legacy)).not.toThrow();
    source.dispose();
    restored.dispose();
  });

  it('refuse un changement de règles écologiques pour une nouvelle sauvegarde', () => {
    const source = ecologySimulation('ecology-config-guard');
    const snapshot = source.captureSnapshot();
    const incompatible = new Simulation({
      seed: 'ecology-config-guard',
      spawnInitialPopulation: false,
      systems: [],
      config: { ecology: { minRegrowthDays: 20 } },
      generation: {
        layout: { sizeChunks: 4, terrainResolution: 8 },
        regions: { sizeChunks: 2 },
        resources: { globalDensity: 2, maxPerChunk: 256 },
      },
    });

    expect(() => incompatible.restoreSnapshot(snapshot)).toThrow('configuration incompatible');
    source.dispose();
    incompatible.dispose();
  });
});
