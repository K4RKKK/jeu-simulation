import type { GoalKind } from '../cognition/goalModel.js';
import type { FoodActionIntent } from '../cognition/foodActionIntent.js';
import type { WorldRef } from '../cognition/worldRef.js';
import type { DecisionReason } from './humanCognition.js';
import { defineComponent } from '../core/componentType.js';

export type PlanFailureReason =
  'target.missing' | 'target.unreachable' | 'interaction.failed' | 'goal.changed';

export type PlanFailureTarget =
  | { readonly kind: 'resource'; readonly worldRef: WorldRef }
  | { readonly kind: 'water'; readonly rememberedX: number; readonly rememberedZ: number };

export interface PlanFailure {
  readonly stepIndex: number;
  readonly reason: PlanFailureReason;
  readonly tick: number;
  readonly target?: PlanFailureTarget;
}

export type PlanStep =
  | { readonly kind: 'search.water' }
  | { readonly kind: 'move.to_water'; readonly rememberedX: number; readonly rememberedZ: number }
  | {
      readonly kind: 'drink';
      readonly rememberedX: number | null;
      readonly rememberedZ: number | null;
    }
  | { readonly kind: 'search.food' }
  | {
      readonly kind: 'move.to_resource';
      readonly worldRef: WorldRef;
      readonly subjectConceptId: string | null;
      readonly rememberedX: number;
      readonly rememberedZ: number;
    }
  | {
      readonly kind: 'eat.resource';
      readonly worldRef: WorldRef;
      readonly subjectConceptId: string | null;
      readonly intent: FoodActionIntent;
    }
  | { readonly kind: 'rest' }
  | { readonly kind: 'explore' };

export interface ActivePlan {
  readonly id: number;
  readonly goalKind: GoalKind;
  readonly createdAtTick: number;
  currentStepIndex: number;
  readonly steps: readonly PlanStep[];
  /** Provenance durable du choix du plan, distincte du candidat recalculable. */
  readonly selectionReason?: DecisionReason;
  lastFailure: PlanFailure | null;
}

export interface HumanPlanComponent {
  nextPlanId: number;
  activePlan: ActivePlan | null;
  lastFailure: PlanFailure | null;
}

export const HumanPlan = defineComponent<HumanPlanComponent>('HumanPlan');

export function createEmptyHumanPlan(): HumanPlanComponent {
  return { nextPlanId: 0, activePlan: null, lastFailure: null };
}
