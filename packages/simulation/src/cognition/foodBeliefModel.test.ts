import { describe, expect, it } from 'vitest';
import { createEmptyCognitiveKnowledge } from '../components/cognitiveKnowledge.js';
import { FOOD_EDIBLE_PROPERTY, learnFoodEdibility, learnedEdibility01 } from './foodBeliefModel.js';

describe('foodBeliefModel', () => {
  it('consolide uniquement les expériences personnelles du concept observé', () => {
    const knowledge = createEmptyCognitiveKnowledge();

    learnFoodEdibility(knowledge, 'mushroom:spotted', false, 10);
    expect(learnedEdibility01(knowledge, 'mushroom:spotted')).toBe(0);
    expect(learnedEdibility01(knowledge, 'berry:red')).toBeNull();

    learnFoodEdibility(knowledge, 'mushroom:spotted', true, 20);
    expect(knowledge.beliefs).toHaveLength(1);
    expect(knowledge.beliefs[0]).toMatchObject({
      property: FOOD_EDIBLE_PROPERTY,
      value: { kind: 'probability', value01: 0.5 },
      evidenceCount: 2,
      lastUpdatedTick: 20,
    });
    expect(knowledge.beliefs[0]!.confidence01).toBeCloseTo(2 / 3);
  });
});
