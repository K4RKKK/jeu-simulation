import type { ResourceSpawn } from '@civ/procedural';
import { describe, expect, it } from 'vitest';
import {
  CognitiveMemory,
  HumanCognition,
  HumanPlan,
  HumanSkills,
  Needs,
  NeedsState,
} from '../../components/index.js';
import { Simulation } from '../../simulation.js';
import { beginResourceInteraction } from '../../world/resourceInteraction.js';
import { LearningSystem } from '../cognition/learningSystem.js';
import { ResourceInteractionSystem } from '../resourceInteractionSystem.js';
import { NeedSatisfactionSystem } from './needSatisfactionSystem.js';

function simulation(seed: string, population = 1): Simulation {
  return new Simulation({
    seed,
    population,
    config: { time: { gameSecondsPerTick: 1 } },
    systems: [new LearningSystem(), new NeedSatisfactionSystem(), new ResourceInteractionSystem()],
  });
}

function singleServingResource(simulation: Simulation): ResourceSpawn {
  for (let z = -5; z <= 5; z++) {
    for (let x = -5; x <= 5; x++) {
      const spawn = simulation.world
        .generateChunk({ x, z })
        .resources.find((resource) => resource.harvestServings === 1 && resource.foodKcal > 0);
      if (spawn) return spawn;
    }
  }
  throw new Error('single-serving food resource not found');
}

function beginGathering(
  simulation: Simulation,
  human: number,
  spawn: ResourceSpawn,
  untilTick: number,
  intent: 'satisfyNeed' | 'deliberateExperiment' = 'satisfyNeed',
): void {
  const worldRef = {
    type: 'resource' as const,
    resourceId: spawn.id,
    ownerChunkKey: spawn.ownerChunkKey,
    localId: spawn.localId,
  };
  simulation.entities.addComponent(human, NeedsState, {
    action: 'gatherFood',
    targetX: spawn.x,
    targetZ: spawn.z,
    resourceId: spawn.id,
    resourceOwnerChunkKey: spawn.ownerChunkKey,
    resourceLocalId: spawn.localId,
    resourceConceptId: spawn.perceptualConceptId,
    foodIntent: intent,
    gatherStartedTick: 0,
    mealStartedTick: -1,
    mealHungerBefore01: 0,
    untilTick,
    mealMaxGain: 1,
    poisoningUntilTick: -1,
    poisoningToxicity01: 0,
    currentMealCausedPoisoning: false,
    pathFailedAtTick: -1,
  });
  simulation.entities.getComponentOrThrow(human, Needs).hunger = 0.1;
  simulation.entities.getComponentOrThrow(human, HumanCognition).activeGoal = {
    kind: intent === 'deliberateExperiment' ? 'explore' : 'survive.nourish',
    startedAtTick: 0,
  };
  simulation.entities.getComponentOrThrow(human, HumanPlan).activePlan = {
    id: 0,
    goalKind: intent === 'deliberateExperiment' ? 'explore' : 'survive.nourish',
    createdAtTick: 0,
    currentStepIndex: 0,
    steps: [
      {
        kind: 'eat.resource',
        worldRef,
        subjectConceptId: spawn.perceptualConceptId,
        intent,
      },
    ],
    lastFailure: null,
  };
  expect(
    beginResourceInteraction(
      simulation.entities,
      simulation.world,
      human,
      spawn.id,
      spawn.ownerChunkKey,
      0,
    ),
  ).not.toBeNull();
}

describe('timed resource gathering', () => {
  it('keeps the final portion payload and creates one gathering experience before eating', () => {
    const world = simulation('gather-final-payload');
    const human = world.humanIds()[0]!;
    const spawn = singleServingResource(world);
    beginGathering(world, human, spawn, 1);
    world.start();
    world.step(7);

    const state = world.entities.getComponentOrThrow(human, NeedsState);
    expect(state.action).toBe('eat');
    expect(state.mealMaxGain).toBeCloseTo(
      spawn.foodKcal / spawn.harvestServings / world.config.needs.hunger.kcalPerFullMeal,
    );
    expect(state.currentMealCausedPoisoning).toBe(
      spawn.foodToxicity01 > world.config.needs.toxicity.effectThreshold01,
    );
    expect(world.world.delta.isDepleted(spawn.id)).toBe(true);
    const experiences = world.entities
      .getComponentOrThrow(human, CognitiveMemory)
      .episodic.filter((episode) => episode.experience?.kind === 'resource.gathering');
    expect(experiences).toHaveLength(1);
    expect(world.entities.getComponentOrThrow(human, HumanSkills).skills[0]?.practiceCount).toBe(1);
    world.dispose();
  });

  it('produces one harvest and one experience for two gatherers racing for one portion', () => {
    const world = simulation('gather-final-race', 2);
    const [a, b] = world.humanIds();
    const spawn = singleServingResource(world);
    beginGathering(world, a!, spawn, 1, 'satisfyNeed');
    beginGathering(world, b!, spawn, 1, 'deliberateExperiment');
    world.start();
    world.step(7);

    const memories = [a!, b!].flatMap(
      (human) => world.entities.getComponentOrThrow(human, CognitiveMemory).episodic,
    );
    expect(
      memories.filter((entry) => entry.experience?.kind === 'resource.gathering'),
    ).toHaveLength(1);
    const totalPractice = [a!, b!].reduce(
      (sum, human) =>
        sum +
        (world.entities.getComponentOrThrow(human, HumanSkills).skills[0]?.practiceCount ?? 0),
      0,
    );
    expect(totalPractice).toBe(1);
    expect(world.world.delta.isDepleted(spawn.id)).toBe(true);
    expect(
      [a!, b!].filter(
        (human) => world.entities.getComponentOrThrow(human, NeedsState).action === 'eat',
      ),
    ).toHaveLength(1);
    world.dispose();
  });

  it('restores a frozen gathering deadline without recalculating it from changed skill', () => {
    const source = simulation('gather-mid-save');
    const human = source.humanIds()[0]!;
    const spawn = singleServingResource(source);
    beginGathering(source, human, spawn, 8);
    const snapshot = source.captureSnapshot();
    source.entities.getComponentOrThrow(human, HumanSkills).skills.push({
      kind: 'resource.gathering',
      proficiency01: 0.95,
      practiceCount: 100,
      lastPracticedTick: 1,
    });

    const restored = simulation('gather-mid-save');
    restored.restoreSnapshot(snapshot);
    const restoredState = restored.entities.getComponentOrThrow(human, NeedsState);
    expect(restoredState.action).toBe('gatherFood');
    expect(restoredState.untilTick).toBe(8);
    expect(restored.entities.getComponentOrThrow(human, HumanSkills).skills).toEqual([]);
    restored.start();
    restored.step(17);
    const experiences = restored.entities
      .getComponentOrThrow(human, CognitiveMemory)
      .episodic.filter((entry) => entry.experience?.kind === 'resource.gathering');
    expect(experiences).toHaveLength(1);
    expect(restored.entities.getComponentOrThrow(human, HumanSkills).skills[0]?.practiceCount).toBe(
      1,
    );
    source.dispose();
    restored.dispose();
  });
});
