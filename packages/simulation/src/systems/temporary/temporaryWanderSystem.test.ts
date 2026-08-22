import { describe, expect, it } from 'vitest';
import { Activity, HumanPlan, Movement, Personality, Transform } from '../../components/index.js';
import type { SimulationConfig } from '../../config/simulationConfig.js';
import { Simulation } from '../../simulation.js';
import { MovementSystem } from '../movementSystem.js';
import { PathfindingSystem } from '../pathfinding/pathfindingSystem.js';
import { TemporaryWanderSystem } from './temporaryWanderSystem.js';
import { maxSlopeForCaution } from './wanderTraits.js';

/**
 * @temporary — ce fichier disparaît avec le système qu'il teste.
 *
 * Ce qui est vérifié ici n'est pas « les humains bougent » mais **la personnalité influence
 * réellement la décision**. C'est la propriété que le futur UtilityAI devra conserver.
 */
function makeSimulation(
  seed: string,
  population: number,
  time: Partial<SimulationConfig['time']> = {},
): Simulation {
  return new Simulation({
    seed,
    population,
    config: { time: { gameSecondsPerTick: 1, ...time } },
    systems: [new TemporaryWanderSystem(), new PathfindingSystem(), new MovementSystem()],
  });
}

function startExploring(simulation: Simulation): void {
  simulation.start();
  for (const entity of simulation.humanIds()) {
    const plans = simulation.entities.getComponentOrThrow(entity, HumanPlan);
    plans.nextPlanId = 1;
    plans.activePlan = {
      id: 0,
      goalKind: 'explore',
      createdAtTick: 0,
      currentStepIndex: 0,
      steps: [{ kind: 'explore' }],
      lastFailure: null,
    };
  }
}

