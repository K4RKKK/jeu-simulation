export interface BenchmarkSample {
  averageTickMs: number;
  tickMsP95: number;
  tickMsP99: number;
  tickMsMax: number;
  systems: readonly { name: string; averageMs: number }[];
}

export interface BenchmarkSummary extends BenchmarkSample {
  minAverageTickMs: number;
  maxAverageTickMs: number;
}

/** Médiane déterministe ; pour un nombre pair, moyenne des deux valeurs centrales. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function summarizeBenchmarkSamples(samples: readonly BenchmarkSample[]): BenchmarkSummary {
  const systemNames = new Set(samples.flatMap((sample) => sample.systems.map(({ name }) => name)));
  const systems = [...systemNames]
    .map((name) => ({
      name,
      averageMs: median(
        samples.map(
          (sample) => sample.systems.find((system) => system.name === name)?.averageMs ?? 0,
        ),
      ),
    }))
    .sort((a, b) => b.averageMs - a.averageMs);
  const averages = samples.map(({ averageTickMs }) => averageTickMs);

  return {
    averageTickMs: median(averages),
    tickMsP95: median(samples.map(({ tickMsP95 }) => tickMsP95)),
    tickMsP99: median(samples.map(({ tickMsP99 }) => tickMsP99)),
    tickMsMax: median(samples.map(({ tickMsMax }) => tickMsMax)),
    systems,
    minAverageTickMs: averages.length === 0 ? 0 : Math.min(...averages),
    maxAverageTickMs: averages.length === 0 ? 0 : Math.max(...averages),
  };
}
