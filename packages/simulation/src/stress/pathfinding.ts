import { NavGrid, PathFindingService, type PathRequestOutcome } from '@civ/pathfinding';
import {
  checkPerformanceBudgets,
  DEFAULT_PERFORMANCE_BUDGETS,
} from '../config/performanceBudgets.js';
import { Simulation } from '../simulation.js';
import { terrainTileCostProvider } from '../systems/pathfinding/terrainCostProvider.js';
import { concludeStress, heapUsedMb, parseNumericFlags } from './stressArgs.js';

/**
 * `pnpm stress:pathfinding` — le service de chemins sous charge.
 *
 * Émet un grand nombre de requêtes de chemin entre points aléatoires du monde et
 * vérifie, pour chaque chemin trouvé :
 * - chaque point de passage est réellement praticable (`world.isWalkable`) — un
 *   chemin qui traverserait de l'eau profonde serait un « chemin invalide » ;
 * - aucune coordonnée `NaN`/`Infinity` ;
 * - le service ne lève jamais d'exception, quelle que soit la paire départ/arrivée
 *   (y compris des paires très éloignées ou hors-monde).
 *
 * Distances : bornées à `maxDistanceM` autour d'un point de départ tiré au hasard, à
 * l'image de l'usage réel — un humain ne demande jamais un chemin vers l'autre bout du
 * monde, seulement vers une cible mémorisée dans son rayon de perception (quelques
 * dizaines de mètres). Des paires totalement aléatoires sur un monde de 1500 m
 * produiraient des recherches A* pathologiquement coûteuses, sans rapport avec la
 * charge réelle du moteur.
 *
 * Cahier des charges : 10 000 requêtes. Par défaut ce script en fait moins pour rester
 * rapide — monter `--requests 10000` pour la charge complète.
 *
 * Résultat mesuré (constat honnête, pas caché) : à `--requests` élevé, la latence p95
 * dépasse largement `pathfindingMsPerRequestP95` du budget par défaut. Cause identifiée,
 * pas un bug : ce script soumet une NOUVELLE requête à CHAQUE itération sans jamais
 * s'arrêter — un rythme d'arrivée bien plus soutenu que la réalité du jeu, où la
 * plupart des humains ont déjà un chemin en cours et ne redemandent rien. Sous cette
 * charge volontairement excessive, la file FIFO à budget de nœuds (voir
 * `pathRequestQueue.ts`) accumule du retard : le p50 reste bas, le p95/max grimpent.
 * Le budget n'est pas assoupli pour autant — il décrit la cible en usage réel, et la
 * violation sous hammering est le signal à suivre pour la future recherche A*
 * incrémentale (déjà documentée comme limitation connue, non traitée cette phase).
 */
