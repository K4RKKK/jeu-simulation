import {
  Activity,
  CognitiveMemory,
  HumanCognition,
  HumanPlan,
  HumanSkills,
  Movement,
  Needs,
  NeedsState,
  ObservableAction,
  Transform,
} from '../../components/index.js';
import type {
  ActivityComponent,
  CognitiveMemoryComponent,
  HumanPlanComponent,
  HumanSkillsComponent,
  MovementComponent,
  NeedsComponent,
  NeedsStateComponent,
  ObservableActionKind,
  PlanFailureTarget,
  PlanStep,
  TransformComponent,
} from '../../components/index.js';
import type { SystemFrequency } from '../../config/simulationConfig.js';
import { clamp, distance2D } from '../../core/math.js';
import type { SimulationSystem, SystemUpdateContext } from '../../core/system.js';
import type { EntityId } from '@civ/shared';
import {
  beginResourceInteraction,
  commitResourceGathering,
  endResourceInteraction,
  findInteractiveResource,
} from '../../world/resourceInteraction.js';
import { rememberEpisodic } from '../../cognition/episodicMemoryModel.js';
import { goalForNeedsAction } from '../../cognition/goalModel.js';
import { motivationForFoodIntent } from '../../cognition/foodActionIntent.js';
import { invalidateSpatialWorldRef } from '../../cognition/spatialMemoryModel.js';
import {
  getSkillProficiency01,
  resourceGatheringDurationSeconds,
} from '../../cognition/skillModel.js';

/**
 * Décide des actions vitales quand un besoin devient critique (CLAUDE.md règle 7 : il
 * décide, le `MovementSystem` déplace, le `MetabolismSystem` consomme).
 *
 * Priorité physiologique : l'épuisement d'abord — un corps à plat ne peut pas chercher
 * d'eau — puis la soif, puis la faim. Chaque décision porte une `reason` lisible
 * (règle 12). Le plan est écrit dans `NeedsState` pour que le wander temporaire laisse
 * l'individu tranquille pendant l'action.
 *
 * **Aucune omniscience** : l'eau et la nourriture ne sont pas cherchées dans le monde,
 * mais dans la mémoire cognitive individuelle remplie par la perception. Sans souvenir,
 * pas de plan : l'errance explore, la perception mémorise, et la décision suivra.
 *
 * Phase 3.4 : lit `CognitiveMemory.spatial` (souvenirs vieillissables, avec confiance et
 * précision) au lieu de l'ancien `Memory.food`/`Memory.water` (index étroit sans notion
 * de fiabilité). Le choix d'une cible n'est plus « le plus proche à vol d'oiseau » mais
 * un compromis distance/précision/confiance — voir `spatialMemoryQuery.ts` pour la
 * formule. `Memory` reste écrit par `PerceptionSystem` (positions de scan encore utiles)
 * mais n'est plus consulté par la décision.
 */
export class NeedSatisfactionSystem implements SimulationSystem {
  readonly name = 'NeedSatisfactionSystem';
  readonly frequency: SystemFrequency = 'medium';

