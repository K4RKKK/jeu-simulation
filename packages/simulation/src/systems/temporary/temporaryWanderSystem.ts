import type { EntityId } from '@civ/shared';
import { Activity, Movement, NeedsState, Personality, Transform } from '../../components/index.js';
import type {
  ActivityComponent,
  MovementComponent,
  PersonalityComponent,
  TransformComponent,
} from '../../components/index.js';
import type { SystemFrequency } from '../../config/simulationConfig.js';
import { defineComponent } from '../../core/componentType.js';
import { TAU, lerp } from '../../core/math.js';
import type { SimulationSystem, SystemUpdateContext } from '../../core/system.js';
import { attemptCountForPerseverance, maxSlopeForCaution } from './wanderTraits.js';

/**
 * @temporary
 *
 * État interne du wander. Défini **dans ce fichier** et non dans `components/` : supprimer
 * le système doit suffire à supprimer toute trace de lui dans le moteur.
 *
 * `restUntilTick < 0` signifie « aucune pause programmée » — c'est l'état dans lequel se
 * retrouve un humain qui vient d'arriver à destination.
 */
interface TemporaryWanderState {
  restUntilTick: number;
}

const WanderState = defineComponent<TemporaryWanderState>('TemporaryWanderState');

/**
 * @temporary
 *
 * SYSTÈME TEMPORAIRE — À SUPPRIMER.
 *
 * Il n'existe que pour valider la chaîne complète de la phase 1 :
 * entités → tick de simulation → réseau → rendu.
 *
 * Il choisit une destination sans aucune raison réelle : pas de besoin, pas de mémoire,
 * pas de perception, pas d'objectif. C'est précisément ce que le projet interdit à terme.
 *
 * **Condition de suppression** : dès que `UtilityAI` + `ActionPlanner` existent, ce fichier
 * est supprimé et l'intention `Explore` prend sa place. Aucun autre système ne dépend de
 * lui : il n'écrit que `Movement.target*` et `Activity`, exactement comme le fera le
 * planificateur.
 *
 * Seule concession au projet final : la personnalité influence déjà réellement la décision,
 * afin de vérifier que les traits se propagent bien jusqu'au comportement observable :
 * curiosité → distance parcourue, patience → durée des pauses, prudence → pente tolérée,
 * persévérance → efforts avant renoncement, courage → déplacement nocturne.
 */
export class TemporaryWanderSystem implements SimulationSystem {
  readonly name = 'TemporaryWanderSystem';
  readonly frequency: SystemFrequency = 'medium';

  update(ctx: SystemUpdateContext): void {
    ctx.entities.each(
      [Transform, Movement, Activity, Personality],
      (entity, transform, movement, activity, personality) => {
        // En chemin : le MovementSystem s'en occupe.
        if (movement.targetX !== null || movement.targetZ !== null) return;

        // Un besoin critique en cours d'assouvissement n'est pas un loisir : l'individu
        // boit, mange ou se repose — le wander n'interfère pas (CLAUDE.md règle 9).
        const needsState = ctx.entities.getComponent(entity, NeedsState);
        if (needsState && needsState.action !== 'none') return;

        const state =
          ctx.entities.getComponent(entity, WanderState) ??
          ctx.entities.addComponent(entity, WanderState, { restUntilTick: -1 });

        // La nuit, tout le monde se repose… sauf les courageux, qui continuent de se
        // déplacer. Le jour décidé par l'environnement est la vérité partagée.
        const isNight = !ctx.world.environment.sample(ctx.clock).isDaytime;
        const mayWanderAtNight =
          personality.courage >= ctx.config.wander.nightMovementCourageThreshold;

        if (state.restUntilTick < 0) {
          // Arrivé à destination, ou nuit tombée pendant une pause : on se repose.
          if (isNight && !mayWanderAtNight) {
            this.startNightRest(ctx, activity, personality, state);
            return;
          }
          this.startResting(ctx, activity, personality, state);
          return;
        }

        if (ctx.tick < state.restUntilTick) return;

        // Pause terminée : la nuit impose encore le repos aux non-courageux.
        if (isNight && !mayWanderAtNight) {
          this.startNightRest(ctx, activity, personality, state);
          return;
        }

        this.startWalking(ctx, entity, transform, movement, activity, personality, state);
      },
    );
  }

