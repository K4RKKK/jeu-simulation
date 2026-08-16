import type { TileCoord } from './types.js';
import { tileKey } from './types.js';

/**
 * Cache LRU des chemins calculés, indexé par (départ, arrivée) en tuiles.
 *
 * Le terrain est statique dans cette version : aucun invalidation n'est nécessaire.
 * Les chemins sont retournés **par référence** : les appelants ne doivent jamais les
 * muter, une réécriture invaliderait le cache sans que personne le voie.
 */
export class PathCache {
  private readonly cache = new Map<string, TileCoord[]>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('Path cache capacity must be a positive integer');
    }
  }

  get size(): number {
    return this.cache.size;
  }

  /** `null` si absent — une lecture rafraîchit la fraîcheur LRU. */
  get(start: TileCoord, goal: TileCoord): TileCoord[] | null {
    const key = this.key(start, goal);
    const path = this.cache.get(key);
    if (path === undefined) return null;
    this.cache.delete(key);
    this.cache.set(key, path);
    return path;
  }

  set(start: TileCoord, goal: TileCoord, path: TileCoord[]): void {
    const key = this.key(start, goal);
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, path);
    if (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  private key(start: TileCoord, goal: TileCoord): string {
    return `${tileKey(start)}→${tileKey(goal)}`;
  }
}
