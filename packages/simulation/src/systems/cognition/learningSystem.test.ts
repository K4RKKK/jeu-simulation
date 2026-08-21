import { describe, expect, it } from 'vitest';
import { CognitiveKnowledge, CognitiveMemory } from '../../components/index.js';
import { rememberEpisodic } from '../../cognition/episodicMemoryModel.js';
import {
  FOOD_ILLNESS_RISK_PROPERTY,
  FOOD_NOURISHING_PROPERTY,
} from '../../cognition/foodBeliefModel.js';
import { Simulation } from '../../simulation.js';
import { LearningSystem } from './learningSystem.js';

function simulation(): Simulation {
  return new Simulation({
    seed: 'learning-system',
    population: 2,
    config: { time: { gameSecondsPerTick: 1 } },
    systems: [new LearningSystem()],
  });
}

function addIngestion(simulation: Simulation, humanId: number, illnessObserved: boolean): void {
  const memory = simulation.entities.getComponentOrThrow(humanId, CognitiveMemory);
  rememberEpisodic(
    memory,
    {
      tick: 1,
      eventType: 'food.ingestion',
      actors: [humanId],
      subjectConcept: 'mushroom:brown:small',
      outcome: illnessObserved ? 'physiology.poisoning_started' : 'physiology.satiety_increased',
      emotionalStrength01: illnessObserved ? 0.8 : 0.2,
      experience: {
        kind: 'food.ingestion',
        subjectConceptId: 'mushroom:brown:small',
        actionTick: 0,
        outcomeTick: 1,
        hungerBefore01: 0.1,
        hungerAfter01: 0.3,
        illnessObserved,
      },
    },
    simulation.config.cognition,
  );
}

describe('LearningSystem', () => {
  it('consolide une ingestion une seule fois et sépare nutrition et risque', () => {
    const world = simulation();
    world.start();
    const human = world.humanIds()[0]!;
    addIngestion(world, human, true);
    world.step(6);
    const knowledge = world.entities.getComponentOrThrow(human, CognitiveKnowledge);
    expect(knowledge.beliefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: FOOD_NOURISHING_PROPERTY, evidenceCount: 1 }),
        expect.objectContaining({ property: FOOD_ILLNESS_RISK_PROPERTY, evidenceCount: 1 }),
      ]),
    );
    const before = JSON.stringify(knowledge.beliefs);
    world.step(60);
    expect(JSON.stringify(knowledge.beliefs)).toBe(before);
    world.dispose();
  });

  it('garde les croyances individuelles', () => {
    const world = simulation();
    world.start();
    const [a, b] = world.humanIds();
    addIngestion(world, a!, false);
    world.step(6);
    expect(world.entities.getComponentOrThrow(a!, CognitiveKnowledge).beliefs).toHaveLength(2);
    expect(world.entities.getComponentOrThrow(b!, CognitiveKnowledge).beliefs).toHaveLength(0);
    world.dispose();
  });
});