  /** Repos nocturne sans fin programmée : l'aube décide, pas une durée. */
  private startNightRest(
    ctx: SystemUpdateContext,
    activity: ActivityComponent,
    personality: PersonalityComponent,
    state: TemporaryWanderState,
  ): void {
    // Déjà au repos nocturne : ne pas faire repartir la montre du snapshot à chaque tick.
    if (activity.kind === 'idle' && activity.reason.startsWith('la nuit est tombée')) return;
    state.restUntilTick = -1;
    activity.kind = 'idle';
    activity.reason = `la nuit est tombée, se repose (courage ${personality.courage.toFixed(2)})`;
    activity.startedAtTick = ctx.tick;
  }

  private startResting(
    ctx: SystemUpdateContext,
    activity: ActivityComponent,
    personality: PersonalityComponent,
    state: TemporaryWanderState,
  ): void {
    const wander = ctx.config.wander;
    const longestPause = lerp(wander.minIdleSeconds, wander.maxIdleSeconds, personality.patience);
    const pauseSeconds = ctx.rng.behavior.range(
      wander.minIdleSeconds,
      Math.max(wander.minIdleSeconds, longestPause),
    );
    const ticksPerGameSecond = 1 / ctx.clock.gameSecondsPerTick;

    state.restUntilTick = ctx.tick + Math.max(1, Math.round(pauseSeconds * ticksPerGameSecond));
    activity.kind = 'idle';
    activity.reason = `au repos (patience ${personality.patience.toFixed(2)})`;
    activity.startedAtTick = ctx.tick;
  }

  private startWalking(
    ctx: SystemUpdateContext,
    entity: EntityId,
    transform: TransformComponent,
    movement: MovementComponent,
    activity: ActivityComponent,
    personality: PersonalityComponent,
    state: TemporaryWanderState,
  ): void {
    const wander = ctx.config.wander;
    const rng = ctx.rng.behavior;
    const limit = ctx.world.bounds.halfSizeMeters - wander.worldMarginMeters;

    // Un curieux s'éloigne davantage ; un individu peu curieux reste près d'où il est.
    const reach = lerp(wander.minDistanceMeters, wander.maxDistanceMeters, personality.curiosity);

    // Un prudent évite les pentes raides ; un audacieux les affronte. Un persévérant
    // cherche plus longtemps avant de renoncer ; un résigné abandonne vite.
    const maxSlope = maxSlopeForCaution(personality.caution, wander);
    const attempts = attemptCountForPerseverance(personality.perseverance, wander);
    const isNight = !ctx.world.environment.sample(ctx.clock).isDaytime;

    // Le terrain existe désormais : une destination doit être atteignable. On tire
    // plusieurs candidats et on rejette l'eau profonde et les pentes infranchissables.
    // Ce n'est pas encore du pathfinding — le trajet reste une ligne droite — mais un
    // humain ne marchera plus vers le fond d'un lac.
    for (let attempt = 0; attempt < attempts; attempt++) {
      const distance = rng.range(
        wander.minDistanceMeters,
        Math.max(wander.minDistanceMeters, reach),
      );
      const angle = rng.range(0, TAU);
      const targetX = clampTo(transform.x + Math.sin(angle) * distance, limit);
      const targetZ = clampTo(transform.z + Math.cos(angle) * distance, limit);

      if (!ctx.world.isWalkable(targetX, targetZ)) continue;
      if (ctx.world.slopeAt(targetX, targetZ) > maxSlope) continue;

      movement.targetX = targetX;
      movement.targetZ = targetZ;
      state.restUntilTick = -1;

      activity.kind = 'walking';
      activity.reason = isNight
        ? `se déplace la nuit (curiosité ${personality.curiosity.toFixed(2)}, ` +
          `courage ${personality.courage.toFixed(2)})`
        : `se déplace sans but précis (curiosité ${personality.curiosity.toFixed(2)})`;
      activity.startedAtTick = ctx.tick;

      ctx.events.emit('ActionStarted', {
        tick: ctx.tick,
        entity,
        action: 'Move',
        reason: activity.reason,
      });
      return;
    }

    // Aucune direction praticable : on reste sur place et on retentera après une pause.
    state.restUntilTick = -1;
    activity.kind = 'idle';
    activity.reason = 'ne trouve pas de direction praticable';
    activity.startedAtTick = ctx.tick;
  }
}

function clampTo(value: number, limit: number): number {
  return value < -limit ? -limit : value > limit ? limit : value;
}
