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

export type NeedsActionExecution =
  | { readonly goal: GoalKind | null; readonly mode: 'none' }
  | { readonly goal: GoalKind; readonly mode: 'seek' | 'atomic' };

/**
 * Seeking is interruptible; consuming, drinking, and resting are atomic until their
 * normal completion. This lets goal selection arbitrate travel without tearing down
 * a resource interaction halfway through.
 */
export function executionForNeedsAction(action: string): NeedsActionExecution {
  switch (action) {
    case 'seekWater':
      return { goal: 'survive.hydrate', mode: 'seek' };
    case 'seekFood':
      return { goal: 'survive.nourish', mode: 'seek' };
    case 'drink':
      return { goal: 'survive.hydrate', mode: 'atomic' };
    case 'eat':
      return { goal: 'survive.nourish', mode: 'atomic' };
    case 'rest':
      return { goal: 'survive.rest', mode: 'atomic' };
    default:
      return { goal: null, mode: 'none' };
  }
}

export function goalForNeedsAction(action: string): GoalKind | null {
  return executionForNeedsAction(action).goal;
}
