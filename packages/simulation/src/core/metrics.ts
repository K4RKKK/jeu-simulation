/**
 * Instrumentation du moteur (cahier des charges §63 : « ne jamais optimiser au hasard »).
 *
 * C'est le seul module du cœur autorisé à lire une horloge réelle : mesurer une durée
 * d'exécution n'est pas une règle de simulation et n'influence jamais l'état du monde.
 */

const WINDOW_SIZE = 120;

/** Moyenne glissante à fenêtre fixe, sans allocation après amorçage. */
class RollingAverage {
  private readonly samples = new Float64Array(WINDOW_SIZE);
  private index = 0;
  private filled = 0;
  private sum = 0;
  private lastValue = 0;

  push(value: number): void {
    // Les emplacements non encore écrits valent 0 : soustraire l'ancien échantillon est
    // donc correct dès le premier passage.
    const previous = this.samples[this.index] ?? 0;
    this.sum += value - previous;
    this.samples[this.index] = value;
    this.index = (this.index + 1) % WINDOW_SIZE;
    if (this.filled < WINDOW_SIZE) this.filled++;
    this.lastValue = value;
  }

  get average(): number {
    return this.filled === 0 ? 0 : this.sum / this.filled;
  }

  get last(): number {
    return this.lastValue;
  }

  reset(): void {
    this.samples.fill(0);
    this.index = 0;
    this.filled = 0;
    this.sum = 0;
    this.lastValue = 0;
  }

  /**
   * Percentiles sur la fenêtre remplie. Coûte un tri de `filled` éléments (≤120) : trop
   * cher pour être fait à chaque tick, d'où son appel réservé à `snapshot()` — lu
   * périodiquement (diffusion réseau), jamais dans la boucle chaude.
   */
  percentiles(): { p50: number; p95: number; p99: number; max: number } {
    if (this.filled === 0) return { p50: 0, p95: 0, p99: 0, max: 0 };
    const sorted = Array.from(this.samples.slice(0, this.filled)).sort((a, b) => a - b);
    const at = (fraction: number): number =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
    return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1] ?? 0 };
  }
}

export interface SystemMetricsSnapshot {
  name: string;
  averageMs: number;
  lastMs: number;
  runs: number;
}

export interface MetricsSnapshot {
  tick: number;
  averageTickMs: number;
  lastTickMs: number;
  /** Percentiles de durée de tick (ms) sur la fenêtre glissante — pas seulement la moyenne. */
  tickMsP50: number;
  tickMsP95: number;
  tickMsP99: number;
  tickMsMax: number;
  /** Ticks réellement exécutés par seconde réelle (mesuré, pas configuré). */
  ticksPerSecond: number;
  systems: SystemMetricsSnapshot[];
}

export class SimulationMetrics {
  private readonly tickDuration = new RollingAverage();
  private readonly systemDurations = new Map<string, RollingAverage>();
  private readonly systemRuns = new Map<string, number>();

  private tickCountSinceSample = 0;
  private lastRateSampleMs = performance.now();
  private measuredTicksPerSecond = 0;

  private tickStartedAt = 0;
  private systemStartedAt = 0;

  beginTick(): void {
    this.tickStartedAt = performance.now();
  }

  endTick(): void {
    this.tickDuration.push(performance.now() - this.tickStartedAt);
    this.tickCountSinceSample++;

    const now = performance.now();
    const elapsed = now - this.lastRateSampleMs;
    if (elapsed >= 1000) {
      this.measuredTicksPerSecond = (this.tickCountSinceSample * 1000) / elapsed;
      this.tickCountSinceSample = 0;
      this.lastRateSampleMs = now;
    }
  }

  beginSystem(): void {
    this.systemStartedAt = performance.now();
  }

  endSystem(name: string): void {
    const duration = performance.now() - this.systemStartedAt;
    let average = this.systemDurations.get(name);
    if (!average) {
      average = new RollingAverage();
      this.systemDurations.set(name, average);
    }
    average.push(duration);
    this.systemRuns.set(name, (this.systemRuns.get(name) ?? 0) + 1);
  }

  snapshot(tick: number): MetricsSnapshot {
    const systems: SystemMetricsSnapshot[] = [];
    for (const [name, average] of this.systemDurations) {
      systems.push({
        name,
        averageMs: round3(average.average),
        lastMs: round3(average.last),
        runs: this.systemRuns.get(name) ?? 0,
      });
    }
    systems.sort((a, b) => b.averageMs - a.averageMs);
    const tickPercentiles = this.tickDuration.percentiles();

    return {
      tick,
      averageTickMs: round3(this.tickDuration.average),
      lastTickMs: round3(this.tickDuration.last),
      tickMsP50: round3(tickPercentiles.p50),
      tickMsP95: round3(tickPercentiles.p95),
      tickMsP99: round3(tickPercentiles.p99),
      tickMsMax: round3(tickPercentiles.max),
      ticksPerSecond: Math.round(this.measuredTicksPerSecond * 10) / 10,
      systems,
    };
  }

  reset(): void {
    this.tickDuration.reset();
    this.systemDurations.clear();
    this.systemRuns.clear();
    this.tickCountSinceSample = 0;
    this.lastRateSampleMs = performance.now();
    this.measuredTicksPerSecond = 0;
    this.tickStartedAt = 0;
    this.systemStartedAt = 0;
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
