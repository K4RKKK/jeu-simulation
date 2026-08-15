import { describeHuman } from '../debug/describeHuman.js';
import { hashWorldState } from '../debug/stateHash.js';
import { FilePersistenceAdapter } from '../persistence/fileAdapter.js';
import { createSaveEnvelope, type SaveEnvelope } from '../persistence/persistenceAdapter.js';
import { Simulation } from '../simulation.js';
import { CLI_HELP, parseCliArgs } from './args.js';

/**
 * Exécution headless du moteur (CLAUDE.md règle 3).
 *
 * Aucun import de Three.js, aucun serveur, aucune base de données : si ce fichier cesse de
 * fonctionner, c'est qu'une dépendance de rendu ou de réseau a fuité dans le cœur.
 *
 * Choix du pas de temps : en mode headless on ne rend rien, donc la finesse de 20 Hz du
 * serveur n'a aucun intérêt. Un tick d'une seconde de jeu suffit largement pour observer
 * des journées entières, et rend un run de 10 jours praticable.
 *
 * Save/Load : `--load-from` charge une sauvegarde AVANT de simuler, `--save-to` en écrit
 * une à la fin. La seed effective devient celle de la sauvegarde chargée (elle prime sur
 * `--seed`) : un monde restauré doit rester géographiquement identique à lui-même, quoi
 * que l'utilisateur ait tapé sur la ligne de commande.
 */
async function main(argv: readonly string[]): Promise<number> {
  let options;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (options.help) {
    console.log(CLI_HELP);
    return 0;
  }

  let loaded: SaveEnvelope | null = null;
  let effectiveSeed = options.seed;
  const adapter = new FilePersistenceAdapter(options.saveDir);

  if (options.loadFrom !== null) {
    let result;
    try {
      result = await adapter.loadLatestValid(options.loadFrom);
    } catch (error) {
      console.error(
        `Échec du chargement de "${options.loadFrom}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
    if (result === null) {
      console.error(`Aucune sauvegarde nommée "${options.loadFrom}" dans "${options.saveDir}".`);
      return 1;
    }
    if (result.source !== 'current') {
      console.warn(
        `Sauvegarde "${options.loadFrom}" corrompue — restauration depuis ${result.source}.`,
      );
    }
    loaded = result.envelope;
    effectiveSeed = loaded.metadata.seed;
  }

  const simulation = new Simulation({
    seed: effectiveSeed,
    population: options.population,
    config: { time: { gameSecondsPerTick: options.tickSeconds } },
    // Un chargement remplace entièrement la population : construire la population
    // par défaut d'abord serait un gaspillage jeté immédiatement par restoreSnapshot.
    spawnInitialPopulation: loaded === null,
  });

  if (loaded !== null) {
    try {
      simulation.restoreSnapshot(loaded.snapshot);
    } catch (error) {
      console.error(
        `Sauvegarde "${options.loadFrom}" incompatible avec ce monde: ${error instanceof Error ? error.message : String(error)}`,
      );
      simulation.dispose();
      return 1;
    }
  }

  const { hoursPerDay } = simulation.config.time;
  const ticksPerDay = Math.round((hoursPerDay * 3600) / options.tickSeconds);
  const totalTicks = ticksPerDay * options.days;
  const initialPopulation = simulation.humanCount;
  const currentSeason = () => simulation.world.environment.seasonName(simulation.clock);

  if (!options.quiet) {
    if (loaded !== null) {
      console.log(
        `Sauvegarde "${options.loadFrom}" chargée — tick ${loaded.metadata.tick.toLocaleString('fr-FR')}, ` +
          `sauvegardée le ${loaded.metadata.savedAtIso}`,
      );
    }
    console.log(
      `Monde "${simulation.world.worldId}" — seed "${effectiveSeed}", ` +
        `${initialPopulation} humains, ${simulation.world.sizeMeters} m de côté ` +
        `(${simulation.world.bounds.chunkCount} chunks), saison initiale ${currentSeason()}`,
    );
    console.log(
      `Simulation de ${options.days} jour(s) — ${totalTicks.toLocaleString('fr-FR')} ticks\n`,
    );
  }

  let deaths = 0;
  simulation.events.on('HumanDied', () => {
    deaths++;
  });

  simulation.start();

  const startedAtMs = performance.now();
  for (let day = 0; day < options.days; day++) {
    simulation.step(ticksPerDay);
    if (!options.quiet) {
      console.log(
        `  ${simulation.clock.format()} (${currentSeason()})  population ${simulation.humanCount}  ` +
          `état ${hashWorldState(simulation)}`,
      );
    }
  }
  const wallClockMs = performance.now() - startedAtMs;

  const stats = simulation.stats();
  const eventCounts = simulation.recorder.countsByName();
  const totalEvents = simulation.recorder.totalCount;

  console.log('\nSimulation complete\n');
  console.log(`  Seed:                ${effectiveSeed}`);
  console.log(`  Days:                ${options.days}`);
  console.log(`  Ticks:               ${simulation.clock.currentTick.toLocaleString('fr-FR')}`);
  console.log(`  Initial population:  ${initialPopulation}`);
  console.log(`  Final population:    ${simulation.humanCount}`);
  console.log(`  Deaths:              ${deaths}`);
  console.log(`  Events:              ${totalEvents}`);
  console.log(`  Average tick:        ${stats.averageTickMs.toFixed(4)} ms`);
  console.log(`  Wall clock:          ${(wallClockMs / 1000).toFixed(2)} s`);
  console.log(`  State hash:          ${hashWorldState(simulation)}`);

  if (Object.keys(eventCounts).length > 0) {
    console.log('\n  Événements par type:');
    for (const [name, count] of Object.entries(eventCounts)) {
      console.log(`    ${name.padEnd(20)} ${count}`);
    }
  }

  if (options.inspect > 0) {
    console.log('\n  Individus:');
    for (const entity of simulation.humanIds().slice(0, options.inspect)) {
      console.log(`    ${describeHuman(simulation, entity).replace(/\n/g, '\n    ')}`);
    }
  }

  if (options.saveTo !== null) {
    const envelope = createSaveEnvelope(simulation, options.saveTo, new Date().toISOString());
    try {
      await adapter.save(options.saveTo, envelope);
      console.log(`\n  Sauvegarde:          "${options.saveTo}" dans "${options.saveDir}"`);
    } catch (error) {
      console.error(
        `Échec de la sauvegarde "${options.saveTo}": ${error instanceof Error ? error.message : String(error)}`,
      );
      simulation.dispose();
      return 1;
    }
  }

  simulation.dispose();
  return 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