  update(ctx: SystemUpdateContext): void {
    ctx.entities.each(
      [
        Needs,
        Activity,
        Movement,
        Transform,
        CognitiveMemory,
        HumanCognition,
        HumanPlan,
        HumanSkills,
      ],
      (entity, needs, activity, movement, transform, memory, cognition, planState, skills) => {
        // Le plan n'existe que pour les besoins critiques : on le crée au premier passage.
        const state =
          ctx.entities.getComponent(entity, NeedsState) ??
          ctx.entities.addComponent(entity, NeedsState, {
            action: 'none',
            targetX: null,
            targetZ: null,
            resourceId: null,
            resourceOwnerChunkKey: null,
            resourceLocalId: null,
            resourceConceptId: null,
            foodIntent: null,
            gatherStartedTick: -1,
            mealStartedTick: -1,
            mealHungerBefore01: 0,
            untilTick: -1,
            mealMaxGain: 1,
            poisoningUntilTick: -1,
            poisoningToxicity01: 0,
            currentMealCausedPoisoning: false,
            pathFailedAtTick: -1,
          });

        if (state.action === 'none') {
          this.executeGoal(ctx, entity, needs, state, activity, movement, planState);
          return;
        }

        if (state.action === 'seekWater' || state.action === 'seekFood') {
          if (planState.activePlan?.lastFailure?.reason === 'target.unreachable') {
            this.cancelSeek(ctx, entity, state, movement);
            return;
          }
          if (
            cognition.activeGoal !== null &&
            cognition.activeGoal.kind !== goalForNeedsAction(state.action, state.foodIntent)
          ) {
            this.cancelSeek(ctx, entity, state, movement);
            return;
          }
          // En route : le MovementSystem s'occupe du reste.
          if (movement.targetX !== null || movement.targetZ !== null) return;
          this.onArrival(ctx, entity, needs, state, activity, transform, memory, planState, skills);
          return;
        }

        if (state.action === 'gatherFood') {
          if (ctx.tick >= state.untilTick) {
            this.finishGathering(ctx, entity, needs, state, activity, memory, planState);
          }
          return;
        }

        // Action en cours (drink / eat / rest) : se termine quand le but est atteint ou
        // quand la durée prévue est écoulée.
        const fulfilled =
          state.action === 'drink' && needs.hydration >= ctx.config.needs.hydration.drinkTarget;
        const replete = state.action === 'eat' && needs.hunger >= ctx.config.needs.hunger.eatTarget;
        const rested =
          state.action === 'rest' && needs.energy >= ctx.config.needs.energy.restTarget;
        if (fulfilled || replete || rested || ctx.tick >= state.untilTick) {
          this.finishAction(ctx, entity, needs, state, activity, transform, memory, planState);
        }
      },
    );
  }

  private executeGoal(
    ctx: SystemUpdateContext,
    entity: EntityId,
    needs: NeedsComponent,
    state: NeedsStateComponent,
    activity: ActivityComponent,
    movement: MovementComponent,
    planState: HumanPlanComponent,
  ): void {
    const plan = planState.activePlan;
    const step = plan?.steps[plan.currentStepIndex];
    if (
      step === undefined ||
      step.kind === 'search.water' ||
      step.kind === 'search.food' ||
      step.kind === 'explore'
    )
      return;
    if (step.kind === 'rest') {
      this.startRest(ctx, entity, needs, state, activity);
      return;
    }

    // Après un chemin introuvable, ne pas re-planifier dans le vide pendant le délai de
    // retenue posé par le PathfindingSystem : l'errance explore, la perception mémorisera
    // d'autres cibles.
    if (ctx.tick < state.pathFailedAtTick) return;
    if (step.kind === 'move.to_water') {
      this.startTravel(
        ctx,
        entity,
        state,
        activity,
        movement,
        'seekWater',
        step.rememberedX,
        step.rememberedZ,
        "part boire (se souvient d'une rive)",
      );
      return;
    }
    if (step.kind === 'move.to_resource') {
      this.startTravel(
        ctx,
        entity,
        state,
        activity,
        movement,
        'seekFood',
        step.rememberedX,
        step.rememberedZ,
        'part chercher une ressource mémorisée',
      );
      state.resourceId = step.worldRef.resourceId;
      state.resourceOwnerChunkKey = step.worldRef.ownerChunkKey;
      state.resourceLocalId = step.worldRef.localId;
      state.resourceConceptId = step.subjectConceptId;
      const eatStep = plan?.steps[plan.currentStepIndex + 1];
      state.foodIntent = eatStep?.kind === 'eat.resource' ? eatStep.intent : 'satisfyNeed';
    }
  }

  private advanceTravelStep(planState: HumanPlanComponent): void {
    const plan = planState.activePlan;
    if (
      plan !== null &&
      (plan.steps[plan.currentStepIndex]?.kind === 'move.to_water' ||
        plan.steps[plan.currentStepIndex]?.kind === 'move.to_resource')
    ) {
      plan.currentStepIndex += 1;
    }
  }

