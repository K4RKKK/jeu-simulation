import { describe, expect, it } from 'vitest';
import { DEFAULT_SIMULATION_CONFIG } from '../config/simulationConfig.js';
import { buildGoalCandidates, pickBestGoal, scoreExploreGoal } from './utilityScorer.js';

const personality = {
  curiosity: 0.5,
  caution: 0.5,
  sociability: 0.5,
  aggression: 0.5,
  patience: 0.5,
  altruism: 0.5,
  courage: 0.5,
  perseverance: 0.5,
};

describe('utilityScorer', () => {
  it('choisit un but vital meme sans cible connue', () => {
    const candidates = buildGoalCandidates(
      { hydration: 0.03, hunger: 1, energy: 1, metabolismRate: 1 },
      personality,
      DEFAULT_SIMULATION_CONFIG.needs,
    );
    expect(pickBestGoal(candidates).kind).toBe('survive.hydrate');
  });

  it('laisse exploration gagner quand les besoins sont satisfaits', () => {
    const candidates = buildGoalCandidates(
      { hydration: 1, hunger: 1, energy: 1, metabolismRate: 1 },
      personality,
      DEFAULT_SIMULATION_CONFIG.needs,
    );
    expect(pickBestGoal(candidates).kind).toBe('explore');
  });

  it('la curiosite augmente seulement l utilite d exploration', () => {
    const low = scoreExploreGoal(
      { ...personality, curiosity: 0 },
      DEFAULT_SIMULATION_CONFIG.needs.decision,
    );
    const high = scoreExploreGoal(
      { ...personality, curiosity: 1 },
      DEFAULT_SIMULATION_CONFIG.needs.decision,
    );
    expect(high.utility).toBeGreaterThan(low.utility);
  });
});
