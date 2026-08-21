import type { NeedsComponent, PersonalityComponent } from '../components/index.js';
import type { NeedsConfig } from '../config/simulationConfig.js';
import type { GoalCandidate, GoalKind } from './goalModel.js';

type DecisionConfig = NeedsConfig['decision'];

function urgency(value01: number, criticalThreshold: number, epsilon: number): number {
  const x = Math.max(value01 / criticalThreshold, epsilon);
  return Math.max(0, 1 / (x * x) - 1);
}

export function scoreHydrationGoal(
  needs: NeedsComponent,
  criticalThreshold: number,
  config: DecisionConfig,
): GoalCandidate {
  return vitalGoal(
    'survive.hydrate',
    needs.hydration,
    criticalThreshold,
    config.drinkWeight,
    config,
    'hydration',
  );
}

export function scoreNutritionGoal(
  needs: NeedsComponent,
  criticalThreshold: number,
  config: DecisionConfig,
): GoalCandidate {
  return vitalGoal(
    'survive.nourish',
    needs.hunger,
    criticalThreshold,
    config.eatWeight,
    config,
    'hunger',
  );
}

export function scoreRestGoal(
  needs: NeedsComponent,
  exhaustedThreshold: number,
  config: DecisionConfig,
): GoalCandidate {
  return vitalGoal(
    'survive.rest',
    needs.energy,
    exhaustedThreshold,
    config.restWeight,
    config,
    'energy',
  );
}

function vitalGoal(
  kind: GoalKind,
  level: number,
  threshold: number,
  weight: number,
  config: DecisionConfig,
  need: string,
): GoalCandidate {
  return {
    kind,
    utility: weight * urgency(level, threshold, config.epsilon),
    factors: [
      { code: `need.${need}.level`, value: level },
      { code: `need.${need}.threshold`, value: threshold },
    ],
  };
}

export function scoreExploreGoal(
  personality: PersonalityComponent,
  config: DecisionConfig,
): GoalCandidate {
  return {
    kind: 'explore',
    utility: config.exploreBaseWeight * (0.5 + personality.curiosity),
    factors: [{ code: 'personality.curiosity', value: personality.curiosity }],
  };
}

export function buildGoalCandidates(
  needs: NeedsComponent,
  personality: PersonalityComponent,
  config: NeedsConfig,
): readonly GoalCandidate[] {
  return [
    scoreHydrationGoal(needs, config.hydration.criticalThreshold, config.decision),
    scoreNutritionGoal(needs, config.hunger.criticalThreshold, config.decision),
    scoreRestGoal(needs, config.energy.exhaustedThreshold, config.decision),
    scoreExploreGoal(personality, config.decision),
  ];
}

export function pickBestGoal(candidates: readonly GoalCandidate[]): GoalCandidate {
  if (candidates.length === 0) throw new Error('pickBestGoal: no candidates');
  return candidates.reduce((best, candidate) =>
    candidate.utility > best.utility ? candidate : best,
  );
}

export function candidateForKind(
  candidates: readonly GoalCandidate[],
  kind: GoalKind,
): GoalCandidate | null {
  return candidates.find((candidate) => candidate.kind === kind) ?? null;
}
