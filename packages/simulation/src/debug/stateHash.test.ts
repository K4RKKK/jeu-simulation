import { describe, expect, it } from 'vitest';
import {
  CognitiveKnowledge,
  CognitiveMemory,
  HumanCognition,
  HumanPlan,
  NeedsState,
  allocateBeliefId,
  allocateMemoryId,
} from '../components/index.js';
import { Simulation } from '../simulation.js';
import { hashSnapshot, hashWorldState } from './stateHash.js';

function makeSimulation(seed: string, population = 6): Simulation {
  return new Simulation({ seed, population, config: { time: { gameSecondsPerTick: 1 } } });
}

describe('hashSnapshot', () => {
  it('égale hashWorldState(source) au moment MÊME de la capture — sans passer par restoreSnapshot', () => {
    const source = makeSimulation('hash-snapshot-capture', 8);
    source.start();
    source.step(400);

    const hashOfSource = hashWorldState(source);
    const snapshot = source.captureSnapshot();

    expect(hashSnapshot(snapshot)).toBe(hashOfSource);
    source.dispose();
  });

  it('égale hashWorldState(target) après restoreSnapshot dans une simulation fraîche', () => {
    const source = makeSimulation('hash-snapshot-restore', 8);
    source.start();
    source.step(400);
    const snapshot = source.captureSnapshot();
    source.dispose();

    const target = makeSimulation('hash-snapshot-restore', 8);
    target.restoreSnapshot(snapshot);

    expect(hashSnapshot(snapshot)).toBe(hashWorldState(target));
    target.dispose();
  });

  it('change quand le contenu du snapshot change (population différente)', () => {
    const a = makeSimulation('hash-snapshot-diff-a', 4);
    a.step(50);
    const snapshotA = a.captureSnapshot();
    a.dispose();

    const b = makeSimulation('hash-snapshot-diff-b', 5);
    b.step(50);
    const snapshotB = b.captureSnapshot();
    b.dispose();

    expect(hashSnapshot(snapshotA)).not.toBe(hashSnapshot(snapshotB));
  });
});

/**
 * Sensibilité du hash aux composants cognitifs (Phase 3.1). Sans ces tests, deux mondes
 * avec des croyances/souvenirs cognitifs différents pourraient partager le même hash —
 * exactement le faux positif déjà corrigé une fois pour l'ancien `Memory` (voir la doc
 * de tête de `stateHash.ts`).
 */
