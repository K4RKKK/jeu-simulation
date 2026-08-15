import type { SchedulerConfig, SystemFrequency } from '../config/simulationConfig.js';
import type { SimulationMetrics } from './metrics.js';
import type { SimulationSystem, SystemUpdateContext } from './system.js';

interface ScheduledSystem {
  readonly system: SimulationSystem;
  readonly interval: number;
  /** Décalage de phase : évite que tous les systèmes lents tombent sur le même tick. */
  readonly phase: number;
  lastRunTick: number;
  hasRun: boolean;
}

/**
 * Ordonnanceur multi-fréquences (cahier des charges §13).
 *
 * Deux idées :
 *
 * 1. **Fréquences** : un système de déplacement doit tourner à chaque tick, une maladie
 *    non. Chaque système déclare sa fréquence, traduite en intervalle par la config.
 * 2. **Décalage de phase** : si tous les systèmes `slow` s'exécutaient au tick 0, 25, 50…
 *    on obtiendrait un pic de charge périodique. Chaque système reçoit un décalage
 *    déterministe pour étaler le coût.
 */
export class SimulationScheduler {
  private readonly scheduled: ScheduledSystem[] = [];
  private readonly countByFrequency = new Map<SystemFrequency, number>();

  constructor(private readonly config: SchedulerConfig) {}

  register(system: SimulationSystem): void {
    if (this.scheduled.some((entry) => entry.system.name === system.name)) {
      throw new Error(`System "${system.name}" is already registered`);
    }
    const interval = this.intervalFor(system.frequency);
    const rank = this.countByFrequency.get(system.frequency) ?? 0;
    this.countByFrequency.set(system.frequency, rank + 1);

    this.scheduled.push({
      system,
      interval,
      phase: interval === 1 ? 0 : rank % interval,
      lastRunTick: 0,
      hasRun: false,
    });
  }

  get systems(): readonly SimulationSystem[] {
    return this.scheduled.map((entry) => entry.system);
  }

  intervalFor(frequency: SystemFrequency): number {
    const interval = this.config.intervals[frequency];
    if (!Number.isInteger(interval) || interval < 1) {
      throw new Error(`Invalid scheduler interval for frequency "${frequency}": ${interval}`);
    }
    return interval;
  }

  /** `true` si le système tourne à ce tick — exposé pour les tests et le debug. */
  isDue(systemName: string, tick: number): boolean {
    const entry = this.scheduled.find((candidate) => candidate.system.name === systemName);
    if (!entry) return false;
    return this.due(entry, tick);
  }

  initializeAll(makeContext: (deltaGameSeconds: number) => SystemUpdateContext): void {
    for (const entry of this.scheduled) {
      entry.system.initialize?.(makeContext(0));
    }
  }

  /**
   * Exécute les systèmes dus au tick courant.
   * `makeContext` reçoit le delta propre au système, calculé depuis sa dernière exécution.
   */
  run(
    tick: number,
    gameSecondsPerTick: number,
    makeContext: (deltaGameSeconds: number) => SystemUpdateContext,
    metrics?: SimulationMetrics,
  ): void {
    for (const entry of this.scheduled) {
      if (!this.due(entry, tick)) continue;

      const elapsedTicks = entry.hasRun ? tick - entry.lastRunTick : entry.interval;
      const context = makeContext(elapsedTicks * gameSecondsPerTick);

      metrics?.beginSystem();
      entry.system.update(context);
      metrics?.endSystem(entry.system.name);

      entry.lastRunTick = tick;
      entry.hasRun = true;
    }
  }

  dispose(): void {
    for (const entry of this.scheduled) entry.system.dispose?.();
    this.scheduled.length = 0;
    this.countByFrequency.clear();
  }

  private due(entry: ScheduledSystem, tick: number): boolean {
    return tick % entry.interval === entry.phase;
  }

  /**
   * État sérialisable — nécessaire pour la persistance. Sans ces valeurs, un système
   * chargé depuis une sauvegarde pourrait recevoir au premier tick un delta erroné
   * (recalcul de `elapsedTicks` à partir de `lastRunTick` par défaut = 0), ce qui
   * fausserait métabolisme et perceptions.
   */
  getState(): SchedulerState {
    return {
      systems: this.scheduled.map((entry) => ({
        name: entry.system.name,
        lastRunTick: entry.lastRunTick,
        hasRun: entry.hasRun,
      })),
    };
  }

  setState(state: SchedulerState): void {
    const byName = new Map(state.systems.map((entry) => [entry.name, entry]));
    for (const entry of this.scheduled) {
      const saved = byName.get(entry.system.name);
      if (!saved) continue;
      entry.lastRunTick = saved.lastRunTick;
      entry.hasRun = saved.hasRun;
    }
  }
}

export interface SchedulerState {
  systems: { name: string; lastRunTick: number; hasRun: boolean }[];
}
