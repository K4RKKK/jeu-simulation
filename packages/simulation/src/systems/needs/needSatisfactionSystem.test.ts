import { describe, expect, it } from 'vitest';
import type { ResourceSpawn } from '@civ/procedural';
import { NavGrid, PathFindingService } from '@civ/pathfinding';
import {
  Activity,
  CognitiveKnowledge,
  CognitiveMemory,
  HumanCognition,
  HumanPlan,
  Movement,
  Needs,
  NeedsState,
  Personality,
  Transform,
} from '../../components/index.js';
import type { CognitiveMemoryComponent, SpatialMemoryEntry } from '../../components/index.js';
import { observeResource, observeShore } from '../../cognition/observationBuilder.js';
import { rememberSpatial } from '../../cognition/spatialMemoryModel.js';
import { Simulation } from '../../simulation.js';
import { scanForShorePoint } from '../perception/perceptionModel.js';
import { MovementSystem } from '../movementSystem.js';
import { PathfindingSystem } from '../pathfinding/pathfindingSystem.js';
import { terrainTileCostProvider } from '../pathfinding/terrainCostProvider.js';
import { TemporaryWanderSystem } from '../temporary/temporaryWanderSystem.js';
import { GoalSelectionSystem } from '../cognition/goalSelectionSystem.js';
import { PlannerSystem } from '../cognition/plannerSystem.js';
import { MetabolismSystem } from './metabolismSystem.js';
import { NeedSatisfactionSystem } from './needSatisfactionSystem.js';

/**
 * La satisfaction est la première vraie prise de décision vitale : priorité physiologique
 * (épuisement > soif > faim), déplacements vers l'eau et la nourriture, et des raisons
 * lisibles (CLAUDE.md règle 12). Les décisions ne viennent **jamais** d'une recherche dans
 * le monde : elles viennent de la mémoire individuelle remplie par la perception.
 */
function needsSystems(): Simulation {
  return new Simulation({
    seed: 'needs',
    population: 1,
    config: { time: { gameSecondsPerTick: 1 } },
    systems: [
      new MetabolismSystem(),
      new GoalSelectionSystem(),
      new PlannerSystem(),
      new NeedSatisfactionSystem(),
      new PathfindingSystem(),
      new MovementSystem(),
    ],
  });
}

/** Vrai chemin de bout en bout, comme le calculerait le PathfindingSystem en direct. */
function isReachable(
  simulation: Simulation,
  from: { x: number; z: number },
  to: { x: number; z: number },
): boolean {
  const config = simulation.config.pathfinding;
  const service = new PathFindingService({
    grid: new NavGrid({
      tileSizeMeters: config.tileSizeMeters,
      cost: terrainTileCostProvider(simulation.world, config),
    }),
    maxNodesPerTick: config.maxNodesPerTick,
    maxNodesPerRequest: config.maxNodesPerRequest,
    maxRetries: 0,
    pathCacheCapacity: 8,
    snapRadiusTiles: config.snapRadiusTiles,
  });
  const reply = service.request(from, to, 0);
  if (reply.immediate !== null) return reply.immediate.path !== null;
  return service.process().some((outcome) => outcome.path !== null);
}

function setNeeds(
  simulation: Simulation,
  needs: { hydration?: number; hunger?: number; energy?: number },
): void {
  const entity = simulation.humanIds()[0]!;
  const component = simulation.entities.getComponentOrThrow(entity, Needs);
  if (needs.hydration !== undefined) component.hydration = needs.hydration;
  if (needs.hunger !== undefined) component.hunger = needs.hunger;
  if (needs.energy !== undefined) component.energy = needs.energy;
}

/** Semer la mémoire cognitive d'un humain : c'est le rôle de la perception en vrai. */
function seedCognition(simulation: Simulation): CognitiveMemoryComponent {
  return simulation.entities.getComponentOrThrow(simulation.humanIds()[0]!, CognitiveMemory);
}

function rememberedFood(
  resourceId: string,
  localId: number,
  x: number,
  z: number,
): SpatialMemoryEntry {
  return {
    id: localId,
    kind: 'resource',
    x,
    z,
    lastSeenTick: 0,
    confidence01: 1,
    precisionM: 0,
    encodedConfidence01: 1,
    encodedPrecisionM: 0,
    source: 'directPerception',
    subjectConceptId: 'berry:red',
    foodCandidate: true,
    worldRef: { type: 'resource', resourceId, ownerChunkKey: '0:0', localId },
  };
}

/**
 * Trouve une ressource comestible dans le monde (génération directe, comme le ferait la
 * perception) et place l'humain dessus, puis sème le souvenir cognitif correspondant.
 */
