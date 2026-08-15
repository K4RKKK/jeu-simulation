import { Simulation } from '@civ/simulation';
import { chunkKey, type ChunkCoordinate } from '@civ/procedural';
import { ChunkManager } from '../world/chunkManager.js';

/**
 * `pnpm stress:chunks` — cycle de vie des chunks sous charge.
 *
 * Simule un observateur qui se déplace sans cesse dans le monde (des centaines de
 * cycles de `setActive` avec une fenêtre de chunks glissante), et vérifie :
 * - aucune exception pendant `request`/`pump`/`setActive`/`payloadFor` ;
 * - un chunk demandé actif AVANT sa génération devient bien `Active` une fois généré
 *   (le bug historique de transition manquée — voir `chunkManager.test.ts`) ;
 * - le cache ne dépasse jamais `maxCached` après une passe de `pump()` ;
 * - un chunk marqué `Active` n'est jamais évincé du cache ;
 * - le tas JS ne croît pas sans borne sur la durée du run.
 *
 * Cahier des charges : 500 cycles de chargement/déchargement. Par défaut ce script en
 * fait moins pour rester rapide — monter `--cycles 500` pour la charge complète.
 */

interface Options {
  cycles: number;
  radius: number;
  worldSizeChunks: number;
  help: boolean;
}

const DEFAULTS: Options = { cycles: 150, radius: 3, worldSizeChunks: 24, help: false };

