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
  foodOutcomeAmbiguity01,
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
const config = {
  minimumInterest01: 0.1,
  recentRepeatSeconds: 600,
  distanceScaleMeters: 32,
  socialImitationWeight: 0,
};

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

  it('separates information need from well-known outcome ambiguity', () => {
    const fewContradictory = createEmptyCognitiveKnowledge();
    applyFoodIngestionEvidence(fewContradictory, 'berry:red', true, false, 1);
    applyFoodIngestionEvidence(fewContradictory, 'berry:red', false, true, 2);

    const manyContradictory = createEmptyCognitiveKnowledge();
    const coherentSafe = createEmptyCognitiveKnowledge();
    for (let tick = 1; tick <= 100; tick++) {
      const positive = tick % 2 === 0;
      applyFoodIngestionEvidence(manyContradictory, 'berry:red', positive, !positive, tick);
      applyFoodIngestionEvidence(coherentSafe, 'berry:red', true, false, tick);
    }

    const fewUncertainty = foodUncertainty01(fewContradictory, 'berry:red');
    const manyUncertainty = foodUncertainty01(manyContradictory, 'berry:red');
    expect(fewUncertainty).toBeGreaterThan(0.25);
    expect(foodOutcomeAmbiguity01(manyContradictory, 'berry:red')).toBeCloseTo(1);
    expect(manyUncertainty).toBeLessThan(fewUncertainty / 10);
    expect(foodUncertainty01(coherentSafe, 'berry:red')).toBeLessThan(0.01);

    const memory = createEmptyCognitiveMemory();
    const candidate = (knowledge: typeof manyContradictory) =>
      buildFoodExperimentCandidate(food(), memory, knowledge, personality, 0, 0, 200, 1, config)!;
    expect(candidate(manyContradictory).score01).toBeLessThan(
      candidate(fewContradictory).score01 / 10,
    );
    expect(candidate(manyContradictory).factors).toContainEqual({
      code: 'knowledge.outcomeAmbiguity',
      value: 1,
      conceptId: 'berry:red',
    });
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

  describe('Phase 3.8 — social imitation support', () => {
    it('adds social.imitationSupport as a DecisionFactor (0 quand rien vu)', () => {
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
      )!;
      expect(candidate.factors).toContainEqual({
        code: 'social.imitationSupport',
        value: 0,
        conceptId: 'berry:red',
      });
    });

    it("SOCIAL SUPPORT : une observation sociale AUGMENTE le score, sans écraser la base", () => {
      const memory = createEmptyCognitiveMemory();
      const knowledge = createEmptyCognitiveKnowledge();
      const weighted = { ...config, socialImitationWeight: 0.35 };
      const before = buildFoodExperimentCandidate(
        food(),
        memory,
        knowledge,
        personality,
        0,
        0,
        0,
        1,
        weighted,
      )!;
      // Simule 3 observations sociales consolidées.
      knowledge.beliefs.push({
        id: 0,
        subjectConcept: 'berry:red',
        property: 'food.observedIngestion',
        value: { kind: 'probability', value01: 1 },
        confidence01: 0.5,
        evidenceCount: 3,
        lastUpdatedTick: 0,
      });
      const after = buildFoodExperimentCandidate(
        food(),
        memory,
        knowledge,
        personality,
        0,
        0,
        0,
        1,
        weighted,
      )!;
      expect(after.score01).toBeGreaterThan(before.score01);
      // Le score reste borné : (1 + 0.35 * 1) = 1.35 max, clamp01 → jamais > 1.
      expect(after.score01).toBeLessThanOrEqual(1);
      // Le facteur social apparaît avec la vraie confidence, pas 0.
      expect(after.factors).toContainEqual({
        code: 'social.imitationSupport',
        value: 0.5,
        conceptId: 'berry:red',
      });
    });

    it("KNOWN DANGER : une croyance personnelle forte de danger domine l'imitation sociale", () => {
      const memory = createEmptyCognitiveMemory();
      const knowledge = createEmptyCognitiveKnowledge();
      // Personnalité prudente + risque personnel élevé et bien établi.
      const cautious: PersonalityComponent = { ...personality, caution: 0.95, curiosity: 0.5 };
      for (let i = 0; i < 10; i++) {
        applyFoodIngestionEvidence(knowledge, 'berry:red', false, true, i);
      }
      // Support social maximal.
      knowledge.beliefs.push({
        id: 999,
        subjectConcept: 'berry:red',
        property: 'food.observedIngestion',
        value: { kind: 'probability', value01: 1 },
        confidence01: 0.95,
        evidenceCount: 20,
        lastUpdatedTick: 0,
      });
      const weighted = { ...config, socialImitationWeight: 0.35 };
      const candidate = buildFoodExperimentCandidate(
        food(),
        memory,
        knowledge,
        cautious,
        0,
        0,
        20,
        1,
        weighted,
      )!;
      // La base est très basse (haute confiance illnessRisk × haute caution) ;
      // même multiplié par (1 + 0.35 * 0.95) ≈ 1.33, le score final reste bien
      // sous minimumInterest01 = 0.1 — l'imitation n'écrase pas le savoir personnel.
      expect(candidate.score01).toBeLessThan(0.1);
    });
  });
});
