import type { SimulationEventMap, SimulationEventName } from './events.js';

export type EventHandler<T> = (payload: T) => void;
export type AnyEventHandler = <K extends SimulationEventName>(
  name: K,
  payload: SimulationEventMap[K],
) => void;
export type Unsubscribe = () => void;

/**
 * Bus d'événements typé du moteur.
 *
 * Contraintes qui expliquent l'implémentation :
 * - Un handler peut s'abonner/désabonner pendant un `emit` : la liste est copiée avant
 *   diffusion, sinon un désabonnement en cours de boucle sauterait un abonné.
 * - Une exception dans un abonné ne doit pas interrompre la simulation : elle est isolée
 *   et signalée, jamais avalée silencieusement.
 */
export class EventBus {
  private readonly handlers = new Map<SimulationEventName, Set<EventHandler<never>>>();
  private readonly anyHandlers = new Set<AnyEventHandler>();
  private errorReporter: (error: unknown, eventName: string) => void = (error, eventName) => {
    console.error(`[EventBus] handler for "${eventName}" threw:`, error);
  };

  on<K extends SimulationEventName>(
    name: K,
    handler: EventHandler<SimulationEventMap[K]>,
  ): Unsubscribe {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler as EventHandler<never>);
    return () => this.off(name, handler);
  }

  /** Abonnement à un seul déclenchement. */
  once<K extends SimulationEventName>(
    name: K,
    handler: EventHandler<SimulationEventMap[K]>,
  ): Unsubscribe {
    const unsubscribe = this.on(name, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  off<K extends SimulationEventName>(
    name: K,
    handler: EventHandler<SimulationEventMap[K]>,
  ): boolean {
    const set = this.handlers.get(name);
    if (!set) return false;
    const removed = set.delete(handler as EventHandler<never>);
    if (set.size === 0) this.handlers.delete(name);
    return removed;
  }

  /** Écoute tous les événements — base de l'historique, du réseau et du debug. */
  onAny(handler: AnyEventHandler): Unsubscribe {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  emit<K extends SimulationEventName>(name: K, payload: SimulationEventMap[K]): void {
    const set = this.handlers.get(name);
    if (set && set.size > 0) {
      for (const handler of [...set]) {
        try {
          (handler as EventHandler<SimulationEventMap[K]>)(payload);
        } catch (error) {
          this.errorReporter(error, name);
        }
      }
    }
    if (this.anyHandlers.size > 0) {
      for (const handler of [...this.anyHandlers]) {
        try {
          handler(name, payload);
        } catch (error) {
          this.errorReporter(error, name);
        }
      }
    }
  }

  listenerCount(name?: SimulationEventName): number {
    if (name === undefined) {
      let total = this.anyHandlers.size;
      for (const set of this.handlers.values()) total += set.size;
      return total;
    }
    return this.handlers.get(name)?.size ?? 0;
  }

  setErrorReporter(reporter: (error: unknown, eventName: string) => void): void {
    this.errorReporter = reporter;
  }

  clear(): void {
    this.handlers.clear();
    this.anyHandlers.clear();
  }
}
