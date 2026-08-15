import type { EntityId } from '@civ/shared';
import type { SystemFrequency } from '../config/simulationConfig.js';
import { Activity, Movement, Transform } from '../components/index.js';
import type { MovementComponent } from '../components/index.js';
import { angleTo, distance2D, rotateTowards } from '../core/math.js';
import type { SimulationSystem, SystemUpdateContext } from '../core/system.js';

/**
 * Déplace les entités le long de leurs points de passage.
 *
 * Responsabilité unique (CLAUDE.md règle 7) : ce système ne décide **jamais** où aller.
 * Il consomme `Movement.waypoints` (liste de points de passage en mètres) posée par le
 * `PathfindingSystem`, et signale l'arrivée. Les décideurs continuent de ne poser qu'une
 * cible (`targetX/targetZ`) : le pont est invisible pour eux.
 *
 * Une entité avec une cible mais sans chemin en cours reste immobile : elle attend son
 * chemin, elle ne traverse jamais une rivière en ligne droite.
 */
export class MovementSystem implements SimulationSystem {
  readonly name = 'MovementSystem';
  readonly frequency: SystemFrequency = 'fast';

  update(ctx: SystemUpdateContext): void {
    const { arrivalRadiusMeters, turnRateRadPerSecond } = ctx.config.movement;
    const dt = ctx.deltaGameSeconds;
    if (dt <= 0) return;

    const maxTurn = turnRateRadPerSecond * dt;

    ctx.entities.each([Transform, Movement, Activity], (entity, transform, movement, activity) => {
      const startedX = transform.x;
      const startedZ = transform.z;
      if (movement.waypoints.length === 0) {
        // Aucun chemin : arrivé de justesse, ou chemin en cours de calcul. L'arrivée
        // « de justesse » (cible déjà sous les pieds) est traitée ici pour ne pas faire
        // attendre un tick à une entité qui n'a jamais eu besoin de chemin.
        const targetX = movement.targetX;
        const targetZ = movement.targetZ;
        if (targetX !== null && targetZ !== null) {
          const remaining = distance2D(transform.x, transform.z, targetX, targetZ);
          if (remaining <= arrivalRadiusMeters) {
            this.arrive(ctx, entity, transform, movement, activity, targetX, targetZ);
          }
        }
        movement.currentSpeedMps = 0;
        this.recordTraffic(ctx, movement, startedX, startedZ, transform.x, transform.z);
        return;
      }

      let reach = movement.walkSpeedMps * dt;
      while (movement.waypoints.length > 0 && reach > 0) {
        const waypoint = movement.waypoints[0]!;
        const remaining = distance2D(transform.x, transform.z, waypoint.x, waypoint.z);

        // Arrivé sur le point de passage : on s'y pose, on le consomme, et le reste du
        // pas est reporté sur le point suivant — pas de tressautement à chaque tuile.
        if (remaining <= arrivalRadiusMeters || reach >= remaining) {
          reach -= remaining;
          transform.x = waypoint.x;
          transform.z = waypoint.z;
          transform.y = ctx.world.heightAt(transform.x, transform.z);
          movement.waypoints.shift();
          if (movement.waypoints.length === 0) {
            this.arrive(ctx, entity, transform, movement, activity, transform.x, transform.z);
          }
          continue;
        }

        // En route : on avance vers ce point et on oriente le corps progressivement —
        // un humain ne pivote pas instantanément.
        const heading = angleTo(transform.x, transform.z, waypoint.x, waypoint.z);
        transform.x += Math.sin(heading) * reach;
        transform.z += Math.cos(heading) * reach;
        // L'altitude n'est pas une variable libre : elle suit le sol, systématiquement.
        transform.y = ctx.world.heightAt(transform.x, transform.z);
        transform.yaw = rotateTowards(transform.yaw, heading, maxTurn);
        movement.currentSpeedMps = reach / dt;
        reach = 0;
      }
      this.recordTraffic(ctx, movement, startedX, startedZ, transform.x, transform.z);
    });
  }

  /**
   * Échantillonne l'usure du sentier — mais pas à chaque tick.
   *
   * Bug de performance corrigé : à 20 Hz, un humain avance de quelques centimètres par
   * tick ; ré-échantillonner le segment complet (plusieurs points par mètre, voir
   * `World.recordFootTraffic`) pour un déplacement aussi petit était pur gaspillage —
   * significatif à plusieurs centaines d'humains en mouvement continu. On accumule
   * maintenant la distance depuis le dernier échantillon réel, et on ne déclenche
   * l'échantillonnage qu'après `trailSampleThresholdMeters` (0,5 m par défaut).
   */
  private recordTraffic(
    ctx: SystemUpdateContext,
    movement: MovementComponent,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
  ): void {
    if (fromX === toX && fromZ === toZ) return;

    const lastX = movement.lastTrailSampleX;
    const lastZ = movement.lastTrailSampleZ;
    if (lastX !== null && lastZ !== null) {
      const sinceLastSample = distance2D(lastX, lastZ, toX, toZ);
      if (sinceLastSample < ctx.config.movement.trailSampleThresholdMeters) return;
    }

    ctx.world.recordFootTraffic(lastX ?? fromX, lastZ ?? fromZ, toX, toZ);
    movement.lastTrailSampleX = toX;
    movement.lastTrailSampleZ = toZ;
  }

  private arrive(
    ctx: SystemUpdateContext,
    entity: EntityId,
    transform: { x: number; z: number; y: number },
    movement: { targetX: number | null; targetZ: number | null; currentSpeedMps: number },
    activity: { kind: string; reason: string; startedAtTick: number },
    targetX: number,
    targetZ: number,
  ): void {
    transform.x = targetX;
    transform.z = targetZ;
    transform.y = ctx.world.heightAt(targetX, targetZ);
    movement.targetX = null;
    movement.targetZ = null;
    movement.currentSpeedMps = 0;
    activity.kind = 'idle';
    activity.reason = 'destination atteinte';
    activity.startedAtTick = ctx.tick;
    ctx.events.emit('ActionCompleted', { tick: ctx.tick, entity, action: 'Move' });
  }
}
