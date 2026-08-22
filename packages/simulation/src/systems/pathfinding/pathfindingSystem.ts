import { NavGrid, PathFindingService, type TileCoord } from '@civ/pathfinding';
import type { EntityId } from '@civ/shared';
import { Activity, HumanPlan, Movement, NeedsState, Transform } from '../../components/index.js';
import type {
  ActivityComponent,
  MovementComponent,
  PlanFailureTarget,
  PlanStep,
} from '../../components/index.js';
import type { SystemFrequency } from '../../config/simulationConfig.js';
import { distance2D } from '../../core/math.js';
import type { SimulationSystem, SystemUpdateContext } from '../../core/system.js';
import { createTerrainCostMemo, terrainTileCostProvider } from './terrainCostProvider.js';

/**
 * Fait le pont entre les décideurs et le déplacement : quand une entité a une cible,
 * il lui calcule un chemin (file à budget, cache LRU — voir `@civ/pathfinding`) et pose
 * les points de passage que le `MovementSystem` consomme.
 *
 * Responsabilité unique (CLAUDE.md règle 7) : ce système ne décide **pas** où aller, il
 * rend la cible *atteignable*. Quand aucun chemin n'existe, il rend la décision caduque :
 * il efface la cible et écrit une `reason` lisible (« chemin introuvable »). Pour une
 * cible vitale (soif/faim), il pose aussi `NeedsState.pathFailedAtTick` : le
 * planificateur n'osera pas retenter l'impossibilité avant le délai configuré, et
 * l'errance reprend — c'est elle qui explorera et mémorisera d'autres cibles.
 *
 * Correspondance résultat ↔ entité : par `requestId` uniquement. L'apparier par cible
 * (bug historique) attribuait le chemin de A au voisin B qui visait la même rivière ; B
 * démarrait alors depuis la position de A. L'id est unique à la requête, donc à l'entité.
 *
 * Dernier point de passage : quand la cible originale n'était pas praticable, le service
 * l'a snappée sur la tuile voisine. Le dernier waypoint reste alors le centre de cette
 * tuile snappée, jamais la position originale — un humain ne finit pas sa marche dans
 * l'eau parce que l'utilisateur a cliqué au milieu d'un lac.
 */
export class PathfindingSystem implements SimulationSystem {
  readonly name = 'PathfindingSystem';
  readonly frequency: SystemFrequency = 'fast';

  private service: PathFindingService | null = null;

  private ensureService(ctx: SystemUpdateContext): PathFindingService {
    if (this.service !== null) return this.service;
    const config = ctx.config.pathfinding;
    // Avant l'A* incrémental, les 12 000 nœuds par défaut étaient dépensés d'un bloc
    // toutes les 5 simulations (`medium`). On conserve le même débit et le même plafond
    // de travail sur cette période, mais on le répartit sur chaque tick pour supprimer
    // les pointes. Le quotient dépend de la cadence configurée, pas d'une constante cachée.
    const nodesPerSimulationTick = Math.max(
      1,
      Math.ceil(config.maxNodesPerTick / ctx.config.scheduler.intervals.medium),
    );
    this.service = new PathFindingService({
      grid: new NavGrid({
        tileSizeMeters: config.tileSizeMeters,
        cost: terrainTileCostProvider(ctx.world, config),
      }),
      maxNodesPerTick: nodesPerSimulationTick,
      maxNodesPerRequest: config.maxNodesPerRequest,
      maxRetries: config.maxRetries,
      pathCacheCapacity: config.pathCacheCapacity,
      snapRadiusTiles: config.snapRadiusTiles,
      sharedCostMemo: createTerrainCostMemo(config.terrainCostCacheCapacity),
    });
    return this.service;
  }

  update(ctx: SystemUpdateContext): void {
    const service = this.ensureService(ctx);
    this.applyResults(ctx, service);
    this.enqueueRequests(ctx, service);
  }

  /** Applique les chemins terminés à l'entité identifiée par `pathRequestId`. */
  private applyResults(ctx: SystemUpdateContext, service: PathFindingService): void {
    const outcomes = service.process();
    if (outcomes.length === 0) return;

    // Index requestId → outcome pour éviter un O(N × outcomes) sur `entities.each`.
    const byId = new Map<number, (typeof outcomes)[number]>();
    for (const outcome of outcomes) byId.set(outcome.request.id, outcome);

    ctx.entities.each([Transform, Movement, Activity], (entity, _transform, movement, activity) => {
      const pendingId = movement.pathRequestId;
      if (pendingId === null) return;
      const outcome = byId.get(pendingId);
      if (outcome === undefined) return;

      movement.pathRequestId = null;
      movement.pathPendingFor = null;

      // Cible effacée pendant le calcul : le résultat ne concerne plus personne.
      if (movement.targetX === null || movement.targetZ === null) return;

      if (outcome.path === null) {
        this.fail(ctx, entity, movement, activity);
        return;
      }
      movement.waypoints = toWaypoints(
        outcome.path,
        service,
        movement.targetX,
        movement.targetZ,
        outcome.request.goal,
        outcome.request.originalGoal,
      );
    });
  }

