import { describe, expect, it } from 'vitest';
import {
  CognitiveKnowledge,
  CognitiveMemory,
  HumanCognition,
  allocateBeliefId,
  allocateMemoryId,
} from '../components/index.js';
import { Simulation } from '../simulation.js';

function makeSimulation(seed: string): Simulation {
  return new Simulation({ seed, population: 2, config: { time: { gameSecondsPerTick: 1 } } });
}

/**
 * Round-trip de persistance pour les trois composants cognitifs (Phase 3.1).
 *
 * Aucun système n'écrit encore dans ces composants (P3.2+) : les entrées ci-dessous
 * sont fabriquées à la main, exactement comme `needSatisfactionSystem.test.ts` le fait
 * déjà pour `Memory` — ça prouve le round-trip de la STRUCTURE, indépendamment de la
 * logique qui la remplira plus tard.
 */
describe('persistance des composants cognitifs', () => {
  it('conserve mémoire spatiale/épisodique/sociale, croyances et état de décision', () => {
    const simulation = makeSimulation('cognition-persistence');
    const [human] = simulation.humanIds();
    if (human === undefined) throw new Error('aucun humain dans la simulation de test');

    const memory = simulation.entities.getComponentOrThrow(human, CognitiveMemory);
    const spatialId = allocateMemoryId(memory);
    memory.spatial.push({
      id: spatialId,
      kind: 'resource',
      x: 12.5,
      z: -8.25,
      lastSeenTick: 40,
      confidence01: 0.8,
      precisionM: 1.5,
      encodedConfidence01: 0.8,
      encodedPrecisionM: 1.5,
      source: 'directPerception',
      subjectConceptId: 'berry:red:round',
      worldRef: {
        type: 'resource',
        resourceId: 'berry_bush@3:4',
        ownerChunkKey: '0:0',
        localId: 2,
      },
    });
    const episodicId = allocateMemoryId(memory);
    memory.episodic.push({
      id: episodicId,
      tick: 41,
      eventType: 'food.eaten',
      actors: [human],
      subjectConcept: 'berry:red:round',
      x: 12.5,
      z: -8.25,
      outcome: 'physiology.satiety_increased',
      emotionalStrength01: 0.3,
    });
    const socialId = allocateMemoryId(memory);
    memory.social.push({
      id: socialId,
      humanId: human,
      trust01: 0.6,
      familiarity01: 0.4,
      lastContactTick: 41,
    });

    const knowledge = simulation.entities.getComponentOrThrow(human, CognitiveKnowledge);
    const beliefId = allocateBeliefId(knowledge);
    knowledge.beliefs.push({
      id: beliefId,
      subjectConcept: 'berry:red:round',
      property: 'edible',
      value: { kind: 'probability', value01: 0.72 },
      confidence01: 0.72,
      evidenceCount: 1,
      lastUpdatedTick: 41,
    });

    const cognition = simulation.entities.getComponentOrThrow(human, HumanCognition);
    cognition.activeGoalId = 'goal:reduceHunger';
    cognition.decisionReason = {
      code: 'need.hunger',
      factors: [
        { code: 'need.hunger.urgency', value: 0.65 },
        { code: 'memory.food.distance', value: 12, conceptId: 'berry:red:round' },
      ],
    };

    const snapshot = simulation.captureSnapshot();
    simulation.dispose();

    const restored = makeSimulation('cognition-persistence');
    restored.restoreSnapshot(snapshot);

    expect(restored.entities.getComponentOrThrow(human, CognitiveMemory)).toEqual(memory);
    expect(restored.entities.getComponentOrThrow(human, CognitiveKnowledge)).toEqual(knowledge);
    expect(restored.entities.getComponentOrThrow(human, HumanCognition)).toEqual(cognition);
    restored.dispose();
  });
});
