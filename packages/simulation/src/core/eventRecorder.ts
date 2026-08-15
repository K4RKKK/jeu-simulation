import type { EventBus, Unsubscribe } from './eventBus.js';
import type { SimulationEvent, SimulationEventName } from './events.js';

/**
 * Tampon borné des derniers événements émis.
 *
 * Sert de point de collecte unique pour : la diffusion réseau (le serveur vide le tampon
 * à chaque tick réseau), les statistiques de fin de run headless, et plus tard
 * l'historique du monde. Borné volontairement : un monde qui tourne 24 h ne doit pas
 * accumuler indéfiniment en mémoire.
 */
export class EventRecorder {
  private buffer: SimulationEvent[] = [];
  private readonly counts = new Map<SimulationEventName, number>();
  private total = 0;
  private dropped = 0;
  private readonly unsubscribe: Unsubscribe;

  constructor(
    bus: EventBus,
    private readonly capacity = 512,
  ) {
    this.unsubscribe = bus.onAny((name, payload) => {
      this.total++;
      this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
      if (this.buffer.length >= this.capacity) {
        this.buffer.shift();
        this.dropped++;
      }
      this.buffer.push({ name, payload } as SimulationEvent);
    });
  }

  /** Récupère et vide le tampon. */
  drain(): SimulationEvent[] {
    if (this.buffer.length === 0) return [];
    const events = this.buffer;
    this.buffer = [];
    return events;
  }

  peek(): readonly SimulationEvent[] {
    return this.buffer;
  }

  get totalCount(): number {
    return this.total;
  }

  /** Nombre d'événements écartés faute de place — un indicateur de santé, pas un détail. */
  get droppedCount(): number {
    return this.dropped;
  }

  countsByName(): Record<string, number> {
    return Object.fromEntries([...this.counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  dispose(): void {
    this.unsubscribe();
    this.buffer = [];
  }
}
