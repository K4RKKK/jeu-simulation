import type { SimulationConfig, SystemFrequency } from '../config/simulationConfig.js';
import type { World } from '../world/world.js';
import type { SimulationClock } from './clock.js';
import type { EntityManager } from './entityManager.js';
import type { EventBus } from './eventBus.js';
import type { WorldRng } from './rng.js';

/**
 * Tout ce qu'un système a le droit de connaître.
 *
 * Aucun système n'accède à un état global : il reçoit ce contexte, ce qui le rend
 * testable isolément (CLAUDE.md règle 8).
 */
export interface SystemUpdateContext {
  readonly world: World;
  readonly entities: EntityManager;
  readonly events: EventBus;
  readonly rng: WorldRng;
  readonly clock: SimulationClock;
  readonly config: SimulationConfig;
  /** Tick courant (raccourci vers `clock.currentTick`). */
  readonly tick: number;
  /**
   * Secondes de jeu écoulées **depuis la dernière exécution de ce système**.
   * Un système lent tourne moins souvent mais intègre un pas plus grand : c'est ce champ,
   * et non `gameSecondsPerTick`, qui doit servir aux calculs continus.
   */
  readonly deltaGameSeconds: number;
}

export interface SimulationSystem {
  readonly name: string;
  readonly frequency: SystemFrequency;
  update(context: SystemUpdateContext): void;
  /** Appelé une fois à l'enregistrement, avant le premier tick. */
  initialize?(context: SystemUpdateContext): void;
  dispose?(): void;
}
