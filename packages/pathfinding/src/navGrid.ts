import type { CostMemo, MetersPoint, TileCoord, TileCostProvider } from './types.js';
import { tileKey } from './types.js';

const SQRT2 = Math.SQRT2;

export interface NavGridOptions {
  /** Taille d'une tuile en mètres. */
  tileSizeMeters: number;
  cost: TileCostProvider;
}

export interface NavNeighbor {
  readonly tile: TileCoord;
  /** Coût d'entrée de la tuile voisine, diagonales comprises (×√2). */
  readonly cost: number;
}

/**
 * Grille de navigation dérivée du terrain.
 *
 * Le package ne sait pas ce qu'est une falaise ou une rivière : il pose une grille de
 * tuiles carrées sur le monde et délègue le coût de chaque tuile au `TileCostProvider`.
 * À lui seul il fait le reste : conversion mètres ↔ tuiles, voisinage 8-connexe, règle
 * anti-coupe-de-coin (une diagonale n'est empruntée que si les deux cardinaux voisins
 * sont franchissables — un chemin ne rase pas un coin d'eau), et repli d'une cible sur
 * la tuile praticable la plus proche.
 */
export class NavGrid {
  readonly tileSizeMeters: number;
  private readonly costProvider: TileCostProvider;

  constructor(options: NavGridOptions) {
    if (!Number.isFinite(options.tileSizeMeters) || options.tileSizeMeters <= 0) {
      throw new RangeError('Tile size must be a positive finite number');
    }
    this.tileSizeMeters = options.tileSizeMeters;
    this.costProvider = options.cost;
  }

  tileAt(xM: number, zM: number): TileCoord {
    return {
      x: Math.floor(xM / this.tileSizeMeters),
      z: Math.floor(zM / this.tileSizeMeters),
    };
  }

  centerMeters(tile: TileCoord): MetersPoint {
    const half = this.tileSizeMeters / 2;
    return {
      x: tile.x * this.tileSizeMeters + half,
      z: tile.z * this.tileSizeMeters + half,
    };
  }

  tileCost(tile: TileCoord, memo: CostMemo): number | null {
    const key = tileKey(tile);
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const value = this.costProvider.tileCost(tile.x, tile.z, memo);
    memo.set(key, value);
    return value;
  }

  isWalkable(tile: TileCoord, memo: CostMemo): boolean {
    return this.tileCost(tile, memo) !== null;
  }

  /** Voisins 8-connexes franchissables, avec leur coût d'entrée. */
  neighbors(tile: TileCoord, memo: CostMemo): NavNeighbor[] {
    const result: NavNeighbor[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const neighbor = { x: tile.x + dx, z: tile.z + dz };
        const cost = this.tileCost(neighbor, memo);
        if (cost === null) continue;
        if (dx !== 0 && dz !== 0) {
          const cardinalX = this.tileCost({ x: tile.x + dx, z: tile.z }, memo);
          const cardinalZ = this.tileCost({ x: tile.x, z: tile.z + dz }, memo);
          if (cardinalX === null || cardinalZ === null) continue;
          result.push({ tile: neighbor, cost: SQRT2 * cost });
        } else {
          result.push({ tile: neighbor, cost });
        }
      }
    }
    return result;
  }

  /**
   * Tuile praticable la plus proche, en anneaux carrés déterministes (le plus proche
   * d'abord, ordre de balayage stable). Retourne `null` si rien dans le rayon — la cible
   * est alors définitivement inatteignable.
   */
  snapToWalkable(tile: TileCoord, memo: CostMemo, radiusTiles: number): TileCoord | null {
    if (this.isWalkable(tile, memo)) return tile;
    for (let r = 1; r <= radiusTiles; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const candidate = { x: tile.x + dx, z: tile.z + dz };
          if (this.isWalkable(candidate, memo)) return candidate;
        }
      }
    }
    return null;
  }
}
