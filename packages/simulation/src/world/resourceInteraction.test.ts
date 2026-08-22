import type { ResourceSpawn } from '@civ/procedural';
import { describe, expect, it } from 'vitest';
import { InteractiveResource } from '../components/index.js';
import { Simulation } from '../simulation.js';
import {
  beginResourceInteraction,
  commitResourceGathering,
  endResourceInteraction,
  findInteractiveResource,
  harvestInteractiveResource,
} from './resourceInteraction.js';

function resourceOf(simulation: Simulation, requireSeveralServings = false): ResourceSpawn {
  for (let z = -4; z <= 4; z++) {
    for (let x = -4; x <= 4; x++) {
      const resource = simulation.world
        .generateChunk({ x, z })
        .resources.find((candidate) => !requireSeveralServings || candidate.harvestServings > 1);
      if (resource) return resource;
    }
  }
  throw new Error('Aucune ressource adaptée trouvée dans la zone de test');
}

describe('Cycle StaticResource → InteractiveResource → StaticResource', () => {
  it('commits the final portion with its physical food payload intact', () => {
    const simulation = new Simulation({
      seed: 'interactive-final-payload',
      spawnInitialPopulation: false,
      systems: [],
    });
    const spawn = resourceOf(simulation);
    const actor = simulation.entities.createEntity();
    const resourceEntity = beginResourceInteraction(
      simulation.entities,
      simulation.world,
      actor,
      spawn.id,
      spawn.ownerChunkKey,
      1,
    )!;
    const interactive = simulation.entities.getComponentOrThrow(
      resourceEntity,
      InteractiveResource,
    );
    interactive.remainingServings = 1;
    interactive.remainingFraction01 = 1 / interactive.harvestServings;
    simulation.world.delta.patch(
      spawn.id,
      spawn.ownerChunkKey,
      spawn.localId,
      { remainingFraction01: 1 / spawn.harvestServings },
      1,
    );

    const result = commitResourceGathering(
      simulation.entities,
      simulation.world,
      resourceEntity,
      actor,
      2,
    );

    expect(result).toMatchObject({
      committed: true,
      foodKcal: spawn.foodKcal,
      foodToxicity01: spawn.foodToxicity01,
      harvestServings: spawn.harvestServings,
      remainingServings: 0,
    });
    expect(simulation.world.delta.isDepleted(spawn.id)).toBe(true);
    simulation.dispose();
  });

  it('allows only one commit when two gatherers target the final portion', () => {
    const simulation = new Simulation({
      seed: 'interactive-final-race',
      spawnInitialPopulation: false,
      systems: [],
    });
    const spawn = resourceOf(simulation);
    const actorA = simulation.entities.createEntity();
    const actorB = simulation.entities.createEntity();
    const resourceEntity = beginResourceInteraction(
      simulation.entities,
      simulation.world,
      actorA,
      spawn.id,
      spawn.ownerChunkKey,
      1,
    )!;
    beginResourceInteraction(
      simulation.entities,
      simulation.world,
      actorB,
      spawn.id,
      spawn.ownerChunkKey,
      1,
    );
    const interactive = simulation.entities.getComponentOrThrow(
      resourceEntity,
      InteractiveResource,
    );
    interactive.remainingServings = 1;
    interactive.remainingFraction01 = 1 / interactive.harvestServings;
    simulation.world.delta.patch(
      spawn.id,
      spawn.ownerChunkKey,
      spawn.localId,
      { remainingFraction01: 1 / spawn.harvestServings },
      1,
    );

    const first = commitResourceGathering(
      simulation.entities,
      simulation.world,
      resourceEntity,
      actorA,
      2,
    );
    const second = commitResourceGathering(
      simulation.entities,
      simulation.world,
      resourceEntity,
      actorB,
      2,
    );
    expect(first.committed).toBe(true);
    expect(second).toEqual({ committed: false, reason: 'depleted' });
    expect(endResourceInteraction(simulation.entities, actorA, spawn.id)).toBe(false);
    expect(
      simulation.entities.getComponentOrThrow(resourceEntity, InteractiveResource)
        .interactingEntityIds,
    ).toEqual([actorB]);
    expect(endResourceInteraction(simulation.entities, actorB, spawn.id)).toBe(true);
    simulation.dispose();
  });

  it('promeut une seule entité ECS partagée par plusieurs acteurs', () => {
    const simulation = new Simulation({
      seed: 'interactive-promotion',
      spawnInitialPopulation: false,
      systems: [],
    });
    const spawn = resourceOf(simulation);
    const actorB = simulation.entities.createEntity();
    const actorA = simulation.entities.createEntity();

    const first = beginResourceInteraction(
      simulation.entities,
      simulation.world,
      actorB,
      spawn.id,
      spawn.ownerChunkKey,
      10,
    );
    const second = beginResourceInteraction(
      simulation.entities,
      simulation.world,
      actorA,
      spawn.id,
      spawn.ownerChunkKey,
      11,
    );

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(simulation.entities.query(InteractiveResource)).toEqual([first]);
    expect(
      simulation.entities.getComponentOrThrow(first!, InteractiveResource).interactingEntityIds,
    ).toEqual([actorB, actorA].sort((a, b) => a - b));
    simulation.dispose();
  });

  it('modifie l’entité puis consolide immédiatement la récolte dans WorldDelta', () => {
    const simulation = new Simulation({
      seed: 'interactive-harvest',
      spawnInitialPopulation: false,
      systems: [],
    });
    const spawn = resourceOf(simulation, true);
    const actor = simulation.entities.createEntity();
    const resourceEntity = beginResourceInteraction(
      simulation.entities,
      simulation.world,
      actor,
      spawn.id,
      spawn.ownerChunkKey,
      20,
    );

    const remaining = harvestInteractiveResource(
      simulation.entities,
      simulation.world,
      resourceEntity!,
      21,
    );

    const interactive = simulation.entities.getComponentOrThrow(
      resourceEntity!,
      InteractiveResource,
    );
    expect(remaining).toBe(spawn.harvestServings - 1);
    expect(interactive.remainingServings).toBe(remaining);
    expect(interactive.remainingFraction01).toBe(remaining / spawn.harvestServings);
    expect(simulation.world.delta.get(spawn.id)?.changedFields.remainingFraction01).toBe(
      remaining / spawn.harvestServings,
    );
    simulation.dispose();
  });

  it('ne rétrograde qu’après la libération du dernier acteur', () => {
    const simulation = new Simulation({
      seed: 'interactive-demotion',
      spawnInitialPopulation: false,
      systems: [],
    });
    const spawn = resourceOf(simulation);
    const firstActor = simulation.entities.createEntity();
    const secondActor = simulation.entities.createEntity();
    beginResourceInteraction(
      simulation.entities,
      simulation.world,
      firstActor,
      spawn.id,
      spawn.ownerChunkKey,
      30,
    );
    beginResourceInteraction(
      simulation.entities,
      simulation.world,
      secondActor,
      spawn.id,
      spawn.ownerChunkKey,
      30,
    );

    expect(endResourceInteraction(simulation.entities, firstActor, spawn.id)).toBe(false);
    expect(findInteractiveResource(simulation.entities, spawn.id)).not.toBeNull();
    expect(endResourceInteraction(simulation.entities, secondActor, spawn.id)).toBe(true);
    expect(findInteractiveResource(simulation.entities, spawn.id)).toBeNull();
    simulation.dispose();
  });

  it('persiste une interaction en cours sans perdre le WorldDelta associé', () => {
    const source = new Simulation({
      seed: 'interactive-persistence',
      spawnInitialPopulation: false,
      systems: [],
    });
    const spawn = resourceOf(source, true);
    const actor = source.entities.createEntity();
    const resourceEntity = beginResourceInteraction(
      source.entities,
      source.world,
      actor,
      spawn.id,
      spawn.ownerChunkKey,
      40,
    );
    harvestInteractiveResource(source.entities, source.world, resourceEntity!, 41);
    const snapshot = source.captureSnapshot();

    const restored = new Simulation({
      seed: 'interactive-persistence',
      spawnInitialPopulation: false,
      systems: [],
    });
    restored.restoreSnapshot(snapshot);

    const restoredEntity = findInteractiveResource(restored.entities, spawn.id);
    expect(restoredEntity).not.toBeNull();
    expect(
      restored.entities.getComponentOrThrow(restoredEntity!, InteractiveResource)
        .remainingFraction01,
    ).toBe(source.world.delta.get(spawn.id)?.changedFields.remainingFraction01);
    expect(restored.world.delta.get(spawn.id)).toEqual(source.world.delta.get(spawn.id));
    source.dispose();
    restored.dispose();
  });
});