function seedFoodUnderHuman(
  simulation: Simulation,
  edible: (spawn: ResourceSpawn) => boolean,
): ResourceSpawn {
  const world = simulation.world;
  const entity = simulation.humanIds()[0]!;
  const transform = simulation.entities.getComponentOrThrow(entity, Transform);

  const chunk = world.generateChunk(world.chunkAt(transform.x, transform.z));
  const spawn = chunk.resources.find(
    (candidate) => edible(candidate) && world.isWalkable(candidate.x, candidate.z),
  );
  expect(spawn).toBeDefined();
  transform.x = spawn!.x;
  transform.z = spawn!.z;

  rememberSpatial(
    seedCognition(simulation),
    observeResource(spawn!, simulation.clock.currentTick),
    simulation.config.cognition,
  );
  return spawn!;
}

/**
 * Trouve une rive **atteignable** dans le voisinage (rayons croissants) et sème son
 * souvenir cognitif. Sans vérification d'atteignabilité, le test dépendrait de la
 * géographie de la seed : une rive derrière un lac serait « mémorisée » mais sans
 * chemin, et l'humain resterait au camp — le test échouerait pour la mauvaise raison.
 */
function seedWaterNearHuman(simulation: Simulation, radiusM: number): { x: number; z: number } {
  const world = simulation.world;
  const entity = simulation.humanIds()[0]!;
  const transform = simulation.entities.getComponentOrThrow(entity, Transform);

  for (let radius = 8; radius <= radiusM; radius += 8) {
    const point = scanForShorePoint(
      transform.x,
      transform.z,
      radius,
      8,
      simulation.config.needs.search.drinkShoreDistanceM,
      (x, z) => world.isWalkable(x, z),
      (x, z) => world.hydrology.distanceToWaterMeters(x, z),
    );
    if (point === null) continue;
    if (!isReachable(simulation, { x: transform.x, z: transform.z }, point)) continue;

    rememberSpatial(
      seedCognition(simulation),
      observeShore(point, simulation.clock.currentTick),
      simulation.config.cognition,
    );
    return point;
  }
  throw new Error(`aucune rive atteignable dans ${radiusM} m autour de la position initiale`);
}

