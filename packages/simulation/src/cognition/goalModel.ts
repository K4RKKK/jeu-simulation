import type { DecisionFactor } from '../components/humanCognition.js';

/** Intentions atomiques, sans cible ni sequence d'actions. */
export type GoalKind = 'survive.hydrate' | 'survive.nourish' | 'survive.rest' | 'explore';

/** Etat persiste de l'intention courante. */
export interface ActiveGoal {
  readonly kind: GoalKind;
  readonly startedAtTick: number;
}

/** Resultat explicable d'un score de but, recalcule a chaque selection. */
export interface GoalCandidate {
  readonly kind: GoalKind;
  readonly utility: number;
  readonly factors: readonly DecisionFactor[];
}

export function goalForNeedsAction(action: string): GoalKind | null {
  switch (action) {
    case 'seekWater':
    case 'drink':
      return 'survive.hydrate';
    case 'seekFood':
    case 'eat':
      return 'survive.nourish';
    case 'rest':
      return 'survive.rest';
    default:
      return null;
  }
}
