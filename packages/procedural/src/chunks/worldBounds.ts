import type { ChunkId } from '@civ/shared';
import type { WorldLayoutConfig } from '../config/worldGenerationConfig.js';
import { chunkKey, worldToChunk, type ChunkCoordinate } from './chunkCoordinate.js';

/**
 * Limites du monde.
 *
 * La V1 est un monde fini : c'est un choix de contenu, pas une contrainte du générateur.
 * `ChunkGenerator` accepte n'importe quelle coordonnée ; seules ces bornes décident de ce
 * qui est habité. Agrandir le monde revient à changer `sizeChunks`, sans toucher aux
 * algorithmes.
 */
export class WorldBounds {
  readonly chunkSizeMeters: number;
  readonly sizeChunks: number;
  readonly sizeMeters: number;
  readonly halfSizeMeters: number;
  /** Indice de chunk minimum inclus, sur les deux axes. */
  readonly minChunk: number;
  /** Indice de chunk maximum inclus, sur les deux axes. */
  readonly maxChunk: number;

  constructor(layout: WorldLayoutConfig) {
    if (layout.sizeChunks <= 0) throw new RangeError('World size in chunks must be positive');
    if (layout.chunkSizeMeters <= 0) throw new RangeError('Chunk size must be positive');

    this.chunkSizeMeters = layout.chunkSizeMeters;
    this.sizeChunks = layout.sizeChunks;
    this.sizeMeters = layout.sizeChunks * layout.chunkSizeMeters;
    this.halfSizeMeters = this.sizeMeters / 2;
    this.minChunk = -Math.floor(layout.sizeChunks / 2);
    this.maxChunk = this.minChunk + layout.sizeChunks - 1;
  }

  get chunkCount(): number {
    return this.sizeChunks * this.sizeChunks;
  }

  containsChunk(coordinate: ChunkCoordinate): boolean {
    return (
      coordinate.x >= this.minChunk &&
      coordinate.x <= this.maxChunk &&
      coordinate.z >= this.minChunk &&
      coordinate.z <= this.maxChunk
    );
  }

  contains(x: number, z: number): boolean {
    return (
      x >= -this.halfSizeMeters &&
      x < this.halfSizeMeters &&
      z >= -this.halfSizeMeters &&
      z < this.halfSizeMeters
    );
  }

  clamp(value: number): number {
    const limit = this.halfSizeMeters - 1e-3;
    return value < -limit ? -limit : value > limit ? limit : value;
  }

  clampX(x: number): number {
    return this.clamp(x);
  }

  clampZ(z: number): number {
    return this.clamp(z);
  }

  chunkAt(x: number, z: number): ChunkCoordinate {
    return worldToChunk(x, z, this.chunkSizeMeters);
  }

  chunkIdAt(x: number, z: number): ChunkId {
    return chunkKey(this.chunkAt(x, z));
  }

  /** Toutes les coordonnées du monde, dans un ordre stable. */
  allChunks(): ChunkCoordinate[] {
    const chunks: ChunkCoordinate[] = [];
    for (let z = this.minChunk; z <= this.maxChunk; z++) {
      for (let x = this.minChunk; x <= this.maxChunk; x++) chunks.push({ x, z });
    }
    return chunks;
  }
}
