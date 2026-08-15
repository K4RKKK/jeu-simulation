import { describe, expect, it } from 'vitest';
import { NavGrid } from './navGrid.js';
import { PathRequestQueue } from './pathRequestQueue.js';
import type { CostMemo, TileCostProvider } from './types.js';

function makeGrid(blocked: string[] = []): NavGrid {
  const blockedSet = new Set(blocked);
  const cost: TileCostProvider = {
    tileCost(x: number, z: number, memo: CostMemo): number | null {
      const key = `${x},${z}`;
      const cached = memo.get(key);
      if (cached !== undefined) return cached;
      const value = blockedSet.has(key) ? null : 1;
      memo.set(key, value);
      return value;
    },
  };
  return new NavGrid({ tileSizeMeters: 2, cost });
}

describe('PathRequestQueue', () => {
  it('processes requests in FIFO order', () => {
    const queue = new PathRequestQueue(2);
    const grid = makeGrid();
    queue.enqueue({ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 0 }, 10, 100);
    queue.enqueue({ x: 5, z: 5 }, { x: 7, z: 5 }, { x: 7, z: 5 }, 11, 100);
    const outcomes = queue.process(1000, grid);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]!.request.requestedAtTick).toBe(10);
    expect(outcomes[1]!.request.requestedAtTick).toBe(11);
  });

  it('splits the node budget across requests', () => {
    const queue = new PathRequestQueue(2);
    const grid = makeGrid();
    queue.enqueue({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 0 }, 0, 1000);
    queue.enqueue({ x: 0, z: 0 }, { x: 0, z: 2 }, { x: 0, z: 2 }, 0, 1000);
    // Budget minuscule : seul le début de la première requête peut être exploré.
    const outcomes = queue.process(3, grid);
    expect(outcomes).toHaveLength(0);
    expect(queue.size).toBeGreaterThan(0);
  });

  it('sends a truncated request back to the end of the queue and retries it', () => {
    const queue = new PathRequestQueue(4);
    const grid = makeGrid();
    queue.enqueue({ x: 0, z: 0 }, { x: 200, z: 0 }, { x: 200, z: 0 }, 0, 1000);
    queue.enqueue({ x: 20, z: 0 }, { x: 20, z: 2 }, { x: 20, z: 2 }, 0, 1000);

    // Premier traitement : budget 50, la requête 1 (longue) est tronquée et différée ;
    // la requête 2 (courte) n'a plus de budget. Rien n'aboutit.
    const first = queue.process(50, grid);
    expect(first).toHaveLength(0);
    expect(queue.size).toBe(2);

    // Deuxième traitement : la requête 2 (courte, arrivée première) aboutit, puis la
    // requête 1 retrouve le budget entier et aboutit à son tour.
    const second = queue.process(1000, grid);
    expect(second).toHaveLength(2);
    expect(second[0]!.request.start).toEqual({ x: 20, z: 0 });
    expect(second[1]!.request.start).toEqual({ x: 0, z: 0 });
    expect(second[1]!.path).not.toBeNull();
    expect(queue.size).toBe(0);
  });

  it('borne le coût total d’une requête sans recommencer ses premières tranches', () => {
    const queue = new PathRequestQueue(1);
    const grid = makeGrid();
    queue.enqueue({ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 0 }, 0, 30);

    // Le plafond total est atteint dans cette première tranche : aucune seconde
    // exploration des mêmes 30 nœuds n'est programmée.
    const outcomes = queue.process(30, grid);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.path).toBeNull();
    expect(outcomes[0]!.request.attempts).toBe(1);
    expect(queue.size).toBe(0);
    expect(queue.process(30, grid)).toEqual([]);
  });

  it('resolves an impossible request immediately without retries', () => {
    const queue = new PathRequestQueue(1);
    const grid = makeGrid(['2,0']);
    queue.enqueue({ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 0 }, 0, 100);
    const outcomes = queue.process(1000, grid);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.path).toBeNull();
  });

  it('termine une longue recherche sur plusieurs tranches même avec maxRetries à zéro', () => {
    const queue = new PathRequestQueue(0);
    const grid = makeGrid();
    queue.enqueue({ x: 0, z: 0 }, { x: 200, z: 0 }, { x: 200, z: 0 }, 0, 1000);
    let outcome = queue.process(25, grid)[0];
    let passes = 1;
    while (!outcome && passes < 100) {
      outcome = queue.process(25, grid)[0];
      passes++;
    }
    expect(outcome?.path?.at(-1)).toEqual({ x: 200, z: 0 });
    expect(passes).toBeGreaterThan(1);
  });

  it('libère immédiatement une recherche annulée', () => {
    const queue = new PathRequestQueue(0);
    const grid = makeGrid();
    const id = queue.enqueue({ x: 0, z: 0 }, { x: 200, z: 0 }, { x: 200, z: 0 }, 0, 1000);
    expect(queue.process(25, grid)).toEqual([]);
    expect(queue.cancel(id)).toBe(true);
    expect(queue.size).toBe(0);
    expect(queue.cancel(id)).toBe(false);
  });
});
