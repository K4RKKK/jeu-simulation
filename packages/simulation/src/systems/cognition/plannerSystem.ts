import {
  CognitiveKnowledge,
  CognitiveMemory,
  HumanCognition,
  HumanPlan,
  Needs,
  NeedsState,
  Personality,
  Transform,
} from '../../components/index.js';
import type {
  CognitiveKnowledgeComponent,
  CognitiveMemoryComponent,
  HumanPlanComponent,
  NeedsStateComponent,
  PersonalityComponent,
  PlanStep,
  PlanFailureReason,
} from '../../components/index.js';
import {
  FOOD_ILLNESS_RISK_PROPERTY,
  FOOD_NOURISHING_PROPERTY,
  effectiveFoodProbability01,
} from '../../cognition/foodBeliefModel.js';
import type { GoalKind } from '../../cognition/goalModel.js';
import { nearestKnownWater, selectKnownFoodTarget } from '../../cognition/spatialMemoryQuery.js';
import type { SystemFrequency } from '../../config/simulationConfig.js';
import type { SimulationSystem, SystemUpdateContext } from '../../core/system.js';

/** Builds stable, bounded plans from remembered information without reading world truth. */
export class PlannerSystem implements SimulationSystem {
  readonly name = 'PlannerSystem';
  readonly frequency: SystemFrequency = 'medium';

  update(ctx: SystemUpdateContext): void {
    ctx.entities.each(
      [
        Needs,
        Transform,
        CognitiveMemory,
        CognitiveKnowledge,
        HumanCognition,
        HumanPlan,
        Personality,
      ],
      (entity, _needs, transform, memory, knowledge, cognition, planState, personality) => {
        const goal = cognition.activeGoal?.kind;
        const plan = planState.activePlan;
        const needsState = ctx.entities.getComponent(entity, NeedsState);

        if (plan !== null && plan.goalKind !== goal && !isAtomic(needsState)) {
          this.fail(planState, plan.currentStepIndex, 'goal.changed', ctx.tick);
          planState.activePlan = null;
        }
        if (goal === undefined) return;

        const active = planState.activePlan;
        if (
          active !== null &&
          active.currentStepIndex < active.steps.length &&
          active.lastFailure === null &&
          !this.searchResolved(active, memory, knowledge, personality, transform.x, transform.z)
        ) {
          return;
        }

        const steps =
          this.bootstrapSteps(goal, needsState) ??
          this.stepsFor(goal, memory, knowledge, personality, transform.x, transform.z);
        planState.activePlan = {
          id: planState.nextPlanId++,
          goalKind: goal,
          createdAtTick: ctx.tick,
          currentStepIndex: 0,
          steps,
          lastFailure: null,
        };
      },
    );
  }

  private searchResolved(
    plan: { readonly steps: readonly PlanStep[]; readonly currentStepIndex: number },
    memory: CognitiveMemoryComponent,
    knowledge: CognitiveKnowledgeComponent,
    personality: PersonalityComponent,
    fromX: number,
    fromZ: number,
  ): boolean {
    const step = plan.steps[plan.currentStepIndex];
    if (step?.kind === 'search.water')
      return nearestKnownWater(memory.spatial, fromX, fromZ) !== null;
    if (step?.kind === 'search.food')
      return this.foodTarget(memory, knowledge, personality, fromX, fromZ) !== null;
    return false;
  }