  private recordPlanFailure(
    planState: HumanPlanComponent,
    reason: 'target.missing' | 'interaction.failed',
    tick: number,
    target?: PlanFailureTarget,
  ): void {
    const plan = planState.activePlan;
    if (plan === null) return;
    const failure = { stepIndex: plan.currentStepIndex, reason, tick, target } as const;
    plan.lastFailure = failure;
    planState.lastFailure = failure;
  }

  private cancelSeek(
    ctx: SystemUpdateContext,
    entity: EntityId,
    state: NeedsStateComponent,
    movement: MovementComponent,
  ): void {
    this.clearAction(state);
    state.targetX = null;
    state.targetZ = null;
    state.resourceId = null;
    state.resourceOwnerChunkKey = null;
    state.resourceLocalId = null;
    state.resourceConceptId = null;
    movement.targetX = null;
    movement.targetZ = null;
    // Défensif : `ObservableAction` ne devrait jamais exister pendant seekFood/seekWater
    // (Phase 3.8 ne projette que gather/eat), mais le retrait est idempotent — un état
    // corrompu venant d'un futur système ne fuiterait pas une action fantôme.
    this.clearObservable(ctx, entity);
  }

  private clearAction(state: NeedsStateComponent): void {
    state.action = 'none';
    state.foodIntent = null;
  }

  private onArrival(
    ctx: SystemUpdateContext,
    entity: EntityId,
    needs: NeedsComponent,
    state: NeedsStateComponent,
    activity: ActivityComponent,
    transform: TransformComponent,
    memory: CognitiveMemoryComponent,
    planState: HumanPlanComponent,
    skills: HumanSkillsComponent,
  ): void {
    const travelStep = this.currentTravelStep(planState);
    const failureTarget = travelStep === undefined ? undefined : targetForTravelStep(travelStep);
    const targetX = state.targetX;
    const targetZ = state.targetZ;
    if (targetX === null || targetZ === null) {
      this.clearAction(state);
      this.recordPlanFailure(planState, 'interaction.failed', ctx.tick, failureTarget);
      return;
    }
    // Arrivé ? Le MovementSystem pose la cible exacte, mais une petite marge protège des
    // cas où la cible n'était pas atteignable au dernier mètre.
    const arrived = distance2D(transform.x, transform.z, targetX, targetZ) <= 2.5;
    if (!arrived) {
      this.clearAction(state);
      this.recordPlanFailure(planState, 'interaction.failed', ctx.tick, failureTarget);
      return;
    }

    this.advanceTravelStep(planState);

    if (state.action === 'seekWater') {
      state.action = 'drink';
      state.untilTick = this.durationEndTick(
        ctx,
        ctx.config.needs.hydration.drinkTarget - needs.hydration,
        ctx.config.needs.hydration.drinkRatePerSecond,
        ctx.config.needs.hydration.minDrinkSeconds,
        ctx.config.needs.hydration.maxDrinkSeconds,
      );
      activity.kind = 'drink';
      activity.reason = `boit pour étancher sa soif (hydratation ${needs.hydration.toFixed(2)})`;
      activity.startedAtTick = ctx.tick;
      return;
    }

    // seekFood : la ressource peut avoir été cueillie par un autre entre-temps.
    if (state.resourceId && ctx.world.delta.isDepleted(state.resourceId)) {
      this.clearAction(state);
      this.invalidateMissingTarget(memory, travelStep);
      this.recordPlanFailure(planState, 'target.missing', ctx.tick, failureTarget);
      return;
    }
    if (state.resourceId === null || state.resourceOwnerChunkKey === null) {
      this.clearAction(state);
      this.invalidateMissingTarget(memory, travelStep);
      this.recordPlanFailure(planState, 'target.missing', ctx.tick, failureTarget);
      return;
    }
    const spawn = ctx.world.findResourceById(state.resourceId, state.resourceOwnerChunkKey);
    if (!spawn) {
      this.clearAction(state);
      this.invalidateMissingTarget(memory, travelStep);
      this.recordPlanFailure(planState, 'target.missing', ctx.tick, failureTarget);
      return;
    }
    state.resourceLocalId = spawn.localId;
    const interactiveResourceEntity = beginResourceInteraction(
      ctx.entities,
      ctx.world,
      entity,
      state.resourceId,
      state.resourceOwnerChunkKey,
      ctx.tick,
    );
    if (interactiveResourceEntity === null) {
      this.clearAction(state);
      this.invalidateMissingTarget(memory, travelStep);
      this.recordPlanFailure(planState, 'target.missing', ctx.tick, failureTarget);
      return;
    }

    const seconds = resourceGatheringDurationSeconds(
      getSkillProficiency01(skills, 'resource.gathering'),
      ctx.config.skills.resourceGathering,
    );
    state.action = 'gatherFood';
    state.gatherStartedTick = ctx.tick;
    // Duration is frozen here. Learning or restore must never recalculate this deadline.
    state.untilTick =
      ctx.tick + Math.max(1, Math.ceil(seconds / ctx.config.time.gameSecondsPerTick));
    activity.kind = 'gather';
    activity.reason = 'manipule une ressource pour en détacher une portion';
    activity.startedAtTick = ctx.tick;
    // Phase 3.8 : rend l'action visible aux autres humains. Ne contient QUE le concept
    // perçu et le tick de démarrage — jamais la faim, la motivation, le kcal, la
    // toxicité, la maîtrise ou le plan de l'acteur. La position est lue en temps réel
    // depuis Transform par SocialObservationSystem, pas figée ici.
    this.writeObservable(ctx, entity, 'resource.gathering', ctx.tick, state.resourceConceptId);
  }