  /** Demande un chemin pour toute entité qui a une cible sans chemin en cours. */
  private enqueueRequests(ctx: SystemUpdateContext, service: PathFindingService): void {
    const arrivalRadius = ctx.config.movement.arrivalRadiusMeters;

    ctx.entities.each([Transform, Movement, Activity], (entity, transform, movement, activity) => {
      const targetX = movement.targetX;
      const targetZ = movement.targetZ;
      if (targetX === null || targetZ === null) return;
      if (movement.waypoints.length > 0) return; // déjà en route
      if (distance2D(transform.x, transform.z, targetX, targetZ) <= arrivalRadius) return;

      if (movement.pathRequestId !== null) {
        const pending = movement.pathPendingFor;
        if (pending !== null) {
          const pendingTile = service.tileAt(pending.x, pending.z);
          const goalTile = service.tileAt(targetX, targetZ);
          if (pendingTile.x === goalTile.x && pendingTile.z === goalTile.z) return; // en vol
        }
        // Cible changée : la requête en vol devient orpheline (jamais appariée).
        service.cancel(movement.pathRequestId);
        movement.pathRequestId = null;
        movement.pathPendingFor = null;
      }

      const reply = service.request(
        { x: transform.x, z: transform.z },
        { x: targetX, z: targetZ },
        ctx.tick,
      );

      if (reply.immediate !== null) {
        if (reply.immediate.path === null) {
          this.fail(ctx, entity, movement, activity);
        } else {
          movement.waypoints = toWaypoints(
            reply.immediate.path,
            service,
            targetX,
            targetZ,
            reply.resolvedGoal!,
            reply.originalGoal,
          );
        }
        return;
      }

      movement.pathRequestId = reply.requestId;
      movement.pathPendingFor = { x: targetX, z: targetZ };
    });
  }

  private fail(
    ctx: SystemUpdateContext,
    entity: EntityId,
    movement: MovementComponent,
    activity: ActivityComponent,
  ): void {
    movement.targetX = null;
    movement.targetZ = null;
    movement.currentSpeedMps = 0;
    movement.waypoints = [];
    movement.pathPendingFor = null;
    movement.pathRequestId = null;
    activity.kind = 'idle';
    activity.reason = 'chemin introuvable';
    activity.startedAtTick = ctx.tick;

    // Une cible vitale inatteignable ne doit pas être retentée immédiatement : le
    // planificateur laisse passer le délai de retenue avant de re-planifier.
    const needsState = ctx.entities.getComponent(entity, NeedsState);
    if (needsState && (needsState.action === 'seekWater' || needsState.action === 'seekFood')) {
      needsState.pathFailedAtTick = ctx.tick + ctx.config.pathfinding.failureRetryTicks;
      needsState.action = 'none';
      needsState.targetX = null;
      needsState.targetZ = null;
      needsState.resourceId = null;
      needsState.resourceOwnerChunkKey = null;
      needsState.resourceLocalId = null;
      needsState.resourceConceptId = null;
      needsState.foodIntent = null;
    }
    const planState = ctx.entities.getComponent(entity, HumanPlan);
    const plan = planState?.activePlan;
    if (
      plan &&
      (plan.steps[plan.currentStepIndex]?.kind === 'move.to_water' ||
        plan.steps[plan.currentStepIndex]?.kind === 'move.to_resource')
    ) {
      const failure = {
        stepIndex: plan.currentStepIndex,
        reason: 'target.unreachable' as const,
        tick: ctx.tick,
        target: failureTarget(plan.steps[plan.currentStepIndex]),
      };
      plan.lastFailure = failure;
      planState.lastFailure = failure;
    }
  }
}

function failureTarget(step: PlanStep | undefined): PlanFailureTarget | undefined {
  if (step?.kind === 'move.to_resource') {
    return { kind: 'resource', worldRef: step.worldRef };
  }
  if (step?.kind === 'move.to_water') {
    return {
      kind: 'water',
      rememberedX: step.rememberedX,
      rememberedZ: step.rememberedZ,
    };
  }
  return undefined;
}

/**
 * Tuiles → points de passage en mètres.
 *
 * Le dernier point de passage vaut la cible exacte demandée **uniquement si** elle est
 * praticable (originalGoal == resolvedGoal). Sinon, le dernier point reste au centre de
 * la tuile snappée : le service a déjà refusé la cible originale, l'humain ne doit pas
 * y aller quand même.
 */
function toWaypoints(
  path: TileCoord[],
  service: PathFindingService,
  targetX: number,
  targetZ: number,
  resolvedGoal: TileCoord,
  originalGoal: TileCoord,
): { x: number; z: number }[] {
  const waypoints = path.map((tile) => {
    const center = service.centerMeters(tile);
    return { x: center.x, z: center.z };
  });
  if (waypoints.length === 0) return waypoints;
  if (originalGoal.x === resolvedGoal.x && originalGoal.z === resolvedGoal.z) {
    waypoints[waypoints.length - 1] = { x: targetX, z: targetZ };
  }
  return waypoints;
}
