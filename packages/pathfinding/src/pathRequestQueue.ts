import { IncrementalAStarSearch } from './astar.js';
import type { NavGrid } from './navGrid.js';
import type { CostMemo, TileCoord } from './types.js';

export interface PathRequest {
  readonly id: number;
  /** Tuile de départ après repli sur tuile praticable. */
  readonly start: TileCoord;
  /** Tuile de cible après repli sur tuile praticable. */
  readonly goal: TileCoord;
  /**
   * Tuile de cible telle que demandée par l'appelant, avant repli. Permet à l'appelant
   * de décider si le dernier point de passage doit être la position exacte demandée
   * (cible praticable, cas `originalGoal == goal`) ou le centre de la tuile snappée
   * (cible non praticable ; ne jamais marcher dans l'eau au dernier pas).
   */
  readonly originalGoal: TileCoord;
  readonly requestedAtTick: number;
  readonly maxNodes: number;
  /** Nombre de tranches incrémentales déjà exécutées (métrique/debug). */
  attempts: number;
}

export interface PathRequestOutcome {
  readonly request: PathRequest;
  /** `null` = aucun chemin n'existe (ou abandon après retries). */
  readonly path: TileCoord[] | null;
}

/**
 * File FIFO des demandes de chemin, avec budget de nœuds par traitement.
 *
 * L'ordre est l'ordre d'arrivée : la file est déterministe. Une demande qui n'a pas pu
 * finir dans le budget repart en **fin de file** avec sa frontière A* intacte. Une même
 * requête n'obtient qu'une tranche par appel à `process()`, puis laisse la place aux
 * suivantes. `PathRequest.maxNodes` borne son coût total, pas chaque tentative.
 */
export class PathRequestQueue {
  private readonly queue: Array<{
    request: PathRequest;
    search: IncrementalAStarSearch | null;
  }> = [];
  private nextId = 0;

  constructor(maxRetries: number) {
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new RangeError('maxRetries must be a non-negative integer');
    }
  }

  get size(): number {
    return this.queue.length;
  }

  enqueue(
    start: TileCoord,
    goal: TileCoord,
    originalGoal: TileCoord,
    requestedAtTick: number,
    maxNodes: number,
  ): number {
    const id = this.nextId++;
    this.queue.push({
      request: { id, start, goal, originalGoal, requestedAtTick, maxNodes, attempts: 0 },
      search: null,
    });
    return id;
  }

  /** Annule une recherche devenue orpheline (cible changée, entité détruite…). */
  cancel(requestId: number): boolean {
    const index = this.queue.findIndex(({ request }) => request.id === requestId);
    if (index === -1) return false;
    this.queue.splice(index, 1);
    return true;
  }

  process(budgetNodes: number, grid: NavGrid, sharedMemo?: CostMemo): PathRequestOutcome[] {
    const outcomes: PathRequestOutcome[] = [];
    const deferred: typeof this.queue = [];
    let remaining = budgetNodes;
    while (this.queue.length > 0 && remaining > 0) {
      const queued = this.queue.shift()!;
      const { request } = queued;
      queued.search ??= new IncrementalAStarSearch(
        request.start,
        request.goal,
        grid,
        sharedMemo ?? new Map(),
      );
      const requestRemaining = request.maxNodes - queued.search.exploredTotal;
      if (requestRemaining <= 0) {
        outcomes.push({ request, path: null });
        continue;
      }
      const result = queued.search.step(Math.min(requestRemaining, remaining));
      remaining -= result.explored;
      if (!result.finished) {
        request.attempts += 1;
        if (queued.search.exploredTotal < request.maxNodes) {
          // Une seule tranche par passe : garantit l'équité sans perdre la recherche.
          deferred.push(queued);
        } else {
          outcomes.push({ request, path: null });
        }
        continue;
      }
      outcomes.push({ request, path: result.path });
    }
    for (const request of deferred) this.queue.push(request);
    return outcomes;
  }
}