  private finishGathering(
    ctx: SystemUpdateContext,
    entity: EntityId,
    needs: NeedsComponent,
    state: NeedsStateComponent,
    activity: ActivityComponent,
    memory: CognitiveMemoryComponent,
    planState: HumanPlanComponent,
  ): void {
    const resourceId = state.resourceId;
    const resourceEntity =
      resourceId === null ? null : findInteractiveResource(ctx.entities, resourceId);
    const result =
      resourceEntity === null
        ? ({ committed: false, reason: 'missing' } as const)
        : commitResourceGathering(ctx.entities, ctx.world, resourceEntity, entity, ctx.tick);

    if (resourceId !== null) endResourceInteraction(ctx.entities, entity, resourceId);
    if (!result.committed) {
      this.failGathering(ctx, entity, state, activity, memory, planState);
      return;
    }

    rememberEpisodic(
      memory,
      {
        tick: ctx.tick,
        eventType: 'resource.gathering',
        actors: [entity],
        ...(state.resourceConceptId === null ? {} : { subjectConcept: state.resourceConceptId }),
        outcome: 'resource.portion_detached',
        emotionalStrength01: 0.2,
        experience: {
          kind: 'resource.gathering',
          subjectConceptId: state.resourceConceptId,
          actionTick: state.gatherStartedTick ?? ctx.tick,
          outcomeTick: ctx.tick,
          completed: true,
        },
      },
      ctx.config.cognition,
    );

    const mealMaxGain = clamp(
      result.foodKcal / result.harvestServings / ctx.config.needs.hunger.kcalPerFullMeal,
      0,
      1,
    );
    state.action = 'eat';
    state.gatherStartedTick = -1;
    state.mealMaxGain = mealMaxGain;
    state.mealStartedTick = ctx.tick;
    state.mealHungerBefore01 = needs.hunger;
    state.currentMealCausedPoisoning =
      result.foodToxicity01 > ctx.config.needs.toxicity.effectThreshold01;
    state.untilTick = this.durationEndTick(
      ctx,
      Math.min(ctx.config.needs.hunger.eatTarget - needs.hunger, mealMaxGain),
      ctx.config.needs.hunger.eatRatePerSecond,
      ctx.config.needs.hunger.minEatSeconds,
      ctx.config.needs.hunger.maxEatSeconds,
    );
    activity.kind = 'eat';
    activity.reason =
      state.foodIntent === 'deliberateExperiment'
        ? 'goûte une ressource pour en découvrir les effets'
        : `mange pour apaiser sa faim (faim ${needs.hunger.toFixed(2)})`;
    activity.startedAtTick = ctx.tick;
    // Nouvelle occurrence observable : la précédente (resource.gathering) est écrasée.
    // subjectConceptId reste le même que pendant le gather ; conservé dans NeedsState
    // même après disparition de la ResourceSpawn (test 22 du prompt : voir A manger
    // berry:red doit fonctionner même si la dernière portion a été détachée).
    this.writeObservable(ctx, entity, 'food.ingestion', ctx.tick, state.resourceConceptId);

    if (state.currentMealCausedPoisoning) {
      state.poisoningToxicity01 = result.foodToxicity01;
      state.poisoningUntilTick =
        ctx.tick +
        Math.max(
          1,
          Math.ceil(ctx.config.needs.toxicity.durationSeconds / ctx.config.time.gameSecondsPerTick),
        );
    }
  }

