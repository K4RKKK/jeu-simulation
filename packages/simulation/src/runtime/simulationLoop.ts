import type { Simulation } from '../simulation.js';

export interface SimulationLoopOptions {
  /**
   * Nombre maximum de ticks rattrapés en une seule itération. Sans cette borne, une pause
   * du processus (GC long, machine en veille) provoquerait une « spirale de la mort » :
   * la boucle tenterait de rattraper des heures de retard en une fois.
   */
  maxTicksPerIteration?: number;
  /** Appelé après chaque salve de ticks, avec le nombre de ticks exécutés. */
  onTicked?: (ticksExecuted: number) => void;
  onError?: (error: unknown) => void;
}

/**
 * Pilote temps réel de la simulation.
 *
 * C'est le **seul** endroit du package qui observe une horloge réelle (avec les métriques
 * et le CLI) : la simulation elle-même ne connaît que ses ticks. Changer `timeScale` ne
 * change donc pas la physique du monde, seulement la vitesse à laquelle il est observé.
 */
export class SimulationLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastRealTimeMs = 0;
  private tickAccumulator = 0;
  private readonly maxTicksPerIteration: number;

  constructor(
    private readonly simulation: Simulation,
    private readonly options: SimulationLoopOptions = {},
  ) {
    this.maxTicksPerIteration = options.maxTicksPerIteration ?? 500;
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.simulation.start();
    this.lastRealTimeMs = performance.now();
    this.tickAccumulator = 0;
    this.schedule();
  }

  stop(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    // On vise un réveil légèrement plus fréquent que le tick rate : l'accumulateur absorbe
    // la gigue de setTimeout, qui n'est jamais précis à la milliseconde.
    const intervalMs = Math.max(1, Math.floor(1000 / this.simulation.config.time.tickRateHz / 2));
    this.timer = setTimeout(() => this.iterate(intervalMs), intervalMs);
  }

  private iterate(intervalMs: number): void {
    const now = performance.now();
    const elapsedSeconds = (now - this.lastRealTimeMs) / 1000;
    this.lastRealTimeMs = now;

    try {
      if (!this.simulation.clock.paused) {
        const { tickRateHz } = this.simulation.config.time;
        this.tickAccumulator += elapsedSeconds * tickRateHz * this.simulation.clock.timeScale;

        let ticks = Math.floor(this.tickAccumulator);
        if (ticks > this.maxTicksPerIteration) {
          ticks = this.maxTicksPerIteration;
          this.tickAccumulator = 0;
        } else {
          this.tickAccumulator -= ticks;
        }

        for (let i = 0; i < ticks; i++) this.simulation.tick();
        if (ticks > 0) this.options.onTicked?.(ticks);
      } else {
        // En pause, on ne laisse pas le retard s'accumuler : reprendre ne doit pas
        // déclencher un rattrapage massif.
        this.tickAccumulator = 0;
      }
    } catch (error) {
      if (this.options.onError) this.options.onError(error);
      else throw error;
    }

    if (this.timer !== null) {
      this.timer = setTimeout(() => this.iterate(intervalMs), intervalMs);
    }
  }
}
