import type { NavGrid } from './navGrid.js';
import { PathCache } from './pathCache.js';
import { PathRequestQueue, type PathRequestOutcome } from './pathRequestQueue.js';
import type { CostMemo, MetersPoint, TileCoord } from './types.js';

export interface PathFindingServiceOptions {
  grid: NavGrid;
  /** Nœuds de recherche consommables par traitement (budget par tick du système). */
  maxNodesPerTick: number;
  /** Plafond de nœuds pour une seule requête avant abandon. */
  maxNodesPerRequest: number;
  /** @deprecated Conservé dans la configuration/sauvegarde ; l'A* reprend désormais jusqu'au plafond total. */
  maxRetries: number;
  pathCacheCapacity: number;
  /** Rayon de repli d'une cible sur la tuile praticable la plus proche. */
  snapRadiusTiles: number;
  /**
   * Mémo de coûts optionnelle partagée entre requêtes. Réservée aux providers dont les
   * coûts sont immuables ; sans elle, chaque recherche garde sa mémo indépendante.
   */
  sharedCostMemo?: CostMemo;
}

/**
 * Réponse à une demande de chemin.
 *
 * Deux formes d'issue :
 * - `immediate` non nul : la réponse est connue tout de suite (cache, ou aucune tuile
 *   praticable pour départ/cible).
 * - `immediate` nul : la requête est en file. `requestId` permettra de retrouver
 *   l'issue au prochain `process()` (voir `PathRequestOutcome.request.id`).
 *
 * Les champs `resolvedGoal` (cible snappée sur tuile praticable) et `originalGoal`
 * (cible telle que demandée, en tuiles) sont toujours présents : l'appelant en a besoin
 * pour placer le dernier point de passage correctement. Ils ne sont `null` que si
 * l'appel n'a pu trouver aucune tuile praticable dans le rayon de repli (chemin
 * définitivement impossible).
 */
export interface PathRequestReply {
  readonly immediate: { readonly path: TileCoord[] | null } | null;
  readonly requestId: number | null;
  readonly resolvedGoal: TileCoord | null;
  readonly originalGoal: TileCoord;
}

/** @deprecated Utiliser `PathRequestReply`. Conservé pour compat descendante. */
export interface ImmediatePathResult {
  readonly path: TileCoord[] | null;
}

/**
 * Point d'entrée du calcul de chemins : grille + file à budget + cache.
 *
 * Deux sorties possibles pour une demande :
 * - réponse **immédiate** : le cache connaît déjà ce trajet (ou il est impossible) ;
 * - `null` : la requête est en file, le résultat arrivera au prochain `process()`.
 *
 * Tout est déterministe : ordre FIFO, recherches sans tirage, cache LRU borné. Deux
 * simulations identiques produisent donc les mêmes chemins, dans le même ordre.
 */
export class PathFindingService {
  private readonly grid: NavGrid;
  private readonly queue: PathRequestQueue;
  private readonly cache: PathCache;
  private readonly maxNodesPerTick: number;
  private readonly maxNodesPerRequest: number;
  private readonly snapRadiusTiles: number;
  private readonly sharedCostMemo: CostMemo | null;

  constructor(options: PathFindingServiceOptions) {
    this.grid = options.grid;
    this.queue = new PathRequestQueue(options.maxRetries);
    this.cache = new PathCache(options.pathCacheCapacity);
    this.maxNodesPerTick = options.maxNodesPerTick;
    this.maxNodesPerRequest = options.maxNodesPerRequest;
    this.snapRadiusTiles = options.snapRadiusTiles;
    this.sharedCostMemo = options.sharedCostMemo ?? null;
  }

  get tileSizeMeters(): number {
    return this.grid.tileSizeMeters;
  }

  get pendingCount(): number {
    return this.queue.size;
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  cancel(requestId: number): boolean {
    return this.queue.cancel(requestId);
  }

  tileAt(x: number, z: number): TileCoord {
    return this.grid.tileAt(x, z);
  }

  centerMeters(tile: TileCoord): MetersPoint {
    return this.grid.centerMeters(tile);
  }

  /**
   * Demande un chemin entre deux points en mètres.
   * Le départ et la cible sont repliés sur la tuile praticable la plus proche : un point
   * de départ au bord de l'eau ou une cible mémorisée sur une pente restent utilisables.
   *
   * L'appelant reçoit `resolvedGoal` (tuile snappée) et `originalGoal` (tuile demandée).
   * Si elles diffèrent, la cible d'origine n'était pas praticable : le dernier point de
   * passage doit rester au centre de `resolvedGoal`, jamais sur la position originale
   * (règle : « un humain ne traverse pas une rivière par erreur »).
   */
  request(from: MetersPoint, to: MetersPoint, requestedAtTick: number): PathRequestReply {
    const originalGoal = this.grid.tileAt(to.x, to.z);
    const start = this.grid.tileAt(from.x, from.z);
    const memo: CostMemo = this.sharedCostMemo ?? new Map();

    const startTile = this.grid.snapToWalkable(start, memo, this.snapRadiusTiles);
    if (startTile === null) {
      return { immediate: { path: null }, requestId: null, resolvedGoal: null, originalGoal };
    }
    const goalTile = this.grid.snapToWalkable(originalGoal, memo, this.snapRadiusTiles);
    if (goalTile === null) {
      return { immediate: { path: null }, requestId: null, resolvedGoal: null, originalGoal };
    }

    const cached = this.cache.get(startTile, goalTile);
    if (cached !== null) {
      return { immediate: { path: cached }, requestId: null, resolvedGoal: goalTile, originalGoal };
    }

    const requestId = this.queue.enqueue(
      startTile,
      goalTile,
      originalGoal,
      requestedAtTick,
      this.maxNodesPerRequest,
    );
    return { immediate: null, requestId, resolvedGoal: goalTile, originalGoal };
  }

  /** Traite la file dans la limite du budget ; les chemins trouvés entrent au cache. */
  process(): PathRequestOutcome[] {
    const outcomes = this.queue.process(
      this.maxNodesPerTick,
      this.grid,
      this.sharedCostMemo ?? undefined,
    );
    for (const outcome of outcomes) {
      if (outcome.path !== null && outcome.path.length > 1) {
        this.cache.set(outcome.request.start, outcome.request.goal, outcome.path);
      }
    }
    return outcomes;
  }
}
