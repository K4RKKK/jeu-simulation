import type { ClockSnapshot, NetworkEvent } from '@civ/shared';
import type { SimulationEvent } from '@civ/simulation';

type NetworkEventDate = Pick<ClockSnapshot, 'year' | 'day' | 'hour' | 'minute'>;
type UndatedNetworkEvent = Omit<NetworkEvent, keyof NetworkEventDate>;

/**
 * Traduit un événement interne en événement réseau.
 *
 * Le `switch` est exhaustif par construction : ajouter un événement au
 * `SimulationEventMap` sans le traiter ici provoquera une erreur de compilation. C'est
 * volontaire — un événement oublié doit se voir à la compilation, pas en production.
 */
export function toNetworkEvent(event: SimulationEvent, occurredAt: NetworkEventDate): NetworkEvent {
  return { ...toUndatedNetworkEvent(event), ...occurredAt };
}

function toUndatedNetworkEvent(event: SimulationEvent): UndatedNetworkEvent {
  switch (event.name) {
    case 'SimulationStarted':
      return base(event.name, event.payload.tick, null, `Monde "${event.payload.worldId}" démarré`);
    case 'SimulationPaused':
      return base(event.name, event.payload.tick, null, 'Simulation en pause');
    case 'SimulationResumed':
      return base(event.name, event.payload.tick, null, 'Simulation reprise');
    case 'HumanBorn':
      return base(
        event.name,
        event.payload.tick,
        event.payload.entity,
        `${event.payload.name} (${event.payload.ageYears} ans) apparaît`,
      );
    case 'HumanDied':
      return base(
        event.name,
        event.payload.tick,
        event.payload.entity,
        `${event.payload.name} meurt — ${event.payload.cause}`,
      );
    case 'EntityDestroyed':
      return base(event.name, event.payload.tick, event.payload.entity, 'Entité détruite');
    case 'ChunkGenerated':
      return base(
        event.name,
        event.payload.tick,
        null,
        `Chunk ${event.payload.key} généré en ${event.payload.generationMs} ms ` +
          `(${event.payload.resourceCount} ressources)`,
      );
    case 'ChunkLoaded':
      return base(event.name, event.payload.tick, null, `Chunk ${event.payload.key} actif`);
    case 'ChunkUnloaded':
      return base(event.name, event.payload.tick, null, `Chunk ${event.payload.key} libéré`);
    case 'WaterBodyCreated':
      return base(
        event.name,
        event.payload.tick,
        null,
        `${event.payload.kind} ${event.payload.id} — ${event.payload.areaM2} m², ` +
          `${event.payload.meanDepthM} m de profondeur moyenne`,
      );
    case 'ActionStarted':
      return base(
        event.name,
        event.payload.tick,
        event.payload.entity,
        `${event.payload.action} : ${event.payload.reason}`,
      );
    case 'ActionCompleted':
      return base(
        event.name,
        event.payload.tick,
        event.payload.entity,
        `${event.payload.action} terminée`,
      );
    case 'ActionFailed':
      return base(
        event.name,
        event.payload.tick,
        event.payload.entity,
        `${event.payload.action} échouée — ${event.payload.cause}`,
      );
    default: {
      const exhaustive: never = event;
      throw new Error(`Unhandled simulation event: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function base(
  type: string,
  tick: number,
  entityId: number | null,
  message: string,
): UndatedNetworkEvent {
  return { type, tick, entityId, message };
}