  private failGathering(
    ctx: SystemUpdateContext,
    entity: EntityId,
    state: NeedsStateComponent,
    activity: ActivityComponent,
    memory: CognitiveMemoryComponent,
    planState: HumanPlanComponent,
  ): void {
    const failureTarget = this.resourceTarget(state);
    if (failureTarget?.kind === 'resource') {
      invalidateSpatialWorldRef(memory, failureTarget.worldRef);
    }
    this.recordPlanFailure(planState, 'target.missing', ctx.tick, failureTarget);
    this.clearAction(state);
    state.targetX = null;
    state.targetZ = null;
    state.resourceId = null;
    state.resourceOwnerChunkKey = null;
    state.resourceLocalId = null;
    state.resourceConceptId = null;
    state.gatherStartedTick = -1;
    state.untilTick = -1;
    activity.kind = 'idle';
    activity.reason = 'ne trouve plus la ressource à manipuler';
    activity.startedAtTick = ctx.tick;
    // Le gather échoué n'est plus une action visible : les observateurs qui l'ont vue
    // conservent leur souvenir, mais aucune nouvelle observation ne doit être écrite.
    this.clearObservable(ctx, entity);
  }

  private resourceTarget(state: NeedsStateComponent): PlanFailureTarget | undefined {
    if (
      state.resourceId === null ||
      state.resourceOwnerChunkKey === null ||
      state.resourceLocalId === null
    ) {
      return undefined;
    }
    return {
      kind: 'resource',
      worldRef: {
        type: 'resource',
        resourceId: state.resourceId,
        ownerChunkKey: state.resourceOwnerChunkKey,
        localId: state.resourceLocalId,
      },
    };
  }

  private currentTravelStep(planState: HumanPlanComponent): PlanStep | undefined {
    const plan = planState.activePlan;
    const step = plan?.steps[plan.currentStepIndex];
    return step?.kind === 'move.to_water' || step?.kind === 'move.to_resource' ? step : undefined;
  }

  private invalidateMissingTarget(
    memory: CognitiveMemoryComponent,
    step: PlanStep | undefined,
  ): void {
    if (step?.kind === 'move.to_resource') {
      invalidateSpatialWorldRef(memory, step.worldRef);
    }
  }

  private startRest(
    ctx: SystemUpdateContext,
    entity: EntityId,
    needs: NeedsComponent,
    state: NeedsStateComponent,
    activity: ActivityComponent,
  ): void {
    const config = ctx.config.needs.energy;
    state.action = 'rest';
    state.targetX = null;
    state.targetZ = null;
    state.resourceId = null;
    state.resourceOwnerChunkKey = null;
    state.resourceLocalId = null;
    state.resourceConceptId = null;
    state.foodIntent = null;
    state.untilTick = this.durationEndTick(
      ctx,
      config.restTarget - needs.energy,
      config.recoveryPerSecond,
      config.minRestSeconds,
      config.maxRestSeconds,
    );
    activity.kind = 'rest';
    activity.reason = `est épuisé (énergie ${needs.energy.toFixed(2)})`;
    activity.startedAtTick = ctx.tick;
    // Rest n'est pas encore une action socialement observable (Phase 3.8 : gather/eat
    // seulement). Retrait défensif d'un ObservableAction résiduel s'il existait.
    this.clearObservable(ctx, entity);
  }

