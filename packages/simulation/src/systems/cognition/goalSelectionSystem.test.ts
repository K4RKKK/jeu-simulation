import { describe, expect, it } from 'vitest';
import { HumanCognition, Needs, Personality } from '../../components/index.js';
import { Simulation } from '../../simulation.js';
import { GoalSelectionSystem } from './goalSelectionSystem.js';

function simulation(): Simulation {
  return new Simulation({
    seed: 'goal-selection',
    population: 1,
    config: { time: { gameSecondsPerTick: 1 } },
    systems: [new GoalSelectionSystem()],
  });
}

function select(
  sim: Simulation,
  needs: Partial<{ hydration: number; hunger: number; energy: number }>,
): void {
  const human = sim.humanIds()[0]!;
  Object.assign(sim.entities.getComponentOrThrow(human, Needs), needs);
  sim.step(10);
}

describe('GoalSelectionSystem', () => {
  it('selectionne hydrate, nourish et rest selon le besoin critique', () => {
    const cases = [
      [{ hydration: 0.02 }, 'survive.hydrate'],
      [{ hydration: 1, hunger: 0.02 }, 'survive.nourish'],
      [{ hydration: 1, hunger: 1, energy: 0.02 }, 'survive.rest'],
    ] as const;
    for (const [needs, goal] of cases) {
      const sim = simulation();
      sim.start();
      select(sim, needs);
      expect(
        sim.entities.getComponentOrThrow(sim.humanIds()[0]!, HumanCognition).activeGoal?.kind,
      ).toBe(goal);
      sim.dispose();
    }
  });

  it('garde un goal vital sans souvenir de cible et expose une raison structuree', () => {
    const sim = simulation();
    sim.start();
    select(sim, { hydration: 0.02 });
    const cognition = sim.entities.getComponentOrThrow(sim.humanIds()[0]!, HumanCognition);
    expect(cognition.activeGoal?.kind).toBe('survive.hydrate');
    expect(cognition.decisionReason?.code).toBe('goal.select.survive.hydrate');
    sim.dispose();
  });

  it('ne change pas de but pour un faible avantage pendant le commitment', () => {
    const sim = simulation();
    sim.start();
    select(sim, { hydration: 0.04, hunger: 1, energy: 1 });
    const human = sim.humanIds()[0]!;
    const cognition = sim.entities.getComponentOrThrow(human, HumanCognition);
    expect(cognition.activeGoal?.kind).toBe('survive.hydrate');
    Object.assign(sim.entities.getComponentOrThrow(human, Needs), {
      hydration: 0.11,
      hunger: 0.115,
    });
    sim.step(5);
    expect(cognition.activeGoal?.kind).toBe('survive.hydrate');
    Object.assign(sim.entities.getComponentOrThrow(human, Needs), { hunger: 0.03 });
    sim.step(20);
    expect(cognition.activeGoal?.kind).toBe('survive.nourish');
    sim.dispose();
  });

  it('rend explore plus attractif pour un humain curieux', () => {
    const sim = simulation();
    const human = sim.humanIds()[0]!;
    sim.entities.getComponentOrThrow(human, Personality).curiosity = 1;
    sim.start();
    select(sim, { hydration: 1, hunger: 1, energy: 1 });
    expect(sim.entities.getComponentOrThrow(human, HumanCognition).activeGoal?.kind).toBe(
      'explore',
    );
    sim.dispose();
  });
});
