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
  DecisionReason,
  HumanPlanComponent,
  NeedsStateComponent,
  PlanFailure,
  PersonalityComponent,
  PlanStep,
  PlanFailureReason,
  SpatialMemoryEntry,
} from '../../components/index.js';
import {
  FOOD_ILLNESS_RISK_PROPERTY,
  FOOD_NOURISHING_PROPERTY,
  effectiveFoodProbability01,
} from '../../cognition/foodBeliefModel.js';
import type { GoalKind } from '../../cognition/goalModel.js';
import { selectFoodExperimentCandidate } from '../../cognition/experimentModel.js';
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
          !this.searchResolved(
            active,
            memory,
            knowledge,
            personality,
            transform.x,
            transform.z,
            planState.lastFailure,
          )
        ) {
          if (active.selectionReason !== undefined) {
            cognition.decisionReason = active.selectionReason;
          }
          return;
        }

        if (active?.lastFailure !== null && active?.lastFailure !== undefined) {
          clearFailedSeek(needsState);
        } else {
          clearInvalidLegacySeek(needsState);
        }

        const failure = active?.lastFailure ?? planState.lastFailure;
        let selectionReason: DecisionReason | undefined;
        let steps = this.bootstrapSteps(goal, needsState);
        if (steps === null && goal === 'explore') {
          const experiment = selectFoodExperimentCandidate(
            memory,
            knowledge,
            personality,
            transform.x,
            transform.z,
            ctx.tick,
            ctx.config.time.gameSecondsPerTick,
            // Compose l'unique config attendue par ExperimentModel : les paramètres
            // spécifiques à l'expérimentation vivent dans cognition.experimentation,
            // le poids d'imitation dans cognition.socialObservation (P2 review :
            // un seul emplacement pour socialObservation, pas de duplication).
            {
              ...ctx.config.cognition.experimentation,
              socialImitationWeight: ctx.config.cognition.socialObservation.imitationWeight,
            },
            (entry) => this.notFailedTarget(entry, failure),
          );
          if (
            experiment !== null &&
            experiment.score01 >= ctx.config.cognition.experimentation.minimumInterest01
          ) {
            steps = [
              {
                kind: 'move.to_resource',
                worldRef: experiment.target,
                subjectConceptId: experiment.subjectConceptId,
                rememberedX: experiment.rememberedX,
                rememberedZ: experiment.rememberedZ,
              },
              {
                kind: 'eat.resource',
                worldRef: experiment.target,
                subjectConceptId: experiment.subjectConceptId,
                intent: 'deliberateExperiment',
              },
            ];
            selectionReason = {
              code: 'experiment.select.food.try',
              factors: [
                { code: 'experiment.utility', value: experiment.score01 },
                ...experiment.factors,
              ],
            };
            cognition.decisionReason = selectionReason;
          }
        }
        steps ??= this.stepsFor(
          goal,
          memory,
          knowledge,
          personality,
          transform.x,
          transform.z,
          failure,
        );
        planState.activePlan = {
          id: planState.nextPlanId++,
          goalKind: goal,
          createdAtTick: ctx.tick,
          currentStepIndex: 0,
          steps,
          ...(selectionReason === undefined ? {} : { selectionReason }),
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
    failure: PlanFailure | null,
  ): boolean {
    const step = plan.steps[plan.currentStepIndex];
    if (step?.kind === 'search.water')
      return (
        nearestKnownWater(memory.spatial, fromX, fromZ, (entry) =>
          this.notFailedTarget(entry, failure),
        ) !== null
      );
    if (step?.kind === 'search.food')
      return this.foodTarget(memory, knowledge, personality, fromX, fromZ, failure) !== null;
    return false;
  }

  private stepsFor(
    goal: GoalKind,
    memory: CognitiveMemoryComponent,
    knowledge: CognitiveKnowledgeComponent,
    personality: PersonalityComponent,
    fromX: number,
    fromZ: number,
    failure: PlanFailure | null = null,
  ): readonly PlanStep[] {
    if (goal === 'survive.hydrate') {
      const water = nearestKnownWater(memory.spatial, fromX, fromZ, (entry) =>
        this.notFailedTarget(entry, failure),
      );
      return water === null
        ? [{ kind: 'search.water' }]
        : [
            { kind: 'move.to_water', rememberedX: water.x, rememberedZ: water.z },
            { kind: 'drink', rememberedX: water.x, rememberedZ: water.z },
          ];
    }
    if (goal === 'survive.nourish') {
      const food = this.foodTarget(memory, knowledge, personality, fromX, fromZ, failure);
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
              intent: 'satisfyNeed',
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
    failure: PlanFailure | null = null,
  ) {
    return selectKnownFoodTarget(
      memory.spatial,
      fromX,
      fromZ,
      (entry) => {
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
      },
      (entry) => this.notFailedTarget(entry, failure),
    );
  }

  private notFailedTarget(entry: SpatialMemoryEntry, failure: PlanFailure | null): boolean {
    const target = failure?.target;
    const failedAtTick = failure?.tick;
    if (target === undefined || failedAtTick === undefined || entry.lastSeenTick > failedAtTick)
      return true;
    if (target.kind === 'water') {
      return entry.x !== target.rememberedX || entry.z !== target.rememberedZ;
    }
    const ref = entry.worldRef;
    return (
      ref === undefined ||
      ref.type !== target.worldRef.type ||
      ref.resourceId !== target.worldRef.resourceId ||
      ref.ownerChunkKey !== target.worldRef.ownerChunkKey ||
      ref.localId !== target.worldRef.localId
    );
  }

  private bootstrapSteps(
    goal: GoalKind,
    state: NeedsStateComponent | undefined,
  ): readonly PlanStep[] | null {
    if (state === undefined || state.action === 'none') return null;
    if ((state.action === 'seekWater' || state.action === 'drink') && goal !== 'survive.hydrate')
      return null;
    if (
      (state.action === 'seekFood' || state.action === 'gatherFood' || state.action === 'eat') &&
      goalForFoodIntent(state.foodIntent) !== goal
    )
      return null;
    if (state.action === 'rest' && goal !== 'survive.rest') return null;
    if (state.action === 'drink')
      return [{ kind: 'drink', rememberedX: state.targetX, rememberedZ: state.targetZ }];
    if (state.action === 'rest') return [{ kind: 'rest' }];
    if (
      (state.action === 'seekFood' || state.action === 'gatherFood' || state.action === 'eat') &&
      state.resourceId &&
      state.resourceOwnerChunkKey &&
      state.resourceLocalId !== null
    ) {
      const worldRef = {
        type: 'resource' as const,
        resourceId: state.resourceId,
        ownerChunkKey: state.resourceOwnerChunkKey,
        localId: state.resourceLocalId,
      };
      if (state.action === 'gatherFood' || state.action === 'eat') {
        return [
          {
            kind: 'eat.resource',
            worldRef,
            subjectConceptId: state.resourceConceptId,
            intent: state.foodIntent ?? 'satisfyNeed',
          },
        ];
      }
      if (state.targetX !== null && state.targetZ !== null) {
        return [
          {
            kind: 'move.to_resource',
            worldRef,
            subjectConceptId: state.resourceConceptId,
            rememberedX: state.targetX,
            rememberedZ: state.targetZ,
          },
          {
            kind: 'eat.resource',
            worldRef,
            subjectConceptId: state.resourceConceptId,
            intent: state.foodIntent ?? 'satisfyNeed',
          },
        ];
      }
    }
    if (state.action === 'seekWater' && state.targetX !== null && state.targetZ !== null) {
      return [
        { kind: 'move.to_water', rememberedX: state.targetX, rememberedZ: state.targetZ },
        { kind: 'drink', rememberedX: state.targetX, rememberedZ: state.targetZ },
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
  return (
    state?.action === 'gatherFood' ||
    state?.action === 'drink' ||
    state?.action === 'eat' ||
    state?.action === 'rest'
  );
}

function goalForFoodIntent(intent: NeedsStateComponent['foodIntent']): GoalKind {
  return intent === 'deliberateExperiment' ? 'explore' : 'survive.nourish';
}

function clearFailedSeek(state: NeedsStateComponent | undefined): void {
  if (state?.action !== 'seekWater' && state?.action !== 'seekFood') return;
  clearSeek(state);
}

function clearInvalidLegacySeek(state: NeedsStateComponent | undefined): void {
  if (state?.action === 'seekWater' && (state.targetX === null || state.targetZ === null)) {
    clearSeek(state);
    return;
  }
  if (
    state?.action === 'seekFood' &&
    (state.targetX === null ||
      state.targetZ === null ||
      state.resourceId === null ||
      state.resourceOwnerChunkKey === null ||
      state.resourceLocalId === null)
  ) {
    clearSeek(state);
  }
}

function clearSeek(state: NeedsStateComponent): void {
  state.action = 'none';
  state.targetX = null;
  state.targetZ = null;
  state.resourceId = null;
  state.resourceOwnerChunkKey = null;
  state.resourceLocalId = null;
  state.resourceConceptId = null;
  state.foodIntent = null;
}
