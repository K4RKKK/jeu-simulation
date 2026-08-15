import type { EventBus, Unsubscribe } from './eventBus.js';
import type { SimulationEvent, SimulationEventName } from './events.js';

/**
 * Événements qui racontent durablement le monde au joueur.
 *
 * Le bus contient aussi beaucoup de trafic technique (chunks, actions courantes). Le
 * persister en entier ferait grossir les sauvegardes sans améliorer la Chronique. Cette
 * sélection explicite est donc le contrat éditorial du journal serveur ; les futurs
 * événements majeurs (premier feu, scission d'un groupe…) seront ajoutés ici lorsqu'ils
 * existeront réellement dans `SimulationEventMap`.
 */
const HISTORICAL_EVENT_NAMES: ReadonlySet<SimulationEventName> = new Set([
  'SimulationStarted',
  'HumanBorn',
  'HumanDied',
]);

export const DEFAULT_WORLD_HISTORY_CAPACITY = 2_000;

/** Historique serveur borné, indépendant de la présence d'un navigateur. */
export class WorldHistory {
  private entries: SimulationEvent[] = [];
  private readonly unsubscribe: Unsubscribe;

  constructor(
    bus: EventBus,
    private readonly capacity = DEFAULT_WORLD_HISTORY_CAPACITY,
  ) {
    this.unsubscribe = bus.onAny((name, payload) => {
      if (!HISTORICAL_EVENT_NAMES.has(name)) return;
      if (this.entries.length >= this.capacity) this.entries.shift();
      // Les payloads actuels sont des données pures. La copie empêche néanmoins un
      // appelant de muter rétroactivement une entrée déjà devenue historique.
      this.entries.push(JSON.parse(JSON.stringify({ name, payload })) as SimulationEvent);
    });
  }

  values(): readonly SimulationEvent[] {
    return this.entries;
  }

  getState(): SimulationEvent[] {
    return JSON.parse(JSON.stringify(this.entries)) as SimulationEvent[];
  }

  setState(entries: readonly SimulationEvent[]): void {
    this.entries = (JSON.parse(JSON.stringify(entries)) as SimulationEvent[]).slice(-this.capacity);
  }

  dispose(): void {
    this.unsubscribe();
    this.entries = [];
  }
}
