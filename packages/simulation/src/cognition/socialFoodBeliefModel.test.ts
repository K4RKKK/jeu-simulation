import { describe, expect, it } from 'vitest';
import { createEmptyCognitiveKnowledge } from '../components/cognitiveKnowledge.js';
import {
  FOOD_OBSERVED_INGESTION_PROPERTY,
  applyObservedFoodIngestionEvidence,
  observedFoodIngestionConfidence01,
} from './socialFoodBeliefModel.js';

describe('socialFoodBeliefModel — food.observedIngestion', () => {
  it('crée une belief avec value01=1 et confidence=gain à la première observation', () => {
    const knowledge = createEmptyCognitiveKnowledge();
    applyObservedFoodIngestionEvidence(knowledge, 'berry:red', 10, 0.25);
    expect(knowledge.beliefs).toHaveLength(1);
    const belief = knowledge.beliefs[0]!;
    expect(belief.property).toBe(FOOD_OBSERVED_INGESTION_PROPERTY);
    expect(belief.value).toEqual({ kind: 'probability', value01: 1 });
    expect(belief.confidence01).toBeCloseTo(0.25);
    expect(belief.evidenceCount).toBe(1);
    expect(belief.lastUpdatedTick).toBe(10);
  });

  it("approche 1 sans jamais l'atteindre — formule multiplicative", () => {
    const knowledge = createEmptyCognitiveKnowledge();
    for (let i = 0; i < 4; i++) {
      applyObservedFoodIngestionEvidence(knowledge, 'berry:red', i + 1, 0.25);
    }
    const confidence = observedFoodIngestionConfidence01(knowledge, 'berry:red');
    // 1 - (1 - 0.25)^4 ≈ 0.684
    expect(confidence).toBeGreaterThan(0.6);
    expect(confidence).toBeLessThan(1);
    for (let i = 0; i < 100; i++) {
      applyObservedFoodIngestionEvidence(knowledge, 'berry:red', 100 + i, 0.25);
    }
    expect(observedFoodIngestionConfidence01(knowledge, 'berry:red')).toBeLessThan(1);
  });

  it('laisse INTACTES les croyances food.nourishing et food.illnessRisk', () => {
    const knowledge = createEmptyCognitiveKnowledge();
    // Pose manuellement des croyances de vérité — la belief sociale ne doit pas les
    // effacer, les modifier ni empêcher leur lecture future.
    knowledge.beliefs.push({
      id: 100,
      subjectConcept: 'berry:red',
      property: 'food.nourishing',
      value: { kind: 'probability', value01: 0.8 },
      confidence01: 0.7,
      evidenceCount: 3,
      lastUpdatedTick: 0,
    });
    knowledge.beliefs.push({
      id: 101,
      subjectConcept: 'berry:red',
      property: 'food.illnessRisk',
      value: { kind: 'probability', value01: 0.05 },
      confidence01: 0.9,
      evidenceCount: 6,
      lastUpdatedTick: 0,
    });
    applyObservedFoodIngestionEvidence(knowledge, 'berry:red', 42, 0.25);
    const nourishing = knowledge.beliefs.find((b) => b.property === 'food.nourishing')!;
    const illnessRisk = knowledge.beliefs.find((b) => b.property === 'food.illnessRisk')!;
    expect(nourishing.value).toEqual({ kind: 'probability', value01: 0.8 });
    expect(nourishing.confidence01).toBe(0.7);
    expect(illnessRisk.value).toEqual({ kind: 'probability', value01: 0.05 });
    expect(illnessRisk.confidence01).toBe(0.9);
  });

  it('evidenceCount croît, la valeur reste 1', () => {
    const knowledge = createEmptyCognitiveKnowledge();
    for (let i = 0; i < 5; i++) applyObservedFoodIngestionEvidence(knowledge, 'berry:red', i, 0.3);
    const belief = knowledge.beliefs.find((b) => b.subjectConcept === 'berry:red')!;
    expect(belief.evidenceCount).toBe(5);
    expect(belief.value).toEqual({ kind: 'probability', value01: 1 });
  });

  it('clampe un gain hors bornes en toute sécurité', () => {
    const knowledge = createEmptyCognitiveKnowledge();
    applyObservedFoodIngestionEvidence(knowledge, 'berry:red', 0, -0.5);
    expect(observedFoodIngestionConfidence01(knowledge, 'berry:red')).toBe(0);
    applyObservedFoodIngestionEvidence(knowledge, 'mushroom:brown', 0, 2);
    expect(observedFoodIngestionConfidence01(knowledge, 'mushroom:brown')).toBe(1);
    // Après clamp à 1, un appel supplémentaire ne casse rien.
    applyObservedFoodIngestionEvidence(knowledge, 'mushroom:brown', 1, 0.5);
    expect(observedFoodIngestionConfidence01(knowledge, 'mushroom:brown')).toBe(1);
  });

  it('retourne 0 pour un concept jamais observé', () => {
    const knowledge = createEmptyCognitiveKnowledge();
    expect(observedFoodIngestionConfidence01(knowledge, 'berry:red')).toBe(0);
    expect(observedFoodIngestionConfidence01(knowledge, undefined)).toBe(0);
    expect(observedFoodIngestionConfidence01(knowledge, null)).toBe(0);
  });
});
