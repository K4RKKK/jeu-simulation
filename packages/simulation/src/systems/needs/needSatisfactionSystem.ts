import {
  Activity,
  CognitiveMemory,
  Movement,
  Needs,
  NeedsState,
  Transform,
} from '../../components/index.js';
import type {
  ActivityComponent,
  CognitiveMemoryComponent,
  MovementComponent,
  NeedsComponent,
  NeedsStateComponent,
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
import { nearestKnownFood, nearestKnownWater } from '../../cognition/spatialMemoryQuery.js';

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
 * Phase 3.5 : lit `CognitiveMemory.spatial` (souvenirs vieillissables, avec confiance et
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
      [Needs, Activity, Movement, Transform, CognitiveMemory],
      (entity, needs, activity, movement, transform, memory) => {
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
            untilTick: -1,
            mealMaxGain: 1,
            poisoningUntilTick: -1,
            poisoningToxicity01: 0,
            pathFailedAtTick: -1,
          });

        if (state.action === 'none') {
          this.decide(ctx, entity, needs, state, activity, movement, transform, memory);
          return;
        }

        if (state.action === 'seekWater' || state.action === 'seekFood') {
          // En route : le MovementSystem s'occupe du reste.
          if (movement.targetX !== null || movement.targetZ !== null) return;
          this.onArrival(ctx, entity, needs, state, activity, transform);
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
          this.finishAction(ctx, entity, needs, state, activity);
        }
      },
    );
  }

  private decide(
    ctx: SystemUpdateContext,
    entity: EntityId,
    needs: NeedsComponent,
    state: NeedsStateComponent,
    activity: ActivityComponent,
    movement: MovementComponent,
    transform: TransformComponent,
    memory: CognitiveMemoryComponent,
  ): void {
    const { needs: config } = ctx.config;
    if (needs.energy < config.energy.exhaustedThreshold) {
      this.startRest(ctx, needs, state, activity);
      return;
    }
    // Après un chemin introuvable, ne pas re-planifier dans le vide pendant le délai de
    // retenue posé par le PathfindingSystem : l'errance explore, la perception mémorisera
    // d'autres cibles.
    if (ctx.tick < state.pathFailedAtTick) return;
    if (needs.hydration < config.hydration.criticalThreshold) {
      this.seekWater(ctx, entity, state, activity, movement, transform, memory);
      return;
    }
    if (needs.hunger < config.hunger.criticalThreshold) {
      this.seekFood(ctx, entity, state, activity, movement, transform, memory);
    }
  }

  private seekWater(
    ctx: SystemUpdateContext,
    entity: EntityId,
    state: NeedsStateComponent,
    activity: ActivityComponent,
    movement: MovementComponent,
    transform: TransformComponent,
    memory: CognitiveMemoryComponent,
  ): void {
    const spot = nearestKnownWater(memory.spatial, transform.x, transform.z);
    // Sans souvenir de rive, pas de plan : l'errance explore, la perception mémorisera.
    if (!spot) return;
    const distance = Math.round(distance2D(transform.x, transform.z, spot.x, spot.z));
    this.startTravel(
      ctx,
      entity,
      state,
      activity,
      movement,
      'seekWater',
      spot.x,
      spot.z,
      `part boire (se souvient d'une rive à ${distance} m, ${describeConfidence(spot.confidence01)})`,
    );
  }

  private seekFood(
    ctx: SystemUpdateContext,
    entity: EntityId,
    state: NeedsStateComponent,
    activity: ActivityComponent,
    movement: MovementComponent,
    transform: TransformComponent,
    memory: CognitiveMemoryComponent,
  ): void {
    // Volontairement aucune connaissance de la toxicité (CLAUDE.md « Pas de faux code » et
    // règle 12) : elle n'entre jamais en mémoire, elle se découvre en mangeant. Le seul
    // critère du choix est l'apparence de nourriture (`foodKcal > 0`), relue à travers
    // `worldRef` — non stockée dans la cognition (vérité moteur cachée).
    const chosen = nearestKnownFood(
      memory.spatial,
      transform.x,
      transform.z,
      (worldRef) => ctx.world.findResourceById(worldRef.resourceId, worldRef.ownerChunkKey),
      (resourceId) => ctx.world.delta.isDepleted(resourceId),
    );
    if (!chosen) return;
    const { entry, spawn } = chosen;
    const distance = Math.round(distance2D(transform.x, transform.z, entry.x, entry.z));
    this.startTravel(
      ctx,
      entity,
      state,
      activity,
      movement,
      'seekFood',
      entry.x,
      entry.z,
      `part chercher de la nourriture (se souvient de ${spawn.definitionId} à ${distance} m, ${describeConfidence(entry.confidence01)})`,
    );
    state.resourceId = spawn.id;
    state.resourceOwnerChunkKey = spawn.ownerChunkKey;
    state.resourceLocalId = spawn.localId;
  }

  private onArrival(
    ctx: SystemUpdateContext,
    entity: EntityId,
    needs: NeedsComponent,
    state: NeedsStateComponent,
    activity: ActivityComponent,
    transform: TransformComponent,
  ): void {
    const targetX = state.targetX;
    const targetZ = state.targetZ;
    if (targetX === null || targetZ === null) {
      state.action = 'none';
      return;
    }
    // Arrivé ? Le MovementSystem pose la cible exacte, mais une petite marge protège des
    // cas où la cible n'était pas atteignable au dernier mètre.
    const arrived = distance2D(transform.x, transform.z, targetX, targetZ) <= 2.5;
    if (!arrived) {
      state.action = 'none';
      return;
    }

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
        state.action = 'none';
        return;
      }
      const spawn = ctx.world.findResourceById(state.resourceId, state.resourceOwnerChunkKey);
      if (!spawn) {
        state.action = 'none';
        return;
      }
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
        return;
      }
    }
    state.action = 'eat';
    state.mealMaxGain = mealMaxGain;
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
    activity.reason = `mange pour apaiser sa faim (faim ${needs.hunger.toFixed(2)})`;
    activity.startedAtTick = ctx.tick;
    // La toxicité n'est connue qu'à l'ingestion : si la ressource était douteuse, les
    // symptômes commencent maintenant — trop tard pour les éviter.
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
  ): void {
    const done = state.action;
    if (done === 'eat' && state.resourceId !== null) {
      endResourceInteraction(ctx.entities, entity, state.resourceId);
    }
    state.action = 'none';
    state.targetX = null;
    state.targetZ = null;
    state.resourceId = null;
    state.resourceOwnerChunkKey = null;
    state.resourceLocalId = null;
    state.untilTick = -1;
    activity.kind = 'idle';
    activity.reason =
      done === 'drink'
        ? 'n’a plus soif'
        : done === 'eat'
          ? `repu (a mangé)`
          : `reposé (énergie ${needs.energy.toFixed(2)})`;
    activity.startedAtTick = ctx.tick;
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

/**
 * Traduit la confiance chiffrée en qualificatif lisible pour la `reason` (CLAUDE.md
 * règle 12). Les seuils suivent la même logique que le score de `spatialMemoryQuery` :
 * une confiance haute est un souvenir « net », basse un souvenir « flou ».
 */
function describeConfidence(confidence01: number): string {
  if (confidence01 >= 0.75) return 'souvenir net';
  if (confidence01 >= 0.4) return 'souvenir un peu flou';
  return 'souvenir très flou';
}
