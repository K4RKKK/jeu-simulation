import {
  Activity,
  CognitiveMemory,
  HumanCognition,
  HumanPlan,
  Movement,
  Needs,
  NeedsState,
  Transform,
} from '../../components/index.js';
import type {
  ActivityComponent,
  CognitiveMemoryComponent,
  HumanPlanComponent,
  MovementComponent,
  NeedsComponent,
  NeedsStateComponent,
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
  endResourceInteraction,
  harvestInteractiveResource,
} from '../../world/resourceInteraction.js';
import { rememberEpisodic } from '../../cognition/episodicMemoryModel.js';
import { goalForNeedsAction } from '../../cognition/goalModel.js';
import { motivationForFoodIntent } from '../../cognition/foodActionIntent.js';
import { invalidateSpatialWorldRef } from '../../cognition/spatialMemoryModel.js';

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
      [Needs, Activity, Movement, Transform, CognitiveMemory, HumanCognition, HumanPlan],
      (entity, needs, activity, movement, transform, memory, cognition, planState) => {
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
            this.cancelSeek(state, movement);
            return;
          }
          if (
            cognition.activeGoal !== null &&
            cognition.activeGoal.kind !== goalForNeedsAction(state.action, state.foodIntent)
          ) {
            this.cancelSeek(state, movement);
            return;
          }
          // En route : le MovementSystem s'occupe du reste.
          if (movement.targetX !== null || movement.targetZ !== null) return;
          this.onArrival(ctx, entity, needs, state, activity, transform, memory, planState);
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
      this.startRest(ctx, needs, state, activity);
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

  private cancelSeek(state: NeedsStateComponent, movement: MovementComponent): void {
    state.action = 'none';
    state.targetX = null;
    state.targetZ = null;
    state.resourceId = null;
    state.resourceOwnerChunkKey = null;
    state.resourceLocalId = null;
    state.resourceConceptId = null;
    state.foodIntent = null;
    movement.targetX = null;
    movement.targetZ = null;
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
  ): void {
    const travelStep = this.currentTravelStep(planState);
    const failureTarget = travelStep === undefined ? undefined : targetForTravelStep(travelStep);
    const targetX = state.targetX;
    const targetZ = state.targetZ;
    if (targetX === null || targetZ === null) {
      state.action = 'none';
      this.recordPlanFailure(planState, 'interaction.failed', ctx.tick, failureTarget);
      return;
    }
    // Arrivé ? Le MovementSystem pose la cible exacte, mais une petite marge protège des
    // cas où la cible n'était pas atteignable au dernier mètre.
    const arrived = distance2D(transform.x, transform.z, targetX, targetZ) <= 2.5;
    if (!arrived) {
      state.action = 'none';
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
      state.action = 'none';
      this.invalidateMissingTarget(memory, travelStep);
      this.recordPlanFailure(planState, 'target.missing', ctx.tick, failureTarget);
      return;
    }
    // La toxicité n'est pas mémorisée : elle se lit sur la ressource elle-même, au moment
    // de la cueillir — trop tard pour éviter les symptômes, juste à temps pour les subir.
    let toxicity = 0;
    // Taille du repas — dérivée des calories réelles de la ressource, pas d'une durée
    // arbitraire. `1` par défaut (repas plein) si jamais aucune ressource n'est visée.
    let mealMaxGain = 1;
    // Nombre de récoltes que cette ressource peut encore fournir au total (`≥ 1`,
    // voir `ResourceDefinition.harvestServings`) — sert à la fois à diviser le repas
    // (une visite = une fraction, pas la ressource entière) et à `harvestResource`
    // plus bas, qui décide seul si CETTE visite est la dernière.
    let harvestServings = 1;
    let interactiveResourceEntity: EntityId | null = null;
    if (state.resourceId) {
      if (state.resourceOwnerChunkKey === null || state.resourceLocalId === null) {
        // Sans clé de chunk propriétaire, on ne peut plus la retrouver de façon fiable
        // (une position jitterée peut désigner un autre chunk), et sans localId on ne
        // peut pas diffuser sa modification. On abandonne le plan avant la promotion.
        // `localId` is only world truth. Resolve it at interaction time, not planning.
        if (state.resourceOwnerChunkKey === null) {
          state.action = 'none';
          this.invalidateMissingTarget(memory, travelStep);
          this.recordPlanFailure(planState, 'target.missing', ctx.tick, failureTarget);
          return;
        }
      }
      const spawn = ctx.world.findResourceById(state.resourceId, state.resourceOwnerChunkKey);
      if (!spawn) {
        state.action = 'none';
        this.invalidateMissingTarget(memory, travelStep);
        this.recordPlanFailure(planState, 'target.missing', ctx.tick, failureTarget);
        return;
      }
      state.resourceLocalId = spawn.localId;
      toxicity = spawn.foodToxicity01;
      harvestServings = spawn.harvestServings;
      // Chaque visite, y compris la dernière, ne vaut qu'une fraction du repas complet :
      // une ressource à 3 portions ne doit pas donner 3× plus de calories au total qu'une
      // ressource à 1 portion pour la même taille de plante.
      mealMaxGain = clamp(
        spawn.foodKcal / harvestServings / ctx.config.needs.hunger.kcalPerFullMeal,
        0,
        1,
      );
      interactiveResourceEntity = beginResourceInteraction(
        ctx.entities,
        ctx.world,
        entity,
        state.resourceId,
        state.resourceOwnerChunkKey,
        ctx.tick,
      );
      // La promotion peut échouer si un autre acteur a épuisé la ressource entre
      // sa relecture et ce point. Dans ce cas, aucun repas fantôme n'est accordé.
      if (interactiveResourceEntity === null) {
        state.action = 'none';
        this.invalidateMissingTarget(memory, travelStep);
        this.recordPlanFailure(planState, 'target.missing', ctx.tick, failureTarget);
        return;
      }
    }
    state.action = 'eat';
    state.mealMaxGain = mealMaxGain;
    state.mealStartedTick = ctx.tick;
    state.mealHungerBefore01 = needs.hunger;
    state.currentMealCausedPoisoning = toxicity > ctx.config.needs.toxicity.effectThreshold01;
    // La durée elle-même reflète aussi la taille du repas : une petite baie ne retient
    // pas un humain aussi longtemps qu'un repas complet, même si la faim est encore loin
    // de son objectif — sinon le plancher `minEatSeconds` referait gagner plus de faim
    // que ce que la ressource peut réellement fournir (voir le clamp dans MetabolismSystem
    // pour la garantie stricte, cette durée n'est qu'une approximation cohérente).
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
    // La toxicité réelle n'est révélée qu'à l'ingestion : les symptômes commencent
    // maintenant, puis la fin du repas mettra à jour une croyance sur son apparence.
    if (toxicity > ctx.config.needs.toxicity.effectThreshold01) {
      state.poisoningToxicity01 = toxicity;
      state.poisoningUntilTick =
        ctx.tick +
        Math.max(
          1,
          Math.ceil(ctx.config.needs.toxicity.durationSeconds / ctx.config.time.gameSecondsPerTick),
        );
    }
    // La ressource est entamée : une portion en moins. `harvestResource` retire la
    // ressource du monde de lui-même à la dernière portion (comportement inchangé pour
    // une ressource à une seule portion) — un buisson cueilli ne repousse pas tant que
    // la régénération saisonnière n'existe pas.
    if (
      state.resourceId &&
      state.resourceOwnerChunkKey !== null &&
      state.resourceLocalId !== null
    ) {
      if (interactiveResourceEntity === null) {
        // Garde structurelle : toutes les ressources ciblées doivent avoir été
        // promues plus haut avant une modification.
        state.action = 'none';
        return;
      }
      harvestInteractiveResource(ctx.entities, ctx.world, interactiveResourceEntity, ctx.tick);
    }
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
    if (done === 'eat' && state.resourceId !== null) {
      endResourceInteraction(ctx.entities, entity, state.resourceId);
    }

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