  private finishAction(
    ctx: SystemUpdateContext,
    entity: EntityId,
    needs: NeedsComponent,
    state: NeedsStateComponent,
    activity: ActivityComponent,
    transform: TransformComponent,
    memory: CognitiveMemoryComponent,
    planState: HumanPlanComponent,
  ): void {
    const done = state.action;
    // Phase 3.3 : chaque action vitale terminée laisse un épisode. `emotionalStrength01`
    // classe la mémorabilité — un repas empoisonné surpasse largement une gorgée d'eau
    // ordinaire, et résistera plus longtemps à l'éviction (voir `episodicMemoryModel`).
    // Position enregistrée pour que de futures croyances puissent associer un lieu à un
    // outcome ; `subjectConcept` non renseigné faute de projection concept ↔ ressource
    // stable pour l'eau/le repos (viendra en Phase 3.7+).
    const cognitionConfig = ctx.config.cognition;
    if (done === 'drink') {
      rememberEpisodic(
        memory,
        {
          tick: ctx.tick,
          eventType: 'water.drunk',
          actors: [entity],
          x: transform.x,
          z: transform.z,
          outcome: 'thirst.quenched',
          emotionalStrength01: 0.15,
        },
        cognitionConfig,
      );
    } else if (done === 'eat') {
      // « Ce repas m'a-t-il rendu malade ? » = le poison est-il actif à la fin de ce repas.
      // `poisoningToxicity01` seul ne suffit pas : il n'est jamais remis à zéro et reste à
      // la valeur d'un empoisonnement passé, ce qui étiquetterait à tort tout repas sain
      // ultérieur comme un empoisonnement.
      const poisoned = state.currentMealCausedPoisoning;
      const conceptId = state.resourceConceptId;
      rememberEpisodic(
        memory,
        {
          tick: ctx.tick,
          eventType: 'food.ingestion',
          actors: [entity],
          x: transform.x,
          z: transform.z,
          outcome: poisoned ? 'physiology.poisoning_started' : 'physiology.satiety_increased',
          ...(conceptId === null ? {} : { subjectConcept: conceptId }),
          ...(conceptId === null || state.mealStartedTick < 0
            ? {}
            : {
                experience: {
                  kind: 'food.ingestion' as const,
                  subjectConceptId: conceptId,
                  motivation: motivationForFoodIntent(state.foodIntent ?? 'satisfyNeed'),
                  actionTick: state.mealStartedTick,
                  outcomeTick: ctx.tick,
                  hungerBefore01: state.mealHungerBefore01,
                  hungerAfter01: needs.hunger,
                  illnessObserved: poisoned,
                },
              }),
          // Un empoisonnement ordinaire (toxicité 0.3) est déjà bien plus marquant qu'un
          // repas sain (0.2) ; un empoisonnement sévère (0.9) devient un vrai traumatisme
          // qui va survivre à des dizaines de repas suivants.
          emotionalStrength01: poisoned ? 0.8 : 0.2,
        },
        cognitionConfig,
      );
    } else if (done === 'rest') {
      rememberEpisodic(
        memory,
        {
          tick: ctx.tick,
          eventType: 'rest.completed',
          actors: [entity],
          x: transform.x,
          z: transform.z,
          outcome: 'physiology.energy_recovered',
          emotionalStrength01: 0.15,
        },
        cognitionConfig,
      );
    }

    state.action = 'none';
    state.targetX = null;
    state.targetZ = null;
    state.resourceId = null;
    state.resourceOwnerChunkKey = null;
    state.resourceLocalId = null;
    state.resourceConceptId = null;
    state.foodIntent = null;
    state.gatherStartedTick = -1;
    state.mealStartedTick = -1;
    state.mealHungerBefore01 = 0;
    state.currentMealCausedPoisoning = false;
    state.untilTick = -1;
    activity.kind = 'idle';
    activity.reason =
      done === 'drink'
        ? 'n’a plus soif'
        : done === 'eat'
          ? `repu (a mangé)`
          : `reposé (énergie ${needs.energy.toFixed(2)})`;
    activity.startedAtTick = ctx.tick;
    // Fin d'action : l'humain n'est plus socialement observable dans cette occurrence.
    // Retrait idempotent — drink/rest ne portent aujourd'hui aucun ObservableAction.
    this.clearObservable(ctx, entity);
    const plan = planState.activePlan;
    if (
      plan !== null &&
      plan.steps[plan.currentStepIndex]?.kind === (done === 'eat' ? 'eat.resource' : done)
    ) {
      plan.currentStepIndex += 1;
    }
  }

