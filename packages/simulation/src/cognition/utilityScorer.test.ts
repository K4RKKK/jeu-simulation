import { describe, expect, it } from 'vitest';
import { scoreEat } from './utilityScorer.js';
import { DEFAULT_SIMULATION_CONFIG } from '../config/simulationConfig.js';

const starving = { hydration: 1, hunger: 0.05, energy: 1, metabolismRate: 1 };

describe('scoreEat', () => {
  it('rend explicite et pénalise une apparence associée à un empoisonnement', () => {
    const unknown = scoreEat(
      starving,
      true,
      0,
      null,
      0.3,
      DEFAULT_SIMULATION_CONFIG.needs.decision,
    );
    const learnedToxic = scoreEat(
      starving,
      true,
      0,
      0,
      0.3,
      DEFAULT_SIMULATION_CONFIG.needs.decision,
    );

    expect(learnedToxic.score).toBeGreaterThan(0);
    expect(learnedToxic.score).toBeLessThan(unknown.score);
    expect(learnedToxic.factors).toContainEqual({
      code: 'belief.food.edible.effective_probability',
      value: 0,
    });
  });
});
