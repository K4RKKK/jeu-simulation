import { describe, expect, it } from 'vitest';
import {
  CognitiveMemory,
  HumanCognition,
  HumanPlan,
  type SpatialMemoryEntry,
} from '../../components/index.js';
import { Simulation } from '../../simulation.js';
import { PlannerSystem } from './plannerSystem.js';

function simulation(): Simulation {
  return new Simulation({
    seed: 'planner',
    population: 1,
    config: { time: { gameSecondsPerTick: 1 } },
    systems: [new PlannerSystem()],
  });
}

function rememberedWater(): SpatialMemoryEntry {
  return {
    id: 1,
    kind: 'water',
    x: 12,
    z: 8,
    lastSeenTick: 0,
    confidence01: 0.8,
    precisionM: 2,
    encodedConfidence01: 0.8,
    encodedPrecisionM: 2,
    source: 'directPerception',
  };
}

function rememberedFood(): SpatialMemoryEntry {
  return {
    id: 2,
    kind: 'resource',
    x: 14,
    z: 9,
    lastSeenTick: 0,
    confidence01: 0.9,
    precisionM: 1,
    encodedConfidence01: 0.9,
    encodedPrecisionM: 1,
    source: 'directPerception',
    subjectConceptId: 'berry:red',
    foodCandidate: true,
    worldRef: {
      type: 'resource',
      resourceId: 'remembered:berry',
      ownerChunkKey: '0:0',
      localId: 2,
    },
  };
}

function planFor(
  sim: Simulation,
  goal: 'survive.hydrate' | 'survive.nourish' | 'survive.rest' | 'explore',
) {
  const human = sim.humanIds()[0]!;
  sim.entities.getComponentOrThrow(human, HumanCognition).activeGoal = {
    kind: goal,
    startedAtTick: 0,
  };
  sim.start();
  sim.step(10);
  return sim.entities.getComponentOrThrow(human, HumanPlan).activePlan!;
}

describe('PlannerSystem', () => {
  it('builds short templates for all current goals', () => {
    const cases = [
      ['survive.hydrate', ['search.water']],
      ['survive.nourish', ['search.food']],
      ['survive.rest', ['rest']],
      ['explore', ['explore']],
    ] as const;
    for (const [goal, kinds] of cases) {
      const sim = simulation();
      expect(planFor(sim, goal).steps.map((step) => step.kind)).toEqual(kinds);
      sim.dispose();
    }
  });

  it('uses remembered water and food targets without reading their world existence', () => {
    const sim = simulation();
    const human = sim.humanIds()[0]!;
    const memory = sim.entities.getComponentOrThrow(human, CognitiveMemory);
    memory.spatial.push(rememberedWater());
    expect(planFor(sim, 'survive.hydrate').steps.map((step) => step.kind)).toEqual([
      'move.to_water',
      'drink',
    ]);
    sim.dispose();

    const foodSim = simulation();
    const foodHuman = foodSim.humanIds()[0]!;
    foodSim.entities.getComponentOrThrow(foodHuman, CognitiveMemory).spatial.push(rememberedFood());
    const plan = planFor(foodSim, 'survive.nourish');
    expect(plan.steps.map((step) => step.kind)).toEqual(['move.to_resource', 'eat.resource']);
    expect(plan.steps[0]).toMatchObject({ worldRef: { resourceId: 'remembered:berry' } });
    foodSim.dispose();
  });

  it('keeps a committed target after the matching spatial memory is forgotten', () => {
    const sim = simulation();
    const human = sim.humanIds()[0]!;
    const memory = sim.entities.getComponentOrThrow(human, CognitiveMemory);
    memory.spatial.push(rememberedFood());
    const before = planFor(sim, 'survive.nourish');
    memory.spatial.length = 0;
    sim.step(100);
    const after = sim.entities.getComponentOrThrow(human, HumanPlan).activePlan!;
    expect(after.id).toBe(before.id);
    expect(after.steps).toEqual(before.steps);
    sim.dispose();
  });

  it('does not rebuild an unchanged plan on repeated planner ticks', () => {
    const sim = simulation();
    const human = sim.humanIds()[0]!;
    sim.entities.getComponentOrThrow(human, CognitiveMemory).spatial.push(rememberedWater());
    const before = planFor(sim, 'survive.hydrate');
    sim.step(100);
    expect(sim.entities.getComponentOrThrow(human, HumanPlan).activePlan?.id).toBe(before.id);
    sim.dispose();
  });

  it('excludes an unreachable target until it is perceived again and selects an alternative', () => {
    const sim = simulation();
    const human = sim.humanIds()[0]!;
    const memory = sim.entities.getComponentOrThrow(human, CognitiveMemory);
    const failed = rememberedFood();
    const alternative: SpatialMemoryEntry = {
      ...rememberedFood(),
      id: 3,
      x: 40,
      worldRef: {
        type: 'resource',
        resourceId: 'remembered:berry:b',
        ownerChunkKey: '0:0',
        localId: 3,
      },
    };
    memory.spatial.push(failed, alternative);
    sim.entities.getComponentOrThrow(human, HumanCognition).activeGoal = {
      kind: 'survive.nourish',
      startedAtTick: 0,
    };
    const plans = sim.entities.getComponentOrThrow(human, HumanPlan);
    const failure = {
      stepIndex: 0,
      reason: 'target.unreachable' as const,
      tick: 10,
      target: { kind: 'resource' as const, worldRef: failed.worldRef! },
    };
    plans.activePlan = {
      id: 0,
      goalKind: 'survive.nourish',
      createdAtTick: 0,
      currentStepIndex: 0,
      steps: [
        {
          kind: 'move.to_resource',
          worldRef: failed.worldRef!,
          subjectConceptId: failed.subjectConceptId ?? null,
          rememberedX: failed.x,
          rememberedZ: failed.z,
        },
      ],
      lastFailure: failure,
    };
    plans.lastFailure = failure;

    sim.start();
    sim.step(10);
    expect(plans.activePlan?.steps[0]).toMatchObject({
      kind: 'move.to_resource',
      worldRef: { resourceId: 'remembered:berry:b' },
    });
    sim.dispose();
  });

  it('searches instead of immediately retrying the only unreachable target', () => {
    const sim = simulation();
    const human = sim.humanIds()[0]!;
    const failed = rememberedFood();
    sim.entities.getComponentOrThrow(human, CognitiveMemory).spatial.push(failed);
    sim.entities.getComponentOrThrow(human, HumanCognition).activeGoal = {
      kind: 'survive.nourish',
      startedAtTick: 0,
    };
    const plans = sim.entities.getComponentOrThrow(human, HumanPlan);
    const failure = {
      stepIndex: 0,
      reason: 'target.unreachable' as const,
      tick: 10,
      target: { kind: 'resource' as const, worldRef: failed.worldRef! },
    };
    plans.activePlan = {
      id: 0,
      goalKind: 'survive.nourish',
      createdAtTick: 0,
      currentStepIndex: 0,
      steps: [
        {
          kind: 'move.to_resource',
          worldRef: failed.worldRef!,
          subjectConceptId: failed.subjectConceptId ?? null,
          rememberedX: failed.x,
          rememberedZ: failed.z,
        },
      ],
      lastFailure: failure,
    };
    plans.lastFailure = failure;

    sim.start();
    sim.step(10);
    expect(plans.activePlan?.steps).toEqual([{ kind: 'search.food' }]);
    sim.step(50);
    expect(plans.activePlan?.steps).toEqual([{ kind: 'search.food' }]);
    sim.dispose();
  });
});