const DEFAULTS = { requests: 2000, worldSizeChunks: 24, seed: 0, maxDistanceM: 120 };

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
      'stress:pathfinding — [--requests n] [--worldSizeChunks n] [--maxDistanceM n]\n' +
        `  défauts: requests=${DEFAULTS.requests} worldSizeChunks=${DEFAULTS.worldSizeChunks} maxDistanceM=${DEFAULTS.maxDistanceM}`,
    );
    return 0;
  }

  const simulation = new Simulation({
    seed: `stress-pathfinding-${options.seed}`,
    population: 0,
    spawnInitialPopulation: false,
    config: { time: { gameSecondsPerTick: 1 } },
    generation: { layout: { sizeChunks: options.worldSizeChunks } },
  });

  const config = simulation.config.pathfinding;
  const service = new PathFindingService({
    grid: new NavGrid({
      tileSizeMeters: config.tileSizeMeters,
      cost: terrainTileCostProvider(simulation.world, config),
    }),
    maxNodesPerTick: config.maxNodesPerTick,
    maxNodesPerRequest: config.maxNodesPerRequest,
    maxRetries: config.maxRetries,
    pathCacheCapacity: 4096,
    snapRadiusTiles: config.snapRadiusTiles,
  });

  const anomalies: string[] = [];
  const half = simulation.world.sizeMeters / 2;
  const rng = simulation.rng.behavior; // stream dédié, déterministe

  let immediate = 0;
  let queued = 0;
  let pathsFound = 0;
  let pathsImpossible = 0;
  let totalWaypoints = 0;
  const startedAt = performance.now();
  const startHeap = heapUsedMb();
  // Latence de bout en bout par requête : de `request()` jusqu'à la résolution
  // (immédiate ou via `process()`) — c'est ce que `pathfindingMsPerRequestP95` mesure.
  const requestStartedAt = new Map<number, number>();
  const latenciesMs: number[] = [];

  // Un point de référence dérive dans le monde comme le ferait un humain — les cibles
  // restent dans son rayon de perception, jamais à l'autre bout du monde.
  let refX = 0;
  let refZ = 0;

  for (let i = 0; i < options.requests; i++) {
    refX = clamp(refX + rng.range(-40, 40), -half, half);
    refZ = clamp(refZ + rng.range(-40, 40), -half, half);
    const from = { x: refX, z: refZ };
    const to = {
      x: clamp(refX + rng.range(-options.maxDistanceM, options.maxDistanceM), -half, half),
      z: clamp(refZ + rng.range(-options.maxDistanceM, options.maxDistanceM), -half, half),
    };

    const requestStart = performance.now();
    let reply;
    try {
      reply = service.request(from, to, i);
    } catch (error) {
      anomalies.push(
        `requête ${i} (${from.x.toFixed(0)},${from.z.toFixed(0)})→(${to.x.toFixed(0)},${to.z.toFixed(0)}): exception ${String(error)}`,
      );
      continue;
    }

    if (reply.immediate !== null) {
      immediate++;
      latenciesMs.push(performance.now() - requestStart);
      checkPath(
        reply.immediate.path,
        i,
        anomalies,
        simulation,
        (n) => ((totalWaypoints += n), pathsFound++),
        () => pathsImpossible++,
      );
    } else {
      queued++;
      requestStartedAt.set(reply.requestId as number, requestStart);
    }

    // Traite la file à chaque itération, comme le ferait le PathfindingSystem à chaque
    // tick programmé : ne jamais laisser les requêtes s'accumuler sans borne.
    let outcomes: PathRequestOutcome[];
    try {
      outcomes = service.process();
    } catch (error) {
      anomalies.push(`process() à la requête ${i}: exception ${String(error)}`);
      outcomes = [];
    }
    for (const outcome of outcomes) {
      const start = requestStartedAt.get(outcome.request.id);
      if (start !== undefined) {
        latenciesMs.push(performance.now() - start);
        requestStartedAt.delete(outcome.request.id);
      }
      checkPath(
        outcome.path,
        outcome.request.id,
        anomalies,
        simulation,
        (n) => ((totalWaypoints += n), pathsFound++),
        () => pathsImpossible++,
      );
    }
  }

  // Vide la file restante.
  let guard = 0;
  while (service.pendingCount > 0 && guard < 10_000) {
    const outcomes = service.process();
    for (const outcome of outcomes) {
      const start = requestStartedAt.get(outcome.request.id);
      if (start !== undefined) {
        latenciesMs.push(performance.now() - start);
        requestStartedAt.delete(outcome.request.id);
      }
      checkPath(
        outcome.path,
        outcome.request.id,
        anomalies,
        simulation,
        (n) => ((totalWaypoints += n), pathsFound++),
        () => pathsImpossible++,
      );
    }
    guard++;
  }
  if (service.pendingCount > 0) {
    anomalies.push(`${service.pendingCount} requêtes jamais résolues après vidage de la file`);
  }

  const elapsedMs = performance.now() - startedAt;
  const p95 = percentile(latenciesMs, 0.95);
  const violations = checkPerformanceBudgets({ pathfindingMsPerRequestP95: p95 });
  for (const v of violations) {
    anomalies.push(
      `budget dépassé: ${v.metric} = ${v.measured.toFixed(2)}ms > ${v.budget}ms (voir performanceBudgets.ts)`,
    );
  }

  return concludeStress('stress:pathfinding', { anomalies }, [
    `requêtes=${options.requests} immédiates=${immediate} mises_en_file=${queued}`,
    `chemins_trouvés=${pathsFound} impossibles=${pathsImpossible} cache=${service.cacheSize}`,
    `waypoints_moyens=${pathsFound === 0 ? 0 : (totalWaypoints / pathsFound).toFixed(1)}`,
    `latence: p50=${percentile(latenciesMs, 0.5).toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${percentile(latenciesMs, 1).toFixed(2)}ms`,
    `budget: pathfindingMsPerRequestP95≤${DEFAULT_PERFORMANCE_BUDGETS.pathfindingMsPerRequestP95}ms`,
    `durée totale: ${(elapsedMs / 1000).toFixed(1)} s`,
    `tas JS: ${startHeap} Mo → ${heapUsedMb()} Mo`,
  ]);
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function checkPath(
  path: { x: number; z: number }[] | null,
  requestId: number,
  anomalies: string[],
  simulation: Simulation,
  onFound: (waypointCount: number) => void,
  onImpossible: () => void,
): void {
  if (path === null) {
    onImpossible();
    return;
  }
  onFound(path.length);
  const tileSize = simulation.config.pathfinding.tileSizeMeters;
  for (const tile of path) {
    const x = tile.x * tileSize + tileSize / 2;
    const z = tile.z * tileSize + tileSize / 2;
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      anomalies.push(`requête ${requestId}: waypoint non fini (${x}, ${z})`);
      continue;
    }
    if (!simulation.world.isWalkable(x, z)) {
      anomalies.push(
        `requête ${requestId}: waypoint (${x.toFixed(1)}, ${z.toFixed(1)}) non praticable — chemin invalide`,
      );
    }
  }
}

process.exitCode = main(process.argv.slice(2));
