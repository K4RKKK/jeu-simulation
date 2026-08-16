import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashWorldState } from '../debug/stateHash.js';
import { FilePersistenceAdapter } from '../persistence/fileAdapter.js';
import { createSaveEnvelope } from '../persistence/persistenceAdapter.js';
import { Simulation } from '../simulation.js';
import { concludeStress, heapUsedMb, parseNumericFlags } from './stressArgs.js';

/**
 * `pnpm stress:persistence` — cycles save/load répétitifs.
 *
 * Enchaîne des cycles « simule N ticks → sauvegarde → charge dans une simulation
 * fraîche → vérifie le hash → repart du monde chargé ». Détecte :
 * - divergence de hash immédiatement après un chargement (bug de sérialisation) ;
 * - exceptions à la sauvegarde ou au chargement ;
 * - fuite mémoire au fil des cycles (le tas ne doit pas croître sans borne).
 *
 * Cahier des charges : sauvegarde/chargement répétitif. Par défaut 30 cycles de 500
 * ticks (~15 000 ticks au total) — monter `--cycles` pour une charge plus longue.
 */
const DEFAULTS = { cycles: 30, ticksPerCycle: 500, population: 10 };

async function main(argv: readonly string[]): Promise<number> {
  let options;
  try {
    options = parseNumericFlags(argv, DEFAULTS);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (options.help) {
    console.log(
      'stress:persistence — [--cycles n] [--ticksPerCycle n] [--population n]\n' +
        `  défauts: cycles=${DEFAULTS.cycles} ticksPerCycle=${DEFAULTS.ticksPerCycle} population=${DEFAULTS.population}`,
    );
    return 0;
  }

  const dir = await mkdtemp(join(tmpdir(), 'civ-stress-persistence-'));
  const adapter = new FilePersistenceAdapter(dir);
  const anomalies: string[] = [];
  const seed = 'stress-persistence';
  const heapSamples: number[] = [heapUsedMb()];
  const startedAt = performance.now();

  let current = new Simulation({
    seed,
    population: options.population,
    config: { time: { gameSecondsPerTick: 1 } },
  });
  current.start();

  try {
    for (let cycle = 0; cycle < options.cycles; cycle++) {
      current.step(options.ticksPerCycle);
      const hashBeforeSave = hashWorldState(current);

      try {
        // Horodatage fixe et arbitraire : ce stress test ne mesure jamais le temps
        // mural (CLAUDE.md règle 4), la valeur exacte n'a aucune importance ici.
        const envelope = createSaveEnvelope(current, 'stress-slot', '1970-01-01T00:00:00.000Z');
        await adapter.save('stress-slot', envelope);
      } catch (error) {
        anomalies.push(`cycle ${cycle}: échec save() — ${String(error)}`);
        break;
      }
      current.dispose();

      let loaded;
      try {
        loaded = await adapter.load('stress-slot');
      } catch (error) {
        anomalies.push(`cycle ${cycle}: échec load() — ${String(error)}`);
        break;
      }
      if (loaded === null) {
        anomalies.push(`cycle ${cycle}: sauvegarde introuvable après save()`);
        break;
      }

      const next = new Simulation({
        seed,
        population: options.population,
        config: { time: { gameSecondsPerTick: 1 } },
        spawnInitialPopulation: false,
      });
      try {
        next.restoreSnapshot(loaded.snapshot);
      } catch (error) {
        anomalies.push(`cycle ${cycle}: échec restoreSnapshot() — ${String(error)}`);
        current = next;
        break;
      }

      const hashAfterLoad = hashWorldState(next);
      if (hashAfterLoad !== hashBeforeSave) {
        anomalies.push(
          `cycle ${cycle}: hash divergent après chargement (avant=${hashBeforeSave}, après=${hashAfterLoad})`,
        );
      }

      current = next;
      current.start();
      if (cycle % 5 === 0) heapSamples.push(heapUsedMb());
    }
  } finally {
    current.dispose();
    await rm(dir, { recursive: true, force: true });
  }

  heapSamples.push(heapUsedMb());
  const elapsedMs = performance.now() - startedAt;
  const heapGrowth = (heapSamples.at(-1) ?? 0) - (heapSamples[0] ?? 0);

  return concludeStress('stress:persistence', { anomalies }, [
    `cycles=${options.cycles} ticks/cycle=${options.ticksPerCycle} total_ticks=${options.cycles * options.ticksPerCycle}`,
    `durée: ${(elapsedMs / 1000).toFixed(1)} s`,
    `tas JS: ${heapSamples[0]} Mo → ${heapSamples.at(-1)} Mo (Δ ${heapGrowth >= 0 ? '+' : ''}${heapGrowth.toFixed(1)} Mo)`,
  ]);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