  private startTravel(
    ctx: SystemUpdateContext,
    entity: EntityId,
    state: NeedsStateComponent,
    activity: ActivityComponent,
    movement: MovementComponent,
    action: 'seekWater' | 'seekFood',
    targetX: number,
    targetZ: number,
    reason: string,
  ): void {
    state.action = action;
    state.targetX = targetX;
    state.targetZ = targetZ;
    state.untilTick = -1;
    movement.targetX = targetX;
    movement.targetZ = targetZ;
    activity.kind = 'walking';
    activity.reason = reason;
    activity.startedAtTick = ctx.tick;
    ctx.events.emit('ActionStarted', { tick: ctx.tick, entity, action: 'Move', reason });
  }

  private durationEndTick(
    ctx: SystemUpdateContext,
    missing: number,
    ratePerSecond: number,
    minSeconds: number,
    maxSeconds: number,
  ): number {
    const seconds = clamp(missing / ratePerSecond, minSeconds, maxSeconds);
    return ctx.tick + Math.max(1, Math.ceil(seconds / ctx.config.time.gameSecondsPerTick));
  }

  /**
   * Frontière publique/privée (Phase 3.8) : projette l'action en cours vers un composant
   * qu'un autre humain a le droit de lire. N'ÉCRIT que ce qui est perceptible à
   * distance — jamais la faim, la motivation, la valeur nutritionnelle, la maîtrise.
   * Utiliser une nouvelle valeur `startedAtTick` à chaque appel garantit que deux
   * occurrences consécutives (même acteur, même concept, même kind) produisent deux
   * `(actorId, kind, startedAtTick, subjectConceptId)` distincts et ne se confondent
   * jamais côté observateur.
   */
  private writeObservable(
    ctx: SystemUpdateContext,
    entity: EntityId,
    kind: ObservableActionKind,
    startedAtTick: number,
    subjectConceptId: string | null,
  ): void {
    ctx.entities.addComponent(entity, ObservableAction, {
      kind,
      startedAtTick,
      subjectConceptId,
    });
  }

  /**
   * Retire l'action observable si elle existait — idempotent. Un appel « défensif »
   * (rest, cancelSeek) ne coûte rien quand aucun ObservableAction n'était présent.
   */
  private clearObservable(ctx: SystemUpdateContext, entity: EntityId): void {
    ctx.entities.removeComponent(entity, ObservableAction);
  }
}

function targetForTravelStep(step: PlanStep): PlanFailureTarget | undefined {
  if (step.kind === 'move.to_resource') {
    return { kind: 'resource', worldRef: step.worldRef };
  }
  if (step.kind === 'move.to_water') {
    return {
      kind: 'water',
      rememberedX: step.rememberedX,
      rememberedZ: step.rememberedZ,
    };
  }
  return undefined;
}

/**
 * Traduit la confiance chiffrée en qualificatif lisible pour la `reason` (CLAUDE.md
 * règle 12). Les seuils suivent la même logique que le score de `spatialMemoryQuery` :
 * une confiance haute est un souvenir « net », basse un souvenir « flou ».
 */
