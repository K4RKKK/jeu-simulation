import { describe, expect, it } from 'vitest';
import { NavGrid } from './navGrid.js';
import type { CostMemo, TileCostProvider } from './types.js';

/** Grille factice : tout est franchissable à coût 1, sauf les cases listées (null). */
function makeGrid(blocked: string[] = [], tileSize = 2): NavGrid {
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
  return new NavGrid({ tileSizeMeters: tileSize, cost });
}

describe('NavGrid', () => {
  it('converts meters to tiles and back', () => {
    const grid = makeGrid();
    expect(grid.tileAt(3.2, -5.7)).toEqual({ x: 1, z: -3 });
    expect(grid.centerMeters({ x: 1, z: -3 })).toEqual({ x: 3, z: -5 });
  });

  it('converts negative coordinates without truncation bias', () => {
    const grid = makeGrid();
    expect(grid.tileAt(-0.1, -2.1)).toEqual({ x: -1, z: -2 });
  });

  it('reports a tile as unwalkable when the provider returns null', () => {
    const grid = makeGrid(['3,4']);
    const memo: CostMemo = new Map();
    expect(grid.isWalkable({ x: 3, z: 4 }, memo)).toBe(false);
    expect(grid.isWalkable({ x: 3, z: 5 }, memo)).toBe(true);
  });

  it('queries each tile only once thanks to the memo', () => {
    let calls = 0;
    const cost: TileCostProvider = {
      tileCost(x: number, z: number, memo: CostMemo): number | null {
        const key = `${x},${z}`;
        const cached = memo.get(key);
        if (cached !== undefined) return cached;
        calls += 1;
        const value = 1;
        memo.set(key, value);
        return value;
      },
    };
    const grid = new NavGrid({ tileSizeMeters: 2, cost });
    const memo: CostMemo = new Map();
    grid.isWalkable({ x: 0, z: 0 }, memo);
    grid.isWalkable({ x: 0, z: 0 }, memo);
    grid.isWalkable({ x: 0, z: 0 }, memo);
    expect(calls).toBe(1);
  });

  it('lists the 8 neighbors with diagonal cost multiplied by √2', () => {
    const grid = makeGrid();
    const memo: CostMemo = new Map();
    const neighbors = grid.neighbors({ x: 0, z: 0 }, memo);
    expect(neighbors).toHaveLength(8);
    const diagonal = neighbors.find((n) => n.tile.x === 1 && n.tile.z === 1);
    expect(diagonal?.cost).toBeCloseTo(Math.SQRT2, 10);
    const cardinal = neighbors.find((n) => n.tile.x === 1 && n.tile.z === 0);
    expect(cardinal?.cost).toBe(1);
  });

  it('does not cut corners: a diagonal needs both cardinal neighbors walkable', () => {
    // (1,0) est bloqué : la diagonale (1,1) ne doit pas être empruntée depuis (0,0).
    const grid = makeGrid(['1,0']);
    const memo: CostMemo = new Map();
    const neighbors = grid.neighbors({ x: 0, z: 0 }, memo);
    expect(neighbors.some((n) => n.tile.x === 1 && n.tile.z === 1)).toBe(false);
    expect(neighbors.some((n) => n.tile.x === 0 && n.tile.z === 1)).toBe(true);
  });

  it('keeps the current tile when it is walkable', () => {
    const grid = makeGrid();
    const memo: CostMemo = new Map();
    expect(grid.snapToWalkable({ x: 5, z: 5 }, memo, 2)).toEqual({ x: 5, z: 5 });
  });

  it('snaps an unwalkable tile to the nearest walkable one, nearest first', () => {
    const grid = makeGrid(['0,0', '1,0', '0,1', '1,1', '-1,0', '-1,-1', '0,-1', '1,-1', '-1,1']);
    const memo: CostMemo = new Map();
    // Tout l'anneau r=1 est bloqué : la solution doit être sur l'anneau r=2.
    const snapped = grid.snapToWalkable({ x: 0, z: 0 }, memo, 2);
    expect(snapped).not.toBeNull();
    expect(Math.max(Math.abs(snapped!.x), Math.abs(snapped!.z))).toBe(2);
    expect(grid.isWalkable(snapped!, memo)).toBe(true);
  });

  it('returns null when nothing is walkable within the snap radius', () => {
    const grid = makeGrid(['0,0', '1,0', '0,1', '1,1', '-1,0', '-1,-1', '0,-1', '1,-1', '-1,1']);
    const memo: CostMemo = new Map();
    expect(grid.snapToWalkable({ x: 0, z: 0 }, memo, 1)).toBeNull();
  });
});