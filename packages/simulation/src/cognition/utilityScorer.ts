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
  nourishing01: number | null,
  illnessRisk01: number | null,
  caution01: number,
  criticalThreshold: number,
  config: DecisionConfig,
): DecisionOption {
  const need = urgency(needs.hunger, criticalThreshold, config.epsilon);
  const memory = hasKnownFood ? 1 : config.noMemoryPenalty;
  const poisonPenalty = Math.max(0.1, 1 / (1 + recentPoisonings));
  // Les croyances modulent une base neutre : l'inconnu reste expérimentable.
  const nourishment = nourishing01 === null ? 1 : 0.75 + 0.5 * nourishing01;
  const safety = illnessRisk01 === null ? 1 : Math.max(0.1, 1 - illnessRisk01 * (0.5 + caution01));
  return {
    kind: 'eat',
    score: config.eatWeight * need * memory * poisonPenalty * nourishment * safety,
    factors: [
      { code: 'need.hunger.level', value: needs.hunger },
      { code: 'need.hunger.threshold', value: criticalThreshold },
      { code: 'memory.food.known', value: hasKnownFood ? 1 : 0 },
      // Short-term trauma is distinct from the durable illness-risk belief.
      { code: 'memory.poisoning.trauma_recent_count', value: recentPoisonings },
      ...(nourishing01 === null
        ? []
        : [{ code: 'belief.food.nourishing.effective_probability', value: nourishing01 }]),
      ...(illnessRisk01 === null
        ? []
        : [{ code: 'belief.food.illnessRisk.effective_probability', value: illnessRisk01 }]),
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
