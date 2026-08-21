import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation.js';
import {
  CognitiveKnowledge,
  CognitiveMemory,
  HumanCognition,
  allocateBeliefId,
  allocateMemoryId,
  createEmptyCognitiveKnowledge,
  createEmptyCognitiveMemory,
} from './index.js';

function makeSimulation(seed: string): Simulation {
  return new Simulation({ seed, population: 3, config: { time: { gameSecondsPerTick: 1 } } });
}

describe('composants cognitifs (Phase 3.1)', () => {
  it('un humain neuf porte les trois composants cognitifs, réellement vides', () => {
    const simulation = makeSimulation('cognition-spawn');
    for (const id of simulation.humanIds()) {
      const memory = simulation.entities.getComponentOrThrow(id, CognitiveMemory);
      expect(memory).toEqual({
        nextMemoryId: 0,
        spatial: [],
        episodic: [],
        lastProcessedExperienceId: null,
        social: [],
      });

      const knowledge = simulation.entities.getComponentOrThrow(id, CognitiveKnowledge);
      expect(knowledge).toEqual({ nextBeliefId: 0, beliefs: [] });

      const cognition = simulation.entities.getComponentOrThrow(id, HumanCognition);
      expect(cognition).toEqual({ activeGoalId: null, decisionReason: null });
    }
    simulation.dispose();
  });

  it('allocateMemoryId distribue des identifiants séquentiels et déterministes', () => {
    const memory = createEmptyCognitiveMemory();
    expect(allocateMemoryId(memory)).toBe(0);
    expect(allocateMemoryId(memory)).toBe(1);
    expect(allocateMemoryId(memory)).toBe(2);
    expect(memory.nextMemoryId).toBe(3);
  });

  it('allocateBeliefId distribue des identifiants séquentiels et déterministes', () => {
    const knowledge = createEmptyCognitiveKnowledge();
    expect(allocateBeliefId(knowledge)).toBe(0);
    expect(allocateBeliefId(knowledge)).toBe(1);
    expect(knowledge.nextBeliefId).toBe(2);
  });

  it('deux compteurs de deux humains différents sont indépendants', () => {
    const a = createEmptyCognitiveMemory();
    const b = createEmptyCognitiveMemory();
    allocateMemoryId(a);
    allocateMemoryId(a);
    expect(allocateMemoryId(b)).toBe(0); // b n'a jamais vu les allocations de a
  });
});
