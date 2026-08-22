import { describe, expect, it } from 'vitest';
import {
  createEmptyCognitiveKnowledge,
  createEmptyCognitiveMemory,
  type PersonalityComponent,
  type SpatialMemoryEntry,
} from '../components/index.js';
import { applyFoodIngestionEvidence } from './foodBeliefModel.js';
import {
  buildFoodExperimentCandidate,
  foodUncertainty01,
  recentExperimentPenalty01,
} from './experimentModel.js';

const personality: PersonalityComponent = {
  curiosity: 0.8,
  caution: 0.4,
  sociability: 0.5,
  aggression: 0.5,
  patience: 0.5,
  altruism: 0.5,
  courage: 0.5,
  perseverance: 0.5,
};
const config = { minimumInterest01: 0.1, recentRepeatSeconds: 600, distanceScaleMeters: 32 };

function food(): SpatialMemoryEntry {
  return {
    id: 0,
    kind: 'resource',
    x: 8,
    z: 0,
    lastSeenTick: 0,
    confidence01: 1,
    precisionM: 1,
    encodedConfidence01: 1,
    encodedPrecisionM: 1,
    source: 'directPerception',
    subjectConceptId: 'berry:red',
    foodCandidate: true,
    worldRef: { type: 'resource', resourceId: 'berry:a', ownerChunkKey: '0:0', localId: 1 },
  };
}

describe('food experimentation model', () => {
  it('treats unknown food as uncertain without declaring it dangerous', () => {
    const knowledge = createEmptyCognitiveKnowledge();
    const candidate = buildFoodExperimentCandidate(
      food(),
      createEmptyCognitiveMemory(),
      knowledge,
      personality,
      0,
      0,
      0,
      1,
      config,
    );
    expect(foodUncertainty01(knowledge, 'berry:red')).toBe(1);
    expect(candidate?.score01).toBeGreaterThan(0);
    expect(candidate?.factors).toContainEqual({
      code: 'knowledge.unknown',
      conceptId: 'berry:red',
    });
  });

  it('reduces uncertainty after coherent evidence and restores it for contradictions', () => {
    const knowledge = createEmptyCognitiveKnowledge();
    for (let tick = 1; tick <= 10; tick++)
      applyFoodIngestionEvidence(knowledge, 'berry:red', true, false, tick);
    const coherent = foodUncertainty01(knowledge, 'berry:red');
    for (let tick = 11; tick <= 20; tick++)
      applyFoodIngestionEvidence(knowledge, 'berry:red', false, true, tick);
    expect(coherent).toBeLessThan(0.2);
    expect(foodUncertainty01(knowledge, 'berry:red')).toBeGreaterThan(coherent);
  });

  it('responds to curiosity and caution using belief rather than world truth', () => {
    const memory = createEmptyCognitiveMemory();
    const knowledge = createEmptyCognitiveKnowledge();
    applyFoodIngestionEvidence(knowledge, 'berry:red', true, true, 1);
    const score = (traits: PersonalityComponent) =>
      buildFoodExperimentCandidate(food(), memory, knowledge, traits, 0, 0, 2, 1, config)!.score01;
    expect(score({ ...personality, curiosity: 0.9 })).toBeGreaterThan(
      score({ ...personality, curiosity: 0.2 }),
    );
    expect(score({ ...personality, caution: 0.9 })).toBeLessThan(
      score({ ...personality, caution: 0.1 }),
    );
  });

  it('penalizes only a recent deliberate trial of the same perceptual concept', () => {
    const memory = createEmptyCognitiveMemory();
    memory.episodic.push({
      id: 0,
      tick: 100,
      eventType: 'food.ingestion',
      actors: [1],
      outcome: 'physiology.satiety_increased',
      emotionalStrength01: 0.2,
      experience: {
        kind: 'food.ingestion',
        subjectConceptId: 'berry:red',
        motivation: 'deliberateExperiment',
        actionTick: 90,
        outcomeTick: 100,
        hungerBefore01: 0.4,
        hungerAfter01: 0.5,
        illnessObserved: false,
      },
    });
    expect(recentExperimentPenalty01(memory, 'berry:red', 100, 1, 600)).toBe(0);
    expect(recentExperimentPenalty01(memory, 'berry:red', 400, 1, 600)).toBe(0.5);
    expect(recentExperimentPenalty01(memory, 'mushroom:brown', 100, 1, 600)).toBe(1);
  });
});
