import { describe, expect, it } from 'vitest';
import { PathFindingService } from './pathFindingService.js';
import { NavGrid } from './navGrid.js';
import type { CostMemo, TileCostProvider } from './types.js';

/**
 * Toutes les coordonnées de ces tests sont en **mètres** (comme dans la simulation) ;
 * les tuiles font 2 m, donc le point (x, z) tombe dans la tuile (x/2, z/2) arrondi à
 * l'entier inférieur.
 */
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

function makeService(blocked: string[] = []): PathFindingService {
  return new PathFindingService({
    grid: makeGrid(blocked),
    maxNodesPerTick: 1000,
    maxNodesPerRequest: 4000,
    maxRetries: 3,
    pathCacheCapacity: 32,
    snapRadiusTiles: 2,
  });
}

describe('PathFindingService', () => {
  it('answers immediately from the cache after a first computation', () => {
    const service = makeService();
    // (0,0) → (10,0) : tuiles (0,0) → (5,0), rien en cache : requête mise en file.
    const first = service.request({ x: 0, z: 0 }, { x: 10, z: 0 }, 0);
    expect(first.immediate).toBeNull();
    expect(first.requestId).not.toBeNull();
    expect(first.resolvedGoal).toEqual({ x: 5, z: 0 });
    expect(first.originalGoal).toEqual({ x: 5, z: 0 });
    expect(service.pendingCount).toBe(1);

    const outcomes = service.process();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.path).not.toBeNull();
    expect(outcomes[0]!.request.id).toBe(first.requestId);
    expect(outcomes[0]!.request.originalGoal).toEqual({ x: 5, z: 0 });
    expect(service.pendingCount).toBe(0);
    expect(service.cacheSize).toBe(1);

    const second = service.request({ x: 0, z: 0 }, { x: 10, z: 0 }, 5);
    expect(second.immediate).not.toBeNull();
    expect(second.immediate!.path).toEqual(outcomes[0]!.path);
    expect(second.resolvedGoal).toEqual({ x: 5, z: 0 });
    expect(service.pendingCount).toBe(0);
  });

  it('snaps a goal that falls on an unwalkable tile to the nearest walkable one', () => {
    // La tuile (2,2) du service = le point (4,4) en mètres ; son voisinage direct est
    // bloqué : la cible est repliée sur une tuile praticable proche, puis le chemin est
    // calculé jusqu'à elle.
    const service = makeService(['2,2', '1,2', '3,2', '2,1', '2,3']);
    const reply = service.request({ x: 0, z: 0 }, { x: 4, z: 4 }, 0);
    expect(reply.immediate).toBeNull();
    expect(reply.originalGoal).toEqual({ x: 2, z: 2 });
    // resolvedGoal a été snappé sur une tuile praticable, différente de la cible.
    expect(reply.resolvedGoal).not.toEqual({ x: 2, z: 2 });
    expect(reply.resolvedGoal).not.toBeNull();

    const outcomes = service.process();
    expect(outcomes).toHaveLength(1);
    const path = outcomes[0]!.path;
    expect(path).not.toBeNull();
    const last = path!.at(-1)!;
    // La cible repliée est praticable et reste dans le rayon de repli de (2,2).
    expect(Math.max(Math.abs(last.x - 2), Math.abs(last.z - 2))).toBeLessThanOrEqual(2);
    expect(last).not.toEqual({ x: 2, z: 2 });
    expect(last).toEqual(reply.resolvedGoal);
  });

  it('reports failure immediately when nothing walkable surrounds the goal', () => {
    // Un carré 5x5 de tuiles bloquées autour de la cible : le repli ne trouve rien.
    const blocked: string[] = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) blocked.push(`${2 + dx},${2 + dz}`);
    }
    const service = makeService(blocked);
    const reply = service.request({ x: 0, z: 0 }, { x: 4, z: 4 }, 0);
    expect(reply.immediate).not.toBeNull();
    expect(reply.immediate!.path).toBeNull();
    expect(reply.resolvedGoal).toBeNull();
    expect(reply.originalGoal).toEqual({ x: 2, z: 2 });
    expect(service.pendingCount).toBe(0);
  });

  it('fails immediately when the start is surrounded by obstacles', () => {
    const blocked: string[] = [];
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) blocked.push(`${dx},${dz}`);
    }
    const service = makeService(blocked);
    const reply = service.request({ x: 0, z: 0 }, { x: 10, z: 0 }, 0);
    expect(reply.immediate).not.toBeNull();
    expect(reply.immediate!.path).toBeNull();
    expect(service.pendingCount).toBe(0);
  });

  it('walks around a blocked tile rather than crossing it', () => {
    const service = makeService(['4,0']);
    const reply = service.request({ x: 0, z: 0 }, { x: 10, z: 0 }, 0);
    expect(reply.immediate).toBeNull();
    const outcomes = service.process();
    expect(outcomes).toHaveLength(1);
    const path = outcomes[0]!.path;
    expect(path).not.toBeNull();
    for (const tile of path!) {
      expect(tile.x === 4 && tile.z === 0).toBe(false);
    }
  });

  it('assigns a distinct requestId to each queued request', () => {
    const service = makeService();
    const a = service.request({ x: 0, z: 0 }, { x: 10, z: 0 }, 0);
    const b = service.request({ x: 4, z: 4 }, { x: 12, z: 4 }, 0);
    expect(a.requestId).not.toBeNull();
    expect(b.requestId).not.toBeNull();
    expect(a.requestId).not.toBe(b.requestId);
  });

  it('converts world coordinates through tiles of the configured size', () => {
    const service = makeService();
    expect(service.tileAt(3.1, -5.9)).toEqual({ x: 1, z: -3 });
    expect(service.centerMeters({ x: 1, z: -3 })).toEqual({ x: 3, z: -5 });
    expect(service.tileSizeMeters).toBe(2);
  });
});