  private stepsFor(
    goal: GoalKind,
    memory: CognitiveMemoryComponent,
    knowledge: CognitiveKnowledgeComponent,
    personality: PersonalityComponent,
    fromX: number,
    fromZ: number,
  ): readonly PlanStep[] {
    if (goal === 'survive.hydrate') {
      const water = nearestKnownWater(memory.spatial, fromX, fromZ);
      return water === null
        ? [{ kind: 'search.water' }]
        : [
            { kind: 'move.to_water', rememberedX: water.x, rememberedZ: water.z },
            { kind: 'drink', rememberedX: water.x, rememberedZ: water.z },
          ];
    }
    if (goal === 'survive.nourish') {
      const food = this.foodTarget(memory, knowledge, personality, fromX, fromZ);
      return food === null
        ? [{ kind: 'search.food' }]
        : [
            {
              kind: 'move.to_resource',
              worldRef: food.worldRef!,
              subjectConceptId: food.subjectConceptId ?? null,
              rememberedX: food.x,
              rememberedZ: food.z,
            },
            {
              kind: 'eat.resource',
              worldRef: food.worldRef!,
              subjectConceptId: food.subjectConceptId ?? null,
            },
          ];
    }
    return [{ kind: goal === 'survive.rest' ? 'rest' : 'explore' }];
  }

  private foodTarget(
    memory: CognitiveMemoryComponent,
    knowledge: CognitiveKnowledgeComponent,
    personality: PersonalityComponent,
    fromX: number,
    fromZ: number,
  ) {
    return selectKnownFoodTarget(memory.spatial, fromX, fromZ, (entry) => {
      const nourishing = effectiveFoodProbability01(
        knowledge,
        entry.subjectConceptId,
        FOOD_NOURISHING_PROPERTY,
      );
      const risk = effectiveFoodProbability01(
        knowledge,
        entry.subjectConceptId,
        FOOD_ILLNESS_RISK_PROPERTY,
      );
      return (
        (nourishing === null ? 1 : 0.75 + 0.5 * nourishing) *
        (risk === null ? 1 : Math.max(0.1, 1 - risk * (0.5 + personality.caution)))
      );
    });
  }

  private bootstrapSteps(
    goal: GoalKind,
    state: NeedsStateComponent | undefined,
  ): readonly PlanStep[] | null {
    if (state === undefined || state.action === 'none') return null;
    if ((state.action === 'seekWater' || state.action === 'drink') && goal !== 'survive.hydrate')
      return null;
    if ((state.action === 'seekFood' || state.action === 'eat') && goal !== 'survive.nourish')
      return null;
    if (state.action === 'rest' && goal !== 'survive.rest') return null;
    if (state.action === 'drink')
      return [{ kind: 'drink', rememberedX: state.targetX ?? 0, rememberedZ: state.targetZ ?? 0 }];
    if (state.action === 'rest') return [{ kind: 'rest' }];
    if (
      (state.action === 'seekFood' || state.action === 'eat') &&
      state.resourceId &&
      state.resourceOwnerChunkKey
    ) {
      const worldRef = {
        type: 'resource' as const,
        resourceId: state.resourceId,
        ownerChunkKey: state.resourceOwnerChunkKey,
        localId: state.resourceLocalId ?? -1,
      };
      const target = {
        worldRef,
        subjectConceptId: state.resourceConceptId,
        rememberedX: state.targetX ?? 0,
        rememberedZ: state.targetZ ?? 0,
      };
      return state.action === 'eat'
        ? [{ kind: 'eat.resource', worldRef, subjectConceptId: state.resourceConceptId }]
        : [
            { kind: 'move.to_resource', ...target },
            { kind: 'eat.resource', worldRef, subjectConceptId: state.resourceConceptId },
          ];
    }
    if (state.action === 'seekWater') {
      return [
        { kind: 'move.to_water', rememberedX: state.targetX ?? 0, rememberedZ: state.targetZ ?? 0 },
        { kind: 'drink', rememberedX: state.targetX ?? 0, rememberedZ: state.targetZ ?? 0 },
      ];
    }
    return goal === 'survive.nourish' ? [{ kind: 'search.food' }] : null;
  }

  private fail(
    state: HumanPlanComponent,
    stepIndex: number,
    reason: PlanFailureReason,
    tick: number,
  ): void {
    const failure = { stepIndex, reason, tick } as const;
    if (state.activePlan !== null) state.activePlan.lastFailure = failure;
    state.lastFailure = failure;
  }
}

function isAtomic(state: NeedsStateComponent | undefined): boolean {
  return state?.action === 'drink' || state?.action === 'eat' || state?.action === 'rest';
}
