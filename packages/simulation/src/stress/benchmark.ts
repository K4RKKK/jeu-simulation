import {
  checkPerformanceBudgets,
  DEFAULT_PERFORMANCE_BUDGETS,
} from '../config/performanceBudgets.js';
import { Simulation } from '../simulation.js';
import { summarizeBenchmarkSamples, type BenchmarkSample } from './benchmarkStats.js';
import { concludeStress, parseNumericFlags } from './stressArgs.js';

/**
 * Benchmark reproductible de la boucle complète : chaque échantillon utilise une
 * simulation fraîche avec la même seed, s'échauffe, remet ses métriques à zéro, puis
 * mesure. La médiane absorbe les pauses ponctuelles du système d'exploitation.
 */
const DEFAULTS = { ticks: 500, warmupTicks: 150, samples: 5, population: 500 };

function main(argv: readonly string[]): number {
  let options;
  try {
    options = parseNumericFlags(argv, DEFAULTS);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (options.help) {
    console.log(
      'stress:benchmark — [--ticks n] [--warmupTicks n] [--samples n] [--population n]\n' +
        `  défauts: ticks=${DEFAULTS.ticks} warmupTicks=${DEFAULTS.warmupTicks} samples=${DEFAULTS.samples} population=${DEFAULTS.population}`,
    );
    return 0;
  }

  const ticks = Math.max(1, Math.round(options.ticks));
  const warmupTicks = Math.max(0, Math.round(options.warmupTicks));
  const sampleCount = Math.max(1, Math.round(options.samples));
  const population = Math.max(0, Math.round(options.population));
  const samples: BenchmarkSample[] = [];

  for (let index = 0; index < sampleCount; index++) {
    const simulation = new Simulation({
      seed: 'stress-benchmark',
      population,
      config: { time: { gameSecondsPerTick: 1 } },
    });
    simulation.start();
    simulation.step(warmupTicks);
    simulation.metrics.reset();
    simulation.step(ticks);
    const stats = simulation.stats();
    samples.push({
      averageTickMs: stats.averageTickMs,
      tickMsP95: stats.tickMsP95,
      tickMsP99: stats.tickMsP99,
      tickMsMax: stats.tickMsMax,
      systems: stats.systems.map(({ name, averageMs }) => ({ name, averageMs })),
    });
    simulation.dispose();
    console.log(
      `  échantillon ${index + 1}/${sampleCount}: moyenne=${stats.averageTickMs.toFixed(3)}ms p99=${stats.tickMsP99.toFixed(3)}ms`,
    );
  }

  const summary = summarizeBenchmarkSamples(samples);
  const violations = checkPerformanceBudgets({
    simulationTickMsAvg: summary.averageTickMs,
    simulationTickMsP99: summary.tickMsP99,
  });
  const anomalies = violations.map(
    ({ metric, measured, budget }) =>
      `budget dépassé sur la médiane: ${metric} = ${measured.toFixed(3)} > ${budget}`,
  );

  return concludeStress('stress:benchmark', { anomalies }, [
    `population=${population} échantillons=${sampleCount} échauffement=${warmupTicks} ticks mesure=${ticks}`,
    `médiane tick=${summary.averageTickMs.toFixed(3)}ms (min=${summary.minAverageTickMs.toFixed(3)}, max=${summary.maxAverageTickMs.toFixed(3)})`,
    `médianes p95=${summary.tickMsP95.toFixed(3)} p99=${summary.tickMsP99.toFixed(3)} max=${summary.tickMsMax.toFixed(3)}`,
    `budgets: moyenne≤${DEFAULT_PERFORMANCE_BUDGETS.simulationTickMsAvg}ms p99≤${DEFAULT_PERFORMANCE_BUDGETS.simulationTickMsP99}ms`,
    `systèmes: ${summary.systems
      .slice(0, 5)
      .map(({ name, averageMs }) => `${name}=${averageMs.toFixed(3)}ms`)
      .join('  ')}`,
  ]);
}

process.exitCode = main(process.argv.slice(2));
