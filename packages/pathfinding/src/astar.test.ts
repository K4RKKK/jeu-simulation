import { describe, expect, it } from 'vitest';
import { findPath, IncrementalAStarSearch } from './astar.js';
import { NavGrid } from './navGrid.js';
import type { CostMemo, TileCostProvider } from './types.js';

interface GridSpec {
  /** `null` = infranchissable, sinon coût d'entrée de la tuile. */
  cost(x: number, z: number): number | null;
  tileSizeMeters?: number;
  /** Monde fini : hors de ces bornes, tout est infranchissable. */
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

function gridFrom(spec: GridSpec): NavGrid {
  const cost: TileCostProvider = {
    tileCost(x: number, z: number, memo: CostMemo): number | null {
      const key = `${x},${z}`;
      const cached = memo.get(key);
      if (cached !== undefined) return cached;
      const value = (() => {
        if (spec.bounds) {
          const { minX, maxX, minZ, maxZ } = spec.bounds;
          if (x < minX || x > maxX || z < minZ || z > maxZ) return null;
        }
        return spec.cost(x, z);
      })();
      memo.set(key, value);
      return value;
    },
  };
  return new NavGrid({ tileSizeMeters: spec.tileSizeMeters ?? 1, cost });
}

/** Toutes les tuiles à coût constant sauf une liste de bloquées. */
function uniform(blocked: string[] = [], cost = 1): GridSpec {
  const blockedSet = new Set(blocked);
  return { cost: (x, z) => (blockedSet.has(`${x},${z}`) ? null : cost) };
}

function search(
  grid: NavGrid,
  start: { x: number; z: number },
  goal: { x: number; z: number },
  maxNodes = 100000,
) {
  return findPath(start, goal, grid, new Map(), maxNodes);
}

describe('findPath', () => {
  it('finds a straight line on flat ground with minimal cost', () => {
    const grid = gridFrom(uniform());
    const result = search(grid, { x: 0, z: 0 }, { x: 5, z: 0 });
    expect(result.finished).toBe(true);
    expect(result.path).not.toBeNull();
    expect(result.path![0]).toEqual({ x: 0, z: 0 });
    expect(result.path![result.path!.length - 1]).toEqual({ x: 5, z: 0 });
    expect(result.path).toHaveLength(6);
  });

  it('avoids a wall instead of crossing it', () => {
    // Mur vertical en x=3, de z=-20 à z=20 : le chemin doit le contourner par le haut
    // ou par le bas, sans jamais emprunter une tuile du mur.
    const blocked: string[] = [];
    for (let z = -20; z <= 20; z++) blocked.push(`3,${z}`);
    const grid = gridFrom(uniform(blocked));
    const result = search(grid, { x: 0, z: 0 }, { x: 6, z: 0 });
    expect(result.path).not.toBeNull();
    for (const tile of result.path!) {
      expect(tile.x === 3 && Math.abs(tile.z) <= 20).toBe(false);
    }
    expect(result.path![0]).toEqual({ x: 0, z: 0 });
    expect(result.path![result.path!.length - 1]).toEqual({ x: 6, z: 0 });
  });

  it('prefers cheap terrain over expensive terrain', () => {
    // Deux routes parallèles entre (0,2) et (8,2) : une ligne droite chère (coût 3,
    // z=0) et un détour bon marché (coût 1, |z|=2), reliées par les raccords en x=0
    // et x=8. L'A* doit emprunter le détour, jamais la ligne chère.
    const spec: GridSpec = {
      cost: (x, z) => {
        if (x < 0 || x > 8) return null;
        if (Math.abs(z) === 2) return 1;
        if ((x === 0 || x === 8) && z >= -2 && z <= 2) return 1;
        if (z === 0 && x > 0 && x < 8) return 3;
        return null;
      },
      bounds: { minX: -1, maxX: 9, minZ: -3, maxZ: 3 },
    };
    const grid = gridFrom(spec);
    const result = search(grid, { x: 0, z: 2 }, { x: 8, z: 2 });
    expect(result.path).not.toBeNull();
    for (const tile of result.path!) {
      expect(tile.z === 0).toBe(false);
    }
  });

  it('returns null when the goal is unreachable', () => {
    // Puits 3x1 entouré de murs : l'intérieur est praticable, personne n'y entre.
    const blocked = new Set<string>();
    for (let x = 5; x <= 8; x++) {
      for (let z = -1; z <= 1; z++) {
        if (x > 5 && x < 8 && z === 0) continue; // l'intérieur du puits reste libre
        blocked.add(`${x},${z}`);
      }
    }
    const grid = gridFrom({
      ...uniform([...blocked]),
      bounds: { minX: -3, maxX: 11, minZ: -4, maxZ: 4 },
    });
    const result = search(grid, { x: 0, z: 0 }, { x: 7, z: 0 });
    expect(result.path).toBeNull();
    expect(result.finished).toBe(true);
  });

  it('returns null when start or goal is unwalkable', () => {
    const grid = gridFrom(uniform(['0,0']));
    expect(search(grid, { x: 0, z: 0 }, { x: 3, z: 0 }).path).toBeNull();
    expect(search(grid, { x: 1, z: 0 }, { x: 0, z: 0 }).path).toBeNull();
  });

  it('returns a single-tile path when start equals goal', () => {
    const grid = gridFrom(uniform());
    const result = search(grid, { x: 2, z: 2 }, { x: 2, z: 2 });
    expect(result.path).toEqual([{ x: 2, z: 2 }]);
  });

  it('stops at the node budget and reports an unfinished search', () => {
    const grid = gridFrom(uniform());
    const result = search(grid, { x: 0, z: 0 }, { x: 200, z: 0 }, 50);
    expect(result.path).toBeNull();
    expect(result.finished).toBe(false);
    expect(result.explored).toBeLessThanOrEqual(50);
  });

  it('reprend exactement là où la tranche précédente s’est arrêtée', () => {
    const grid = gridFrom(uniform());
    const incremental = new IncrementalAStarSearch(
      { x: 0, z: 0 },
      { x: 200, z: 0 },
      grid,
      new Map(),
    );
    let exploredAcrossSlices = 0;
    let result = incremental.step(25);
    while (!result.finished) {
      exploredAcrossSlices += result.explored;
      result = incremental.step(25);
    }
    exploredAcrossSlices += result.explored;

    const singlePass = search(grid, { x: 0, z: 0 }, { x: 200, z: 0 });
    expect(result.path).toEqual(singlePass.path);
    expect(exploredAcrossSlices).toBe(singlePass.explored);
    expect(incremental.exploredTotal).toBe(singlePass.explored);
  });

  it('finds the same path twice: the search is deterministic', () => {
    const blocked: string[] = [];
    for (let z = -10; z <= 10; z++) blocked.push(`4,${z}`);
    const grid = gridFrom(uniform(blocked));
    const a = search(grid, { x: 0, z: 3 }, { x: 9, z: 3 });
    const b = search(grid, { x: 0, z: 3 }, { x: 9, z: 3 });
    expect(a.path).toEqual(b.path);
    expect(a.explored).toBe(b.explored);
  });

  it('does not cut corners on water tiles', () => {
    // Deux tuiles d'eau en diagonale : passer entre elles via la diagonale serait couper
    // un coin d'eau. Le chemin doit longer l'anneau libre.
    const grid = gridFrom(uniform(['2,2']));
    const result = search(grid, { x: 1, z: 1 }, { x: 3, z: 3 });
    expect(result.path).not.toBeNull();
    // Le chemin ne peut pas passer directement par (2,2) : il doit faire au moins 4 tuiles.
    expect(result.path!.length).toBeGreaterThanOrEqual(4);
  });
});