describe('TemporaryWanderSystem', () => {
  it('gives idle humans a destination and marks them as walking', () => {
    const simulation = makeSimulation('wander', 10);
    startExploring(simulation);
    simulation.step(60);

    const walking = simulation
      .humanIds()
      .filter(
        (entity) => simulation.entities.getComponentOrThrow(entity, Activity).kind === 'walking',
      );

    expect(walking.length).toBeGreaterThan(0);
    for (const entity of walking) {
      const movement = simulation.entities.getComponentOrThrow(entity, Movement);
      expect(movement.targetX).not.toBeNull();
      expect(movement.targetZ).not.toBeNull();
    }
    simulation.dispose();
  });

  it('always records a readable reason for the current activity', () => {
    const simulation = makeSimulation('reason', 8);
    startExploring(simulation);
    simulation.step(400);

    for (const entity of simulation.humanIds()) {
      const activity = simulation.entities.getComponentOrThrow(entity, Activity);
      expect(activity.reason).toMatch(/curiosité|patience|apparaître|destination/);
    }
    simulation.dispose();
  });

  it('alternates between resting and walking instead of walking non-stop', () => {
    const simulation = makeSimulation('alternation', 12);
    startExploring(simulation);

    let sawIdleAfterWalking = false;
    const entity = simulation.humanIds()[0]!;
    let hasWalked = false;

    for (let i = 0; i < 4000 && !sawIdleAfterWalking; i++) {
      simulation.step(1);
      const activity = simulation.entities.getComponentOrThrow(entity, Activity);
      if (activity.kind === 'walking') hasWalked = true;
      else if (hasWalked && activity.reason.includes('repos')) sawIdleAfterWalking = true;
    }

    expect(sawIdleAfterWalking).toBe(true);
    simulation.dispose();
  });

  it('lets curious individuals travel further than incurious ones', () => {
    const simulation = makeSimulation('curiosity', 60);
    startExploring(simulation);

    const distances = new Map<number, { curiosity: number; travelled: number }>();
    for (const entity of simulation.humanIds()) {
      distances.set(entity, {
        curiosity: simulation.entities.getComponentOrThrow(entity, Personality).curiosity,
        travelled: 0,
      });
    }

    const previous = new Map(
      simulation.humanIds().map((entity) => {
        const transform = simulation.entities.getComponentOrThrow(entity, Transform);
        return [entity, { x: transform.x, z: transform.z }];
      }),
    );

    for (let i = 0; i < 6000; i++) {
      simulation.step(1);
      for (const entity of simulation.humanIds()) {
        const transform = simulation.entities.getComponentOrThrow(entity, Transform);
        const last = previous.get(entity)!;
        distances.get(entity)!.travelled += Math.hypot(transform.x - last.x, transform.z - last.z);
        last.x = transform.x;
        last.z = transform.z;
      }
    }

    const sorted = [...distances.values()].sort((a, b) => a.curiosity - b.curiosity);
    const third = Math.floor(sorted.length / 3);
    const average = (group: typeof sorted): number =>
      group.reduce((sum, item) => sum + item.travelled, 0) / group.length;

    expect(average(sorted.slice(-third))).toBeGreaterThan(average(sorted.slice(0, third)));
    simulation.dispose();
  });

  it('keeps destinations inside the world margin', () => {
    const simulation = makeSimulation('margin', 20);
    startExploring(simulation);
    simulation.step(3000);

    const limit =
      simulation.world.bounds.halfSizeMeters - simulation.config.wander.worldMarginMeters;
    for (const entity of simulation.humanIds()) {
      const movement = simulation.entities.getComponentOrThrow(entity, Movement);
      if (movement.targetX === null || movement.targetZ === null) continue;
      expect(Math.abs(movement.targetX)).toBeLessThanOrEqual(limit + 1e-9);
      expect(Math.abs(movement.targetZ)).toBeLessThanOrEqual(limit + 1e-9);
    }
    simulation.dispose();
  });

  it('rests at night unless courageous enough to keep moving', () => {
    // Départ à 22 h : le premier tick est déjà nocturne.
    const simulation = makeSimulation('night', 40, { startHourOfDay: 22 });
    startExploring(simulation);
    const threshold = simulation.config.wander.nightMovementCourageThreshold;

    // On échantillonne sur 10 minutes de nuit : un courageux n'est observable en marche
    // qu'entre deux pauses, il faut donc ratisser plusieurs cycles.
    let sawNightRest = false;
    let sawNightWalk = false;
    for (let i = 0; i < 600 && !(sawNightRest && sawNightWalk); i++) {
      simulation.step(1);
      for (const entity of simulation.humanIds()) {
        const activity = simulation.entities.getComponentOrThrow(entity, Activity);
        const courage = simulation.entities.getComponentOrThrow(entity, Personality).courage;
        if (courage < threshold && activity.reason.includes('la nuit')) sawNightRest = true;
        if (courage >= threshold && activity.kind === 'walking') sawNightWalk = true;
      }
    }

    expect(sawNightRest).toBe(true);
    expect(sawNightWalk).toBe(true);
    simulation.dispose();
  });

  it('keeps cautious destinations within their slope limit', () => {
    const simulation = makeSimulation('caution', 40);
    startExploring(simulation);

    // La cible n'est observable que pendant la marche : on collecte chaque destination
    // croisée pendant plusieurs cycles plutôt qu'à un instant figé.
    const wander = simulation.config.wander;
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      simulation.step(1);
      for (const entity of simulation.humanIds()) {
        const movement = simulation.entities.getComponentOrThrow(entity, Movement);
        if (movement.targetX === null || movement.targetZ === null) continue;
        const caution = simulation.entities.getComponentOrThrow(entity, Personality).caution;
        if (caution < 0.75) continue;
        expect(simulation.world.slopeAt(movement.targetX, movement.targetZ)).toBeLessThanOrEqual(
          maxSlopeForCaution(caution, wander) + 1e-9,
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    simulation.dispose();
  });

  it('wanders during search plans but never while a move step is active', () => {
    const searching = makeSimulation('search-wander', 1);
    searching.start();
    const searchingHuman = searching.humanIds()[0]!;
    searching.entities.getComponentOrThrow(searchingHuman, HumanPlan).activePlan = {
      id: 0,
      goalKind: 'survive.nourish',
      createdAtTick: 0,
      currentStepIndex: 0,
      steps: [{ kind: 'search.food' }],
      lastFailure: null,
    };
    let searchedByMoving = false;
    for (let i = 0; i < 500 && !searchedByMoving; i++) {
      searching.step(1);
      searchedByMoving =
        searching.entities.getComponentOrThrow(searchingHuman, Movement).targetX !== null;
    }
    expect(searchedByMoving).toBe(true);
    searching.dispose();

    const moving = makeSimulation('move-no-wander', 1);
    moving.start();
    const movingHuman = moving.humanIds()[0]!;
    moving.entities.getComponentOrThrow(movingHuman, HumanPlan).activePlan = {
      id: 0,
      goalKind: 'survive.hydrate',
      createdAtTick: 0,
      currentStepIndex: 0,
      steps: [{ kind: 'move.to_water', rememberedX: 100, rememberedZ: 100 }],
      lastFailure: null,
    };
    moving.step(500);
    const movement = moving.entities.getComponentOrThrow(movingHuman, Movement);
    expect(movement.targetX).toBeNull();
    expect(movement.targetZ).toBeNull();
    moving.dispose();
  });
});