describe('hashWorldState — sensibilité aux composants cognitifs', () => {
  it('change quand une croyance change', () => {
    const simulation = new Simulation({
      seed: 'hash-belief',
      population: 1,
      config: { time: { gameSecondsPerTick: 1 } },
    });
    const [human] = simulation.humanIds();
    if (human === undefined) throw new Error('aucun humain');
    const before = hashWorldState(simulation);

    const knowledge = simulation.entities.getComponentOrThrow(human, CognitiveKnowledge);
    knowledge.beliefs.push({
      id: allocateBeliefId(knowledge),
      subjectConcept: 'berry:red:round',
      property: 'edible',
      value: { kind: 'probability', value01: 0.6 },
      confidence01: 0.6,
      evidenceCount: 1,
      lastUpdatedTick: 0,
    });

    expect(hashWorldState(simulation)).not.toBe(before);
    simulation.dispose();
  });

  it('change quand une mémoire spatiale change', () => {
    const simulation = new Simulation({
      seed: 'hash-memory',
      population: 1,
      config: { time: { gameSecondsPerTick: 1 } },
    });
    const [human] = simulation.humanIds();
    if (human === undefined) throw new Error('aucun humain');
    const before = hashWorldState(simulation);

    const memory = simulation.entities.getComponentOrThrow(human, CognitiveMemory);
    memory.spatial.push({
      id: allocateMemoryId(memory),
      kind: 'water',
      x: 1,
      z: 2,
      lastSeenTick: 0,
      confidence01: 0.9,
      precisionM: 1,
      encodedConfidence01: 0.9,
      encodedPrecisionM: 1,
      source: 'directPerception',
    });

    expect(hashWorldState(simulation)).not.toBe(before);
    simulation.dispose();
  });

  it('changes when the learning watermark changes', () => {
    const simulation = new Simulation({
      seed: 'hash-learning-watermark',
      population: 1,
      config: { time: { gameSecondsPerTick: 1 } },
    });
    const [human] = simulation.humanIds();
    if (human === undefined) throw new Error('aucun humain');
    const before = hashWorldState(simulation);

    const memory = simulation.entities.getComponentOrThrow(human, CognitiveMemory);
    memory.lastProcessedExperienceId = 42;

    expect(hashWorldState(simulation)).not.toBe(before);
    simulation.dispose();
  });

  it('changes when a meal experience baseline changes', () => {
    const simulation = new Simulation({
      seed: 'hash-meal-baseline',
      population: 1,
      config: { time: { gameSecondsPerTick: 1 } },
    });
    const [human] = simulation.humanIds();
    if (human === undefined) throw new Error('aucun humain');
    const state = simulation.entities.addComponent(human, NeedsState, {
      action: 'eat',
      targetX: null,
      targetZ: null,
      resourceId: 'food-1',
      resourceOwnerChunkKey: '0:0',
      resourceLocalId: 1,
      resourceConceptId: 'berry:red',
      mealStartedTick: 10,
      mealHungerBefore01: 0.2,
      untilTick: 20,
      mealMaxGain: 0.4,
      poisoningUntilTick: -1,
      poisoningToxicity01: 0,
      currentMealCausedPoisoning: false,
      pathFailedAtTick: -1,
    });
    const hashA = hashWorldState(simulation);

    state.mealStartedTick = 11;
    const tickHash = hashWorldState(simulation);
    state.mealStartedTick = 10;
    state.mealHungerBefore01 = 0.3;
    const hungerHash = hashWorldState(simulation);

    expect(tickHash).not.toBe(hashA);
    expect(hungerHash).not.toBe(hashA);
    simulation.dispose();
  });

  it('change quand seul encodedConfidence01 change', () => {
    const simulation = new Simulation({
      seed: 'hash-encoded-confidence',
      population: 1,
      config: { time: { gameSecondsPerTick: 1 } },
    });
    const [human] = simulation.humanIds();
    if (human === undefined) throw new Error('aucun humain');

    const memory = simulation.entities.getComponentOrThrow(human, CognitiveMemory);
    const base = {
      id: allocateMemoryId(memory),
      kind: 'water' as const,
      x: 10,
      z: 20,
      lastSeenTick: 0,
      confidence01: 0.8,
      precisionM: 2,
      encodedConfidence01: 0.8,
      encodedPrecisionM: 2,
      source: 'directPerception' as const,
    };
    memory.spatial.push(base);
    const hashA = hashWorldState(simulation);

    memory.spatial[memory.spatial.length - 1] = { ...base, encodedConfidence01: 0.3 };
    const hashB = hashWorldState(simulation);

    expect(hashA).not.toBe(hashB);
    simulation.dispose();
  });

  it('change quand l’état de décision change', () => {
    const simulation = new Simulation({
      seed: 'hash-cognition',
      population: 1,
      config: { time: { gameSecondsPerTick: 1 } },
    });
    const [human] = simulation.humanIds();
    if (human === undefined) throw new Error('aucun humain');
    const before = hashWorldState(simulation);

    const cognition = simulation.entities.getComponentOrThrow(human, HumanCognition);
    cognition.activeGoal = { kind: 'survive.hydrate', startedAtTick: 17 };
    cognition.decisionReason = {
      code: 'need.thirst',
      factors: [{ code: 'need.thirst.urgency', value: 0.9 }],
    };

    expect(hashWorldState(simulation)).not.toBe(before);
    const afterKind = hashWorldState(simulation);
    cognition.activeGoal = { kind: 'survive.hydrate', startedAtTick: 18 };
    expect(hashWorldState(simulation)).not.toBe(afterKind);
    simulation.dispose();
  });

  it('changes when a persisted plan changes', () => {
    const simulation = makeSimulation('hash-plan', 1);
    const human = simulation.humanIds()[0]!;
    const plan = simulation.entities.getComponentOrThrow(human, HumanPlan);
    plan.activePlan = {
      id: 3,
      goalKind: 'survive.nourish',
      createdAtTick: 9,
      currentStepIndex: 0,
      steps: [
        {
          kind: 'move.to_resource',
          worldRef: { type: 'resource', resourceId: 'berry:1', ownerChunkKey: '0:0', localId: 1 },
          subjectConceptId: 'berry:red',
          rememberedX: 5,
          rememberedZ: 6,
        },
        {
          kind: 'eat.resource',
          worldRef: { type: 'resource', resourceId: 'berry:1', ownerChunkKey: '0:0', localId: 1 },
          subjectConceptId: 'berry:red',
        },
      ],
      lastFailure: null,
    };
    const before = hashWorldState(simulation);
    plan.activePlan.currentStepIndex = 1;
    expect(hashWorldState(simulation)).not.toBe(before);
    simulation.dispose();
  });

  it('hashSnapshot(snapshot) == hashWorldState(simulation) avec des composants cognitifs remplis', () => {
    const simulation = new Simulation({
      seed: 'hash-cognition-snapshot',
      population: 1,
      config: { time: { gameSecondsPerTick: 1 } },
    });
    const [human] = simulation.humanIds();
    if (human === undefined) throw new Error('aucun humain');

    const knowledge = simulation.entities.getComponentOrThrow(human, CognitiveKnowledge);
    knowledge.beliefs.push({
      id: allocateBeliefId(knowledge),
      subjectConcept: 'berry:red:round',
      property: 'edible',
      value: { kind: 'probability', value01: 0.6 },
      confidence01: 0.6,
      evidenceCount: 1,
      lastUpdatedTick: 0,
    });

    const snapshot = simulation.captureSnapshot();
    expect(hashSnapshot(snapshot)).toBe(hashWorldState(simulation));
    simulation.dispose();
  });
});
