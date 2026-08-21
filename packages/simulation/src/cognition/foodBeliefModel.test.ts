import { describe, expect, it } from 'vitest';
import { createEmptyCognitiveKnowledge } from '../components/cognitiveKnowledge.js';
import {
  applyFoodIngestionEvidence,
  FOOD_ILLNESS_RISK_PROPERTY,
  learnedFoodProbability01,
} from './foodBeliefModel.js';

describe('foodBeliefModel', () => {
  it('consolide uniquement les expériences personnelles du concept observé', () => {
    const knowledge = createEmptyCognitiveKnowledge();

    applyFoodIngestionEvidence(knowledge, 'mushroom:spotted', true, true, 10);
    expect(
      learnedFoodProbability01(knowledge, 'mushroom:spotted', FOOD_ILLNESS_RISK_PROPERTY),
    ).toBe(1);
    expect(learnedFoodProbability01(knowledge, 'berry:red', FOOD_ILLNESS_RISK_PROPERTY)).toBeNull();

    applyFoodIngestionEvidence(knowledge, 'mushroom:spotted', true, false, 20);
    expect(knowledge.beliefs).toHaveLength(2);
    expect(knowledge.beliefs[1]).toMatchObject({
      property: FOOD_ILLNESS_RISK_PROPERTY,
      value: { kind: 'probability', value01: 0.5 },
      evidenceCount: 2,
      lastUpdatedTick: 20,
    });
    expect(knowledge.beliefs[1]!.confidence01).toBeCloseTo(2 / 3);
  });
});