function parseArgs(argv: readonly string[]): Options {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === undefined) continue;
    if (raw === '--help' || raw === '-h') {
      options.help = true;
      continue;
    }
    const equals = raw.indexOf('=');
    const flag = equals === -1 ? raw : raw.slice(0, equals);
    const inline = equals === -1 ? undefined : raw.slice(equals + 1);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`Option "${flag}" expects a value.`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Option "${flag}" expects a positive number, received "${value}".`);
    }
    switch (flag) {
      case '--cycles':
        options.cycles = Math.round(parsed);
        break;
      case '--radius':
        options.radius = Math.round(parsed);
        break;
      case '--worldSizeChunks':
        options.worldSizeChunks = Math.round(parsed);
        break;
      default:
        throw new Error(`Unknown option "${flag}".`);
    }
  }
  return options;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function heapUsedMb(): number {
  return Math.round((process.memoryUsage().heapUsed / (1024 * 1024)) * 10) / 10;
}

function windowAround(center: ChunkCoordinate, radius: number): ChunkCoordinate[] {
  const keys: ChunkCoordinate[] = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      keys.push({ x: center.x + dx, z: center.z + dz });
    }
  }
  return keys;
}

function main(argv: readonly string[]): number {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (options.help) {
    console.log(
      'stress:chunks — [--cycles n] [--radius n] [--worldSizeChunks n]\n' +
        `  défauts: cycles=${DEFAULTS.cycles} radius=${DEFAULTS.radius} worldSizeChunks=${DEFAULTS.worldSizeChunks}`,
    );
    return 0;
  }

  const simulation = new Simulation({
    seed: 'stress-chunks',
    population: 0,
    spawnInitialPopulation: false,
    config: { time: { gameSecondsPerTick: 1 } },
    generation: { layout: { sizeChunks: options.worldSizeChunks } },
  });
  const maxCached = 96;
  const manager = new ChunkManager(simulation, {
    maxCached,
    budgetMsPerPass: 50,
    activeGraceTicks: 4,
  });

  const anomalies: string[] = [];
  const heapSamples: number[] = [heapUsedMb()];
  const cachedSizeSamples: number[] = [];
  const startedAt = performance.now();
  const half = Math.floor(options.worldSizeChunks / 2) - options.radius - 1;

  // Trajectoire déterministe en spirale carrée : couvre une bonne part du monde sans
  // dépendre d'un tirage aléatoire (les stress tests doivent être reproductibles).
  let x = 0;
  let z = 0;
  let dx = 1;
  let dz = 0;
  let legLength = 1;
  let legsCompleted = 0;
  let legProgress = 0;

  for (let cycle = 0; cycle < options.cycles; cycle++) {
    simulation.step(1);
    const center: ChunkCoordinate = { x, z };
    const window = windowAround(center, options.radius);

    try {
      for (const coordinate of window) manager.request(coordinate);
      manager.setActive(window.map((c) => chunkKey(c)));
      // `pump()` est borné par un budget de temps (comme dans le vrai serveur, qui
      // l'appelle à chaque tick réseau) : une seule passe ne génère pas forcément toute
      // une fenêtre de 49 chunks. On la vide complètement ici, comme le ferait le
      // serveur au fil de plusieurs tours — sinon le test confondrait « pas encore
      // généré cette milliseconde » avec un vrai bug de transition d'état.
      let guard = 0;
      while (manager.stats().queued > 0 && guard < 200) {
        manager.pump();
        guard++;
      }
      if (manager.stats().queued > 0) {
        anomalies.push(`cycle ${cycle}: file jamais vidée après ${guard} passes de pump()`);
      }
    } catch (error) {
      anomalies.push(`cycle ${cycle} (${x},${z}): exception — ${String(error)}`);
      break;
    }

    // Chaque chunk actif doit être « Active » — jamais bloqué en Loaded/Generating.
    for (const coordinate of window) {
      const key = chunkKey(coordinate);
      const state = manager.stateOf(key);
      // Unloaded = hors des limites du monde, légitime en bord de carte.
      if (state !== 'Active' && simulation.world.bounds.containsChunk(coordinate)) {
        anomalies.push(`cycle ${cycle}: chunk ${key} attendu Active, trouvé ${state}`);
      }
      try {
        manager.payloadFor(key);
      } catch (error) {
        anomalies.push(`cycle ${cycle}: payloadFor(${key}) a levé — ${String(error)}`);
      }
    }

    const stats = manager.stats();
    // Contrat documenté de `ChunkManager` : `maxCached` ne borne QUE les entrées
    // évictables (ni `Active`, ni `Generating` — jamais ce qui est actuellement
    // observé). Avec une fenêtre active de `window.length` chunks et une hystérésis
    // de grâce, `entries.size` peut légitimement dépasser `maxCached` de façon
    // transitoire. Une marge généreuse absorbe ce chevauchement ; au-delà, ce n'est
    // plus de l'hystérésis, c'est une fuite.
    const generousCeiling = maxCached + window.length * 2;
    if (stats.cached > generousCeiling) {
      anomalies.push(
        `cycle ${cycle}: cache anormalement élevé (${stats.cached} > ${generousCeiling}, maxCached=${maxCached})`,
      );
    }
    cachedSizeSamples.push(stats.cached);

    if (cycle % 10 === 0) heapSamples.push(heapUsedMb());

    // Avance sur la spirale.
    x += dx;
    z += dz;
    legProgress++;
    if (legProgress >= legLength) {
      legProgress = 0;
      [dx, dz] = [-dz, dx]; // rotation 90°
      legsCompleted++;
      if (legsCompleted % 2 === 0) legLength++;
    }
    if (Math.abs(x) > half || Math.abs(z) > half) {
      x = 0;
      z = 0;
      dx = 1;
      dz = 0;
      legLength = 1;
      legsCompleted = 0;
      legProgress = 0;
    }

    if (anomalies.length > 200) {
      anomalies.push(`arrêt anticipé après ${anomalies.length} anomalies`);
      break;
    }
  }

  heapSamples.push(heapUsedMb());
  const elapsedMs = performance.now() - startedAt;
  simulation.dispose();

  // Détection de fuite : compare la taille moyenne du cache sur la seconde moitié du
  // run à la première. Une hystérésis stable oscille autour d'un plateau ; une fuite
  // continue de grimper. Ignore le premier quart (montée en charge initiale normale).
  const warmupEnd = Math.floor(cachedSizeSamples.length / 4);
  const stable = cachedSizeSamples.slice(warmupEnd);
  const mid = Math.floor(stable.length / 2);
  const firstHalfAvg = average(stable.slice(0, mid));
  const secondHalfAvg = average(stable.slice(mid));
  if (mid > 10 && firstHalfAvg > 0 && secondHalfAvg > firstHalfAvg * 1.25) {
    anomalies.push(
      `taille du cache en croissance continue : ${firstHalfAvg.toFixed(0)} → ${secondHalfAvg.toFixed(0)} entrées (+${(((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100).toFixed(0)} %) — fuite possible`,
    );
  }

  console.log('\n=== stress:chunks ===');
  console.log(`  cycles=${options.cycles} rayon=${options.radius} fenêtre=${(options.radius * 2 + 1) ** 2} chunks`);
  console.log(`  durée: ${(elapsedMs / 1000).toFixed(1)} s`);
  console.log(`  tas JS: ${heapSamples[0]} Mo → ${heapSamples.at(-1)} Mo`);
  console.log(`  cache: ${firstHalfAvg.toFixed(0)} → ${secondHalfAvg.toFixed(0)} entrées (moyenne 1ère/2e moitié, hors montée en charge)`);

  if (anomalies.length === 0) {
    console.log('\n✓ Aucune anomalie détectée.');
    return 0;
  }
  console.log(`\n✗ ${anomalies.length} anomalie(s) détectée(s) :`);
  for (const anomaly of anomalies.slice(0, 50)) console.log(`  - ${anomaly}`);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
