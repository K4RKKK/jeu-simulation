import type { DecisionFactor, DecisionReason } from '../components/humanCognition.js';
import type { NeedsComponent, PersonalityComponent } from '../components/index.js';
import type { NeedsConfig } from '../config/simulationConfig.js';

export type OptionKind = 'drink' | 'eat' | 'rest' | 'explore';
type DecisionConfig = NeedsConfig['decision'];

export interface DecisionOption {
  readonly kind: OptionKind;
  readonly score: number;
  readonly factors: DecisionFactor[];
}

function urgency(value01: number, criticalThreshold: number, epsilon: number): number {
  const x = Math.max(value01 / criticalThreshold, epsilon);
  return Math.max(0, 1 / (x * x) - 1);
}

export function scoreDrink(
  needs: NeedsComponent,
  hasKnownWater: boolean,
  criticalThreshold: number,
  config: DecisionConfig,
): DecisionOption {
  const need = urgency(needs.hydration, criticalThreshold, config.epsilon);
  const memory = hasKnownWater ? 1 : config.noMemoryPenalty;
  return {
    kind: 'drink',
    score: config.drinkWeight * need * memory,
    factors: [
      { code: 'need.hydration.level', value: needs.hydration },
      { code: 'need.hydration.threshold', value: criticalThreshold },
      { code: 'memory.water.known', value: hasKnownWater ? 1 : 0 },
    ],
  };
}

export function scoreEat(
  needs: NeedsComponent,
  hasKnownFood: boolean,
  recentPoisonings: number,
  learnedEdibility01: number | null,
  criticalThreshold: number,
  config: DecisionConfig,
): DecisionOption {
  const need = urgency(needs.hunger, criticalThreshold, config.epsilon);
  const memory = hasKnownFood ? 1 : config.noMemoryPenalty;
  const poisonPenalty = Math.max(0.1, 1 / (1 + recentPoisonings));
  const learnedSafety = learnedEdibility01 === null ? 1 : Math.max(0.1, learnedEdibility01);
  return {
    kind: 'eat',
    score: config.eatWeight * need * memory * poisonPenalty * learnedSafety,
    factors: [
      { code: 'need.hunger.level', value: needs.hunger },
      { code: 'need.hunger.threshold', value: criticalThreshold },
      { code: 'memory.food.known', value: hasKnownFood ? 1 : 0 },
      { code: 'memory.poisoning.recent_count', value: recentPoisonings },
      ...(learnedEdibility01 === null
        ? []
        : [{ code: 'belief.food.edible.effective_probability', value: learnedEdibility01 }]),
    ],
  };
}

export function scoreRest(
  needs: NeedsComponent,
  exhaustedThreshold: number,
  config: DecisionConfig,
): DecisionOption {
  const need = urgency(needs.energy, exhaustedThreshold, config.epsilon);
  return {
    kind: 'rest',
    score: config.restWeight * need,
    factors: [
      { code: 'need.energy.level', value: needs.energy },
      { code: 'need.energy.threshold', value: exhaustedThreshold },
    ],
  };
}

export function scoreExplore(
  personality: PersonalityComponent,
  config: DecisionConfig,
): DecisionOption {
  return {
    kind: 'explore',
    score: config.exploreBaseWeight * (0.5 + personality.curiosity),
    factors: [{ code: 'personality.curiosity', value: personality.curiosity }],
  };
}

export function pickBestOption(options: readonly DecisionOption[]): {
  winner: DecisionOption;
  reason: DecisionReason;
} {
  if (options.length === 0) throw new Error('pickBestOption: aucune option à comparer');
  let winner = options[0]!;
  for (let i = 1; i < options.length; i++) {
    if (options[i]!.score > winner.score) winner = options[i]!;
  }
  return {
    winner,
    reason: {
      code: `decision.${winner.kind}`,
      factors: [{ code: 'decision.score', value: winner.score }, ...winner.factors],
    },
  };
}