describe('NeedSatisfactionSystem', () => {
  it('sends a thirsty human towards a remembered shore', () => {
    const simulation = needsSystems();
    simulation.start();
    const shore = seedWaterNearHuman(simulation, 64);
    setNeeds(simulation, { hydration: 0.05 });
    simulation.step(10);

    const entity = simulation.humanIds()[0]!;
    const activity = simulation.entities.getComponentOrThrow(entity, Activity);
    const state = simulation.entities.getComponentOrThrow(entity, NeedsState);
    const cognition = simulation.entities.getComponentOrThrow(entity, HumanCognition);

    expect(cognition.activeGoal?.kind).toBe('survive.hydrate');
    expect(cognition.decisionReason?.code).toBe('goal.select.survive.hydrate');
    expect(activity.reason).toContain("se souvient d'une rive");
    if (state.action === 'seekWater') {
      expect(activity.kind).toBe('walking');
      expect(activity.reason).toContain('part boire');
      const movement = simulation.entities.getComponentOrThrow(entity, Movement);
      expect(movement.targetX).not.toBeNull();
      expect(movement.targetZ).not.toBeNull();
      expect(
        simulation.world.hydrology.distanceToWaterMeters(movement.targetX!, movement.targetZ!),
      ).toBeLessThanOrEqual(simulation.config.needs.search.drinkShoreDistanceM);
      expect(movement.targetX).toBe(shore.x);
      expect(movement.targetZ).toBe(shore.z);
    } else {
      // Le souvenir était déjà sous les pieds : le repas d'eau a commencé directement.
      expect(state.action).toBe('drink');
      expect(activity.kind).toBe('drink');
    }
    simulation.dispose();
  });

  it('sends a hungry human towards a remembered resource', () => {
    const simulation = needsSystems();
    simulation.start();
    seedFoodUnderHuman(simulation, (candidate) => candidate.foodKcal > 0);
    setNeeds(simulation, { hydration: 1, hunger: 0.05 });
    simulation.step(10);

    const entity = simulation.humanIds()[0]!;
    const activity = simulation.entities.getComponentOrThrow(entity, Activity);
    const movement = simulation.entities.getComponentOrThrow(entity, Movement);
    const state = simulation.entities.getComponentOrThrow(entity, NeedsState);
    const cognition = simulation.entities.getComponentOrThrow(entity, HumanCognition);

    // La décision de se nourrir est prise, avec une raison lisible (règle 12). Selon le
    // monde, la ressource la plus proche est à portée de main (repas immédiat) ou plus
    // loin (déplacement) : les deux sont la même décision, vérifiée sans omniscience.
    if (state.action === 'seekFood') {
      expect(activity.kind).toBe('walking');
      expect(activity.reason).toContain('chercher de la nourriture');
      expect(movement.targetX).not.toBeNull();
      expect(movement.targetZ).not.toBeNull();
    } else {
      expect(state.action).toBe('eat');
      expect(activity.kind).toBe('eat');
      expect(activity.reason).toContain('mange pour apaiser sa faim');
    }
    expect(cognition.activeGoal?.kind).toBe('survive.nourish');
    expect(cognition.decisionReason?.code).toBe('goal.select.survive.nourish');
    expect(state.resourceId).not.toBeNull();
    simulation.dispose();
  });

  it('makes an exhausted human rest before seeking water', () => {
    const simulation = needsSystems();
    simulation.start();
    setNeeds(simulation, { hydration: 0.05, energy: 0.05 });
    simulation.step(10);

    const entity = simulation.humanIds()[0]!;
    const activity = simulation.entities.getComponentOrThrow(entity, Activity);
    const state = simulation.entities.getComponentOrThrow(entity, NeedsState);
    const cognition = simulation.entities.getComponentOrThrow(entity, HumanCognition);

    expect(activity.kind).toBe('rest');
    expect(activity.reason).toContain('épuisé');
    expect(state.action).toBe('rest');
    expect(cognition.activeGoal?.kind).toBe('survive.rest');
    expect(cognition.decisionReason?.code).toBe('goal.select.survive.rest');
    simulation.dispose();
  });

  it('keeps exploration as the default baseline when no vital need dominates', () => {
    const simulation = needsSystems();
    simulation.start();
    const entity = simulation.humanIds()[0]!;
    const personality = simulation.entities.getComponentOrThrow(entity, Personality);
    personality.curiosity = 0.8;
    setNeeds(simulation, { hydration: 1, hunger: 1, energy: 1 });

    simulation.step(10);

    const state = simulation.entities.getComponentOrThrow(entity, NeedsState);
    const activity = simulation.entities.getComponentOrThrow(entity, Activity);
    const cognition = simulation.entities.getComponentOrThrow(entity, HumanCognition);
    expect(state.action).toBe('none');
    expect(activity.kind).toBe('idle');
    expect(cognition.activeGoal?.kind).toBe('explore');
    expect(cognition.decisionReason?.code).toBe('goal.select.explore');
    expect(cognition.decisionReason?.factors).toContainEqual({
      code: 'personality.curiosity',
      value: 0.8,
    });
    simulation.dispose();
  });

  it('keeps a nutrition goal when no remembered food target exists', () => {
    const simulation = needsSystems();
    simulation.start();
    setNeeds(simulation, { hydration: 1, hunger: 0.05, energy: 1 });
    simulation.step(10);

    const entity = simulation.humanIds()[0]!;
    expect(simulation.entities.getComponentOrThrow(entity, HumanCognition).activeGoal?.kind).toBe(
      'survive.nourish',
    );
    expect(simulation.entities.getComponentOrThrow(entity, NeedsState).action).toBe('none');
    simulation.dispose();
  });

  it('interrupts a deliberate food experiment for urgent hydration and clears its intent', () => {
    const simulation = needsSystems();
    const entity = simulation.humanIds()[0]!;
    const cognition = simulation.entities.getComponentOrThrow(entity, HumanCognition);
    const movement = simulation.entities.getComponentOrThrow(entity, Movement);
    cognition.activeGoal = { kind: 'explore', startedAtTick: 0 };
    movement.targetX = 42;
    movement.targetZ = 24;
    simulation.entities.addComponent(entity, NeedsState, {
      action: 'seekFood',
      targetX: 42,
      targetZ: 24,
      resourceId: 'food:target',
      resourceOwnerChunkKey: '0:0',
      resourceLocalId: 1,
      resourceConceptId: 'food:target',
      foodIntent: 'deliberateExperiment',
      mealStartedTick: -1,
      mealHungerBefore01: 0,
      untilTick: -1,
      mealMaxGain: 1,
      poisoningUntilTick: -1,
      poisoningToxicity01: 0,
      currentMealCausedPoisoning: false,
      pathFailedAtTick: -1,
    });
    setNeeds(simulation, { hydration: 0.001, hunger: 0.05, energy: 1 });
    simulation.start();
    simulation.step(10);

    const state = simulation.entities.getComponentOrThrow(entity, NeedsState);
    expect(cognition.activeGoal?.kind).toBe('survive.hydrate');
    expect(state.action).toBe('none');
    expect(state.resourceId).toBeNull();
    expect(state.foodIntent).toBeNull();
    expect(movement.targetX).toBeNull();
    expect(movement.targetZ).toBeNull();
    simulation.dispose();
  });

  it('keeps an in-progress search when the competing utility stays below hysteresis', () => {
    const simulation = needsSystems();
    const entity = simulation.humanIds()[0]!;
    const cognition = simulation.entities.getComponentOrThrow(entity, HumanCognition);
    const movement = simulation.entities.getComponentOrThrow(entity, Movement);
    cognition.activeGoal = { kind: 'survive.hydrate', startedAtTick: 0 };
    movement.targetX = 42;
    movement.targetZ = 24;
    simulation.entities.addComponent(entity, NeedsState, {
      action: 'seekWater',
      targetX: 42,
      targetZ: 24,
      resourceId: null,
      resourceOwnerChunkKey: null,
      resourceLocalId: null,
      resourceConceptId: null,
      foodIntent: null,
      mealStartedTick: -1,
      mealHungerBefore01: 0,
      untilTick: -1,
      mealMaxGain: 1,
      poisoningUntilTick: -1,
      poisoningToxicity01: 0,
      currentMealCausedPoisoning: false,
      pathFailedAtTick: -1,
    });
    setNeeds(simulation, { hydration: 0.11, hunger: 0.115, energy: 1 });
    simulation.start();
    simulation.step(10);

    expect(cognition.activeGoal?.kind).toBe('survive.hydrate');
    expect(simulation.entities.getComponentOrThrow(entity, NeedsState).action).toBe('seekWater');
    expect(movement.targetX).toBe(42);
    expect(movement.targetZ).toBe(24);
    simulation.dispose();
  });

  it('drinks until the target or the maximum duration is reached, then stops', () => {
    const simulation = needsSystems();
    simulation.start();
    seedWaterNearHuman(simulation, 64);
    setNeeds(simulation, { hydration: 0.05 });

    // Laisser le temps d'aller à l'eau et de boire : une soif extrême peut demander
    // plusieurs pauses avant d'atteindre le niveau visé (la durée d'une boisson est
    // bornée par la configuration).
    let sawDrink = false;
    let stopped = false;
    for (let i = 0; i < 400; i++) {
      simulation.step(1);
      const activity = simulation.entities.getComponentOrThrow(simulation.humanIds()[0]!, Activity);
      if (activity.kind === 'drink') sawDrink = true;
      if (sawDrink && activity.kind === 'idle' && activity.reason.includes('soif')) {
        stopped = true;
        break;
      }
    }

    const entity = simulation.humanIds()[0]!;
    const needs = simulation.entities.getComponentOrThrow(entity, Needs);
    const state = simulation.entities.getComponentOrThrow(entity, NeedsState);
    expect(sawDrink).toBe(true);
    expect(stopped).toBe(true);
    expect(needs.hydration).toBeGreaterThan(0.6);
    expect(state.action).toBe('none');

    // Phase 3.3 : la fin du repas d'eau doit avoir laissé un épisode dans la mémoire cognitive.
    const memory = simulation.entities.getComponentOrThrow(entity, CognitiveMemory);
    const drinkEpisode = memory.episodic.find((e) => e.eventType === 'water.drunk');
    expect(drinkEpisode).toBeDefined();
    expect(drinkEpisode?.outcome).toBe('thirst.quenched');
    expect(drinkEpisode?.actors).toEqual([entity]);
    simulation.dispose();
  });

  it('discovers a missing planned food target on arrival and replans a search', () => {
    const simulation = needsSystems();
    simulation.start();
    const entity = simulation.humanIds()[0]!;
    const transform = simulation.entities.getComponentOrThrow(entity, Transform);
    const cognition = simulation.entities.getComponentOrThrow(entity, HumanCognition);
    const plan = simulation.entities.getComponentOrThrow(entity, HumanPlan);

    setNeeds(simulation, { hydration: 1, hunger: 0.05, energy: 1 });
    simulation.entities.addComponent(entity, NeedsState, {
      action: 'seekFood',
      targetX: transform.x,
      targetZ: transform.z,
      resourceId: 'remembered:berry',
      resourceOwnerChunkKey: '0:0',
      resourceLocalId: null,
      resourceConceptId: null,
      foodIntent: null,
      mealStartedTick: -1,
      mealHungerBefore01: 0,
      untilTick: -1,
      mealMaxGain: 1,
      poisoningUntilTick: -1,
      poisoningToxicity01: 0,
      currentMealCausedPoisoning: false,
      pathFailedAtTick: -1,
    });
    cognition.activeGoal = {
      kind: 'survive.nourish',
      startedAtTick: 0,
    };
    plan.nextPlanId = 1;
    plan.activePlan = {
      id: 0,
      goalKind: 'survive.nourish',
      createdAtTick: 0,
      currentStepIndex: 0,
      steps: [
        {
          kind: 'move.to_resource',
          worldRef: {
            type: 'resource',
            resourceId: 'remembered:berry',
            ownerChunkKey: '0:0',
            localId: 1,
          },
          subjectConceptId: null,
          rememberedX: transform.x,
          rememberedZ: transform.z,
        },
        {
          kind: 'eat.resource',
          worldRef: {
            type: 'resource',
            resourceId: 'remembered:berry',
            ownerChunkKey: '0:0',
            localId: 1,
          },
          subjectConceptId: null,
          intent: 'satisfyNeed',
        },
      ],
      lastFailure: null,
    };

    simulation.step(5);
    expect(plan.activePlan?.lastFailure?.reason).toBe('target.missing');
    expect(plan.activePlan?.currentStepIndex).toBe(1);
    expect(simulation.entities.getComponentOrThrow(entity, NeedsState).action).toBe('none');

    simulation.step(5);
    expect(plan.activePlan?.steps).toEqual([{ kind: 'search.food' }]);
    simulation.dispose();
  });

  it('invalidates a stale remembered resource and replans to another known target', () => {
    const simulation = needsSystems();
    const entity = simulation.humanIds()[0]!;
    const transform = simulation.entities.getComponentOrThrow(entity, Transform);
    const memory = simulation.entities.getComponentOrThrow(entity, CognitiveMemory);
    const missing = rememberedFood('missing:a', 101, transform.x, transform.z);
    const alternative = rememberedFood('remembered:b', 102, transform.x + 30, transform.z);
    memory.spatial.push(missing, alternative);
    setNeeds(simulation, { hydration: 1, hunger: 0.05, energy: 1 });
    simulation.start();

    for (let i = 0; i < 30 && memory.spatial.includes(missing); i++) simulation.step(1);
    expect(memory.spatial).not.toContain(missing);
    expect(memory.spatial).toContain(alternative);

    const plans = simulation.entities.getComponentOrThrow(entity, HumanPlan);
    for (let i = 0; i < 30; i++) {
      const step = plans.activePlan?.steps[0];
      if (step?.kind === 'move.to_resource' && step.worldRef.resourceId === 'remembered:b') break;
      simulation.step(1);
    }
    expect(plans.activePlan?.steps[0]).toMatchObject({
      kind: 'move.to_resource',
      worldRef: { resourceId: 'remembered:b' },
    });
    simulation.dispose();
  });

  it('does not advance a move step when its movement target vanishes before arrival', () => {
    const simulation = needsSystems();
    simulation.start();
    const entity = simulation.humanIds()[0]!;
    const transform = simulation.entities.getComponentOrThrow(entity, Transform);
    const plan = simulation.entities.getComponentOrThrow(entity, HumanPlan);
    simulation.entities.getComponentOrThrow(entity, HumanCognition).activeGoal = {
      kind: 'survive.hydrate',
      startedAtTick: 0,
    };
    simulation.entities.addComponent(entity, NeedsState, {
      action: 'seekWater',
      targetX: transform.x + 100,
      targetZ: transform.z + 100,
      resourceId: null,
      resourceOwnerChunkKey: null,
      resourceLocalId: null,
      resourceConceptId: null,
      foodIntent: null,
      mealStartedTick: -1,
      mealHungerBefore01: 0,
      untilTick: -1,
      mealMaxGain: 1,
      poisoningUntilTick: -1,
      poisoningToxicity01: 0,
      currentMealCausedPoisoning: false,
      pathFailedAtTick: -1,
    });
    plan.activePlan = {
      id: 0,
      goalKind: 'survive.hydrate',
      createdAtTick: 0,
      currentStepIndex: 0,
      steps: [
        { kind: 'move.to_water', rememberedX: transform.x + 100, rememberedZ: transform.z + 100 },
        { kind: 'drink', rememberedX: transform.x + 100, rememberedZ: transform.z + 100 },
      ],
      lastFailure: null,
    };

    simulation.step(5);
    expect(plan.activePlan?.currentStepIndex).toBe(0);
    expect(plan.activePlan?.lastFailure?.reason).toBe('interaction.failed');
    simulation.dispose();
  });

  it('advances an arrived move step exactly once before drinking', () => {
    const simulation = needsSystems();
    simulation.start();
    const entity = simulation.humanIds()[0]!;
    const transform = simulation.entities.getComponentOrThrow(entity, Transform);
    const plan = simulation.entities.getComponentOrThrow(entity, HumanPlan);
    simulation.entities.getComponentOrThrow(entity, HumanCognition).activeGoal = {
      kind: 'survive.hydrate',
      startedAtTick: 0,
    };
    simulation.entities.addComponent(entity, NeedsState, {
      action: 'seekWater',
      targetX: transform.x,
      targetZ: transform.z,
      resourceId: null,
      resourceOwnerChunkKey: null,
      resourceLocalId: null,
      resourceConceptId: null,
      foodIntent: null,
      mealStartedTick: -1,
      mealHungerBefore01: 0,
      untilTick: -1,
      mealMaxGain: 1,
      poisoningUntilTick: -1,
      poisoningToxicity01: 0,
      currentMealCausedPoisoning: false,
      pathFailedAtTick: -1,
    });
    plan.activePlan = {
      id: 0,
      goalKind: 'survive.hydrate',
      createdAtTick: 0,
      currentStepIndex: 0,
      steps: [
        { kind: 'move.to_water', rememberedX: transform.x, rememberedZ: transform.z },
        { kind: 'drink', rememberedX: transform.x, rememberedZ: transform.z },
      ],
      lastFailure: null,
    };

    simulation.step(5);
    expect(plan.activePlan?.currentStepIndex).toBe(1);
    expect(simulation.entities.getComponentOrThrow(entity, NeedsState).action).toBe('drink');
    simulation.step(5);
    expect(plan.activePlan?.currentStepIndex).toBe(1);
    simulation.dispose();
  });

  /**
   * Bug corrigé par la récolte progressive : la seule ressource assez calorique pour ce
   * test (`hazel_bush`, `harvestServings: 4`) ne disparaît plus après une seule bouchée
   * — elle reste dans le monde, entamée, jusqu'à sa dernière portion. Ce test vérifie
   * les deux bouts : une visite n'épuise pas une ressource à plusieurs portions, et sa
   * DERNIÈRE portion la retire exactement comme avant (même journalisation réseau).
   */
  it('removes the eaten resource from the world once all its portions are gone', () => {
    const simulation = needsSystems();
    simulation.start();

    // Ressource copieuse (≥ moitié d'un repas complet) : ce test vérifie le retrait du
    // monde, pas la proportionnalité aux calories (couverte séparément par « caps the
    // hunger gain to what the food's kcal allows »).
    const kcalFloor = simulation.config.needs.hunger.kcalPerFullMeal * 0.5;
    const spawn = seedFoodUnderHuman(simulation, (candidate) => candidate.foodKcal >= kcalFloor);
    const entity = simulation.humanIds()[0]!;
    simulation.entities.getComponentOrThrow(entity, Personality).curiosity = 0;
    simulation.config.needs.hunger.eatTarget = 0.3;
    // Une seule portion suffit a atteindre eatTarget : le goal se termine apres une visite.
    setNeeds(simulation, { hydration: 1, hunger: 0.2 });

    simulation.step(260); // ~4 minutes : le repas doit se terminer
    expect(simulation.world.delta.isDepleted(spawn.id)).toBe(false);
    expect(simulation.entities.getComponentOrThrow(entity, Needs).hunger).toBeGreaterThan(0.2);
    // Épuise directement les portions restantes (une déjà prise par la simulation
    // ci-dessus) : prouve que la DERNIÈRE portion retire bien la ressource.
    for (let i = 1; i < spawn.harvestServings; i++) {
      simulation.world.harvestResource(
        spawn.id,
        spawn.ownerChunkKey,
        spawn.localId,
        spawn.harvestServings,
        spawn.x,
        spawn.z,
        simulation.clock.currentTick,
      );
    }
    expect(simulation.world.delta.isDepleted(spawn.id)).toBe(true);

    // Le retrait est journalisé avec sa position pour la diffusion réseau temps réel.
    const removals = simulation.world.journal.consumeRemovals();
    expect(removals).toHaveLength(1);
    expect(removals[0]!.resourceId).toBe(spawn.id);
    expect(removals[0]!.x).toBe(spawn.x);
    expect(removals[0]!.z).toBe(spawn.z);
    expect(removals[0]!.ownerChunkKey).toBe(spawn.ownerChunkKey);
    expect(simulation.world.journal.consumeRemovals()).toEqual([]);
    simulation.dispose();
  });

  it('records deliberate experiment motivation without changing the physical ingestion path', () => {
    const simulation = needsSystems();
    const spawn = seedFoodUnderHuman(simulation, (candidate) => candidate.foodKcal > 0);
    const entity = simulation.humanIds()[0]!;
    const personality = simulation.entities.getComponentOrThrow(entity, Personality);
    personality.curiosity = 1;
    personality.caution = 0;
    setNeeds(simulation, { hydration: 1, hunger: 1, energy: 1 });

    simulation.start();
    simulation.step(300);

    const episode = simulation.entities
      .getComponentOrThrow(entity, CognitiveMemory)
      .episodic.find(
        (entry) =>
          entry.experience?.kind === 'food.ingestion' &&
          entry.experience.subjectConceptId === spawn.perceptualConceptId,
      );
    expect(episode?.experience).toMatchObject({
      motivation: 'deliberateExperiment',
      subjectConceptId: spawn.perceptualConceptId,
    });
    simulation.dispose();
  });

  it('finishes a restored experimental meal exactly once', () => {
    const source = needsSystems();
    seedFoodUnderHuman(source, (candidate) => candidate.foodKcal > 0);
    const human = source.humanIds()[0]!;
    const personality = source.entities.getComponentOrThrow(human, Personality);
    personality.curiosity = 1;
    personality.caution = 0;
    setNeeds(source, { hydration: 1, hunger: 1, energy: 1 });
    source.start();

    let started = false;
    for (let ticks = 0; ticks < 50 && !started; ticks += 5) {
      source.step(5);
      const state = source.entities.getComponent(human, NeedsState);
      started = state?.action === 'eat' && state.foodIntent === 'deliberateExperiment';
    }
    expect(started).toBe(true);
    const snapshot = source.captureSnapshot();
    source.dispose();

    const restored = needsSystems();
    restored.restoreSnapshot(snapshot);
    restored.start();
    restored.step(300);
    const episodes = restored.entities
      .getComponentOrThrow(human, CognitiveMemory)
      .episodic.filter(
        (entry) =>
          entry.experience?.kind === 'food.ingestion' &&
          entry.experience.motivation === 'deliberateExperiment',
      );
    expect(episodes).toHaveLength(1);
    restored.dispose();
  });

  /**
   * Bug corrigé : le gain de faim ne dépendait que de `eatRatePerSecond` × durée —
   * une petite baie et un repas complet rassasiaient presque pareil. Ce test compare
   * directement les deux cas sur la MÊME simulation (même métabolisme, même durée
   * d'observation) pour prouver que la ressource la plus calorique nourrit
   * significativement plus.
   */
  it('caps the hunger gain to what the food’s kcal actually allows', () => {
    const kcalPerFullMeal = 600;
    const lowKcalSim = needsSystems();
    lowKcalSim.start();
    const lowSpawn = seedFoodUnderHuman(
      lowKcalSim,
      (candidate) => candidate.foodKcal > 0 && candidate.foodKcal < kcalPerFullMeal * 0.2,
    );
    setNeeds(lowKcalSim, { hydration: 1, hunger: 0.05 });
    lowKcalSim.step(260);
    const lowGain =
      lowKcalSim.entities.getComponentOrThrow(lowKcalSim.humanIds()[0]!, Needs).hunger - 0.05;

    const highKcalSim = needsSystems();
    highKcalSim.start();
    const highSpawn = seedFoodUnderHuman(
      highKcalSim,
      (candidate) => candidate.foodKcal >= kcalPerFullMeal * 0.5,
    );
    setNeeds(highKcalSim, { hydration: 1, hunger: 0.05 });
    highKcalSim.step(260);
    const highGain =
      highKcalSim.entities.getComponentOrThrow(highKcalSim.humanIds()[0]!, Needs).hunger - 0.05;

    expect(lowSpawn.foodKcal).toBeLessThan(highSpawn.foodKcal);
    expect(lowGain).toBeGreaterThan(0); // mange quand même, un peu
    expect(highGain).toBeGreaterThan(lowGain * 2); // nettement plus rassasié
    // Le gain d'un petit aliment reste borné par sa propre valeur calorique — jamais
    // par la seule durée de l'activité (c'était exactement le bug).
    expect(lowGain).toBeLessThanOrEqual(lowSpawn.foodKcal / kcalPerFullMeal + 1e-6);

    lowKcalSim.dispose();
    highKcalSim.dispose();
  });

  it('picks a toxic food when it is the closest: the toxicity is discovered by eating', () => {
    const simulation = needsSystems();
    simulation.start();

    const toxic = seedFoodUnderHuman(simulation, (candidate) => candidate.foodToxicity01 > 0);
    const entity = simulation.humanIds()[0]!;
    setNeeds(simulation, { hydration: 1, hunger: 0.05 });

    simulation.step(100); // ~100 s : le repas est engagé mais pas terminé (borné à 180 s)

    const state = simulation.entities.getComponentOrThrow(entity, NeedsState);
    // L'humain visait bien la ressource toxique, et les symptômes commencent au moment
    // de manger, pas avant : la toxicité n'est jamais une connaissance préalable.
    expect(state.poisoningToxicity01).toBe(toxic.foodToxicity01);
    expect(state.poisoningUntilTick).toBeGreaterThanOrEqual(simulation.clock.currentTick);
    simulation.dispose();
  });

  /**
   * Phase 3.3 : un repas terminé laisse un épisode `food.eaten` avec l'outcome adéquat
   * (`poisoning_started` si toxique, `satiety_increased` sinon). L'intensité émotionnelle
   * d'un empoisonnement est nettement supérieure à celle d'un repas ordinaire — c'est ce
   * qui lui permet de résister à l'éviction quand la mémoire épisodique se remplit.
   */
  it('écrit un épisode `food.eaten` avec un outcome d’empoisonnement pour une ressource toxique', () => {
    const simulation = needsSystems();
    simulation.start();
    const toxic = seedFoodUnderHuman(simulation, (candidate) => candidate.foodToxicity01 > 0);
    const entity = simulation.humanIds()[0]!;
    setNeeds(simulation, { hydration: 1, hunger: 0.05 });

    // Assez long pour terminer le repas (maxEatSeconds ~180 s).
    simulation.step(400);

    const memory = simulation.entities.getComponentOrThrow(entity, CognitiveMemory);
    const foodEpisode = memory.episodic.find((e) => e.eventType === 'food.ingestion');
    expect(foodEpisode).toBeDefined();
    expect(foodEpisode?.outcome).toBe('physiology.poisoning_started');
    expect(foodEpisode?.subjectConcept).toBe(toxic.perceptualConceptId);
    expect(foodEpisode?.experience).toMatchObject({
      kind: 'food.ingestion',
      subjectConceptId: toxic.perceptualConceptId,
      illnessObserved: true,
    });
    // IntensitÃ© fondÃ©e sur le symptÃ´me observÃ©, pas sur la toxicitÃ© moteur exacte.
    expect(foodEpisode!.emotionalStrength01).toBe(0.8);
    // NeedSatisfaction ne consolide plus de croyance : LearningSystem en est seul responsable.
    expect(simulation.entities.getComponentOrThrow(entity, CognitiveKnowledge).beliefs).toEqual([]);
    simulation.dispose();
  });

  it('leaves a drinking human alone: the wander does not interfere', () => {
    const simulation = new Simulation({
      seed: 'wander-respect',
      population: 1,
      config: { time: { gameSecondsPerTick: 1 } },
      systems: [
        new MetabolismSystem(),
        new GoalSelectionSystem(),
        new PlannerSystem(),
        new NeedSatisfactionSystem(),
        new TemporaryWanderSystem(),
        new PathfindingSystem(),
        new MovementSystem(),
      ],
    });
    simulation.start();
    seedWaterNearHuman(simulation, 48);
    setNeeds(simulation, { hydration: 0.05 });

    let drank = false;
    for (let i = 0; i < 300; i++) {
      simulation.step(1);
      const activity = simulation.entities.getComponentOrThrow(simulation.humanIds()[0]!, Activity);
      if (activity.kind === 'drink') drank = true;
      if (drank && activity.reason.includes('soif') && activity.kind !== 'drink') break;
    }
    expect(drank).toBe(true);
    // Pendant l'action vitale, le wander n'a jamais imposé sa propre errance.
    let wanderInterfered = false;
    const entity = simulation.humanIds()[0]!;
    for (let i = 0; i < 50; i++) {
      simulation.step(1);
      const activity = simulation.entities.getComponentOrThrow(entity, Activity);
      if (activity.kind === 'walking' && activity.reason.includes('sans but')) {
        wanderInterfered = true;
      }
    }
    expect(wanderInterfered).toBe(false);
    simulation.dispose();
  });

  it('records but does not learn from a legacy meal without a canonical baseline', () => {
    const simulation = needsSystems();
    const entity = simulation.humanIds()[0]!;
    simulation.entities.addComponent(entity, NeedsState, {
      action: 'eat',
      targetX: null,
      targetZ: null,
      resourceId: null,
      resourceOwnerChunkKey: null,
      resourceLocalId: null,
      resourceConceptId: 'mushroom:legacy',
      foodIntent: 'satisfyNeed',
      mealStartedTick: -1,
      mealHungerBefore01: 0,
      untilTick: -1,
      mealMaxGain: 1,
      poisoningUntilTick: -1,
      poisoningToxicity01: 0,
      currentMealCausedPoisoning: false,
      pathFailedAtTick: -1,
    });
    simulation.start();
    simulation.step(6);

    const memory = simulation.entities.getComponentOrThrow(entity, CognitiveMemory);
    const episode = memory.episodic.find((entry) => entry.eventType === 'food.ingestion');
    expect(episode).toMatchObject({ subjectConcept: 'mushroom:legacy' });
    expect(episode?.experience).toBeUndefined();
    simulation.dispose();
  });
});
