import { describe, expect, it } from 'vitest';
import { CognitiveKnowledge, CognitiveMemory, HumanSkills } from '../../components/index.js';
import { rememberEpisodic } from '../../cognition/episodicMemoryModel.js';
import {
  FOOD_ILLNESS_RISK_PROPERTY,
  FOOD_NOURISHING_PROPERTY,
} from '../../cognition/foodBeliefModel.js';
import { Simulation } from '../../simulation.js';
import { LearningSystem } from './learningSystem.js';

function simulation(maxEpisodicEntries = 64): Simulation {
  return new Simulation({
    seed: 'learning-system',
    population: 2,
    config: { time: { gameSecondsPerTick: 1 }, cognition: { maxEpisodicEntries } },
    systems: [new LearningSystem()],
  });
}

function addIngestion(
  simulation: Simulation,
  humanId: number,
  illnessObserved: boolean,
  motivation: 'need' | 'deliberateExperiment' = 'need',
): void {
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
        motivation,
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

function addGathering(simulation: Simulation, humanId: number, tick = 1): void {
  const memory = simulation.entities.getComponentOrThrow(humanId, CognitiveMemory);
  rememberEpisodic(
    memory,
    {
      tick,
      eventType: 'resource.gathering',
      actors: [humanId],
      outcome: 'resource.portion_detached',
      emotionalStrength01: 0.2,
      experience: {
        kind: 'resource.gathering',
        subjectConceptId: 'berry:red',
        actionTick: tick - 1,
        outcomeTick: tick,
        completed: true,
      },
    },
    simulation.config.cognition,
  );
}

describe('LearningSystem', () => {
  it('consolidates successful gathering exactly once into individual skill only', () => {
    const world = simulation();
    const [practiced, novice] = world.humanIds();
    addGathering(world, practiced!);
    world.start();
    world.step(6);
    const skills = world.entities.getComponentOrThrow(practiced!, HumanSkills);
    expect(skills.skills[0]).toMatchObject({
      kind: 'resource.gathering',
      proficiency01: 0.04,
      practiceCount: 1,
      lastPracticedTick: 1,
    });
    expect(world.entities.getComponentOrThrow(novice!, HumanSkills).skills).toEqual([]);
    expect(world.entities.getComponentOrThrow(practiced!, CognitiveKnowledge).beliefs).toEqual([]);
    world.step(60);
    expect(skills.skills[0]?.practiceCount).toBe(1);
    world.dispose();
  });

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

  it('learns identical evidence from need and deliberate experiment outcomes', () => {
    const world = simulation();
    const [needHuman, experimentHuman] = world.humanIds();
    addIngestion(world, needHuman!, false, 'need');
    addIngestion(world, experimentHuman!, false, 'deliberateExperiment');
    world.start();
    world.step(6);
    const withoutIds = (human: number) =>
      world.entities
        .getComponentOrThrow(human, CognitiveKnowledge)
        .beliefs.map(({ id: _id, ...belief }) => belief);
    expect(withoutIds(experimentHuman!)).toEqual(withoutIds(needHuman!));
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

  it('prune le dÃ©bordement seulement aprÃ¨s avoir consolidÃ© toutes les expÃ©riences', () => {
    const world = simulation(1);
    world.start();
    const human = world.humanIds()[0]!;
    addIngestion(world, human, false);
    addIngestion(world, human, true);
    const memory = world.entities.getComponentOrThrow(human, CognitiveMemory);
    expect(memory.episodic).toHaveLength(2);

    world.step(6);

    expect(memory.lastProcessedExperienceId).toBe(1);
    expect(memory.episodic).toHaveLength(1);
    const knowledge = world.entities.getComponentOrThrow(human, CognitiveKnowledge);
    expect(knowledge.beliefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: FOOD_NOURISHING_PROPERTY, evidenceCount: 2 }),
        expect.objectContaining({ property: FOOD_ILLNESS_RISK_PROPERTY, evidenceCount: 2 }),
      ]),
    );
    world.dispose();
  });
});
