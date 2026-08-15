import { Activity, Human, Movement, Needs, Transform } from '../components/index.js';
import {
  checkPerformanceBudgets,
  DEFAULT_PERFORMANCE_BUDGETS,
} from '../config/performanceBudgets.js';
import { hashWorldState } from '../debug/stateHash.js';
import { Simulation } from '../simulation.js';
import { concludeStress, heapUsedMb, parseNumericFlags } from './stressArgs.js';

/**
 * `pnpm stress:simulation` — un long run headless, surveillé.
 *
 * Fait tourner un monde pendant un grand nombre de ticks et vérifie, à intervalles
 * réguliers, que chaque humain reste dans un état physiquement sain :
 * - position/vitesse/orientation finies (`NaN`/`Infinity` seraient un bug de calcul
 *   silencieux — une position `NaN` ne plante rien, elle rend juste l'humain invisible
 *   et immobile pour toujours) ;
 * - besoins (hydratation/faim/énergie) dans `[0, 1]` — une valeur hors bornes indique
 *   un système qui intègre sans jamais clamp ;
 * - le nombre d'entités humaines ne change pas de façon inattendue (aucune naissance/
 *   mort n'existe encore dans le moteur : un changement serait un bug de comptage).
 *
 * Cahier des charges : 1 000 000 ticks. Par défaut ce script en fait beaucoup moins
 * pour rester praticable en usage courant — monter `--ticks 1000000` pour la charge
 * complète (attendu : plusieurs dizaines de minutes selon la machine).
 */
const DEFAULTS = { ticks: 100_000, population: 15, checkpointEvery: 5_000 };

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
      'stress:simulation — [--ticks n] [--population n] [--checkpointEvery n]\n' +
        `  défauts: ticks=${DEFAULTS.ticks} population=${DEFAULTS.population} checkpointEvery=${DEFAULTS.checkpointEvery}`,
    );
    return 0;
  }

  const simulation = new Simulation({
    seed: 'stress-simulation',
    population: options.population,
    config: { time: { gameSecondsPerTick: 1 } },
  });
  simulation.start();

  const anomalies: string[] = [];
  const heapSamples: number[] = [heapUsedMb()];
  const initialHumanCount = simulation.humanCount;
  const startedAt = performance.now();
  let checkpoints = 0;

  const checkpointTicks = Math.max(1, Math.round(options.checkpointEvery));
  let done = 0;
  while (done < options.ticks) {
    const step = Math.min(checkpointTicks, options.ticks - done);
    simulation.step(step);
    done += step;
    checkpoints++;

    if (simulation.humanCount !== initialHumanCount) {
      anomalies.push(
        `tick ${simulation.clock.currentTick}: population changée (${initialHumanCount} → ${simulation.humanCount}) — aucune naissance/mort n'est censée exister`,
      );
    }

    for (const entity of simulation.entities.query(Human)) {
      const transform = simulation.entities.getComponentOrThrow(entity, Transform);
      const movement = simulation.entities.getComponentOrThrow(entity, Movement);
      const activity = simulation.entities.getComponentOrThrow(entity, Activity);
      const needs = simulation.entities.getComponent(entity, Needs);

      if (![transform.x, transform.y, transform.z, transform.yaw].every(Number.isFinite)) {
        anomalies.push(`tick ${simulation.clock.currentTick} entité ${entity}: Transform non fini`);
      }
      if (!Number.isFinite(movement.currentSpeedMps) || movement.currentSpeedMps < 0) {
        anomalies.push(
          `tick ${simulation.clock.currentTick} entité ${entity}: vitesse invalide (${movement.currentSpeedMps})`,
        );
      }
      if (needs) {
        for (const [name, value] of Object.entries({
          hydration: needs.hydration,
          hunger: needs.hunger,
          energy: needs.energy,
        })) {
          if (!Number.isFinite(value) || value < -0.001 || value > 1.001) {
            anomalies.push(
              `tick ${simulation.clock.currentTick} entité ${entity}: besoin ${name} hors bornes (${value})`,
            );
          }
        }
      }
      if (activity.reason.length === 0) {
        anomalies.push(
          `tick ${simulation.clock.currentTick} entité ${entity}: activité sans raison (règle 12)`,
        );
      }
    }

    heapSamples.push(heapUsedMb());
    if (checkpoints % 10 === 0 || done >= options.ticks) {
      const elapsed = (performance.now() - startedAt) / 1000;
      process.stdout.write(
        `\r  tick ${done.toLocaleString('fr-FR')}/${options.ticks.toLocaleString('fr-FR')} — ` +
          `${(done / elapsed).toFixed(0)} ticks/s — tas ${heapUsedMb()} Mo — ` +
          `${anomalies.length} anomalie(s)   `,
      );
    }

    // Arrêt anticipé si les anomalies s'accumulent : inutile de simuler des heures pour
    // confirmer un bug déjà démontré des centaines de fois.
    if (anomalies.length > 500) {
      anomalies.push(
        `arrêt anticipé après ${anomalies.length} anomalies (tick ${simulation.clock.currentTick})`,
      );
      break;
    }
  }
  process.stdout.write('\n');

  const finalHash = hashWorldState(simulation);
  const stats = simulation.stats();
  const elapsedMs = performance.now() - startedAt;
  const heapStart = heapSamples[0] ?? 0;
  const heapEnd = heapSamples.at(-1) ?? 0;
  simulation.dispose();

  const violations = checkPerformanceBudgets({
    simulationTickMsAvg: stats.averageTickMs,
    simulationTickMsP99: stats.tickMsP99,
  });
  for (const v of violations) {
    anomalies.push(
      `budget dépassé: ${v.metric} = ${v.measured.toFixed(3)} > ${v.budget} (voir performanceBudgets.ts)`,
    );
  }

  return concludeStress('stress:simulation', { anomalies }, [
    `ticks=${simulation.clock.currentTick} population=${options.population} checkpoints=${checkpoints}`,
    `durée: ${(elapsedMs / 1000).toFixed(1)} s (${(simulation.clock.currentTick / (elapsedMs / 1000)).toFixed(0)} ticks/s)`,
    `tick moyen=${stats.averageTickMs.toFixed(3)} ms  p95=${stats.tickMsP95.toFixed(3)}  p99=${stats.tickMsP99.toFixed(3)}  max=${stats.tickMsMax.toFixed(3)}`,
    `budgets: tickAvg≤${DEFAULT_PERFORMANCE_BUDGETS.simulationTickMsAvg}ms tickP99≤${DEFAULT_PERFORMANCE_BUDGETS.simulationTickMsP99}ms`,
    `systèmes les plus coûteux: ${stats.systems
      .slice(0, 5)
      .map((system) => `${system.name}=${system.averageMs.toFixed(3)}ms/${system.runs}`)
      .join('  ')}`,
    `tas JS: ${heapStart} Mo → ${heapEnd} Mo (Δ ${(heapEnd - heapStart >= 0 ? '+' : '') + (heapEnd - heapStart).toFixed(1)} Mo)`,
    `hash final: ${finalHash}`,
  ]);
}

process.exitCode = main(process.argv.slice(2));
