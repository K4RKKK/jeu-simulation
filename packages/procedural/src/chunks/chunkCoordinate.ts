import type { ChunkId } from '@civ/shared';

/**
 * Coordonnée de chunk.
 *
 * Convention : le chunk (0, 0) couvre `[0, taille) × [0, taille)` en coordonnées monde. Les
 * chunks à l'ouest et au nord portent donc des indices négatifs — d'où des clés comme
 * `"12:-4"`. Cette origine, plutôt qu'un coin de carte, est ce qui permettra d'agrandir le
 * monde plus tard sans renuméroter les chunks existants (et donc sans invalider une
 * sauvegarde).
 */
export interface ChunkCoordinate {
  readonly x: number;
  readonly z: number;
}

export function chunkKey(coordinate: ChunkCoordinate): ChunkId {
  return `${coordinate.x}:${coordinate.z}`;
}

export function parseChunkKey(key: ChunkId): ChunkCoordinate {
  const separator = key.indexOf(':');
  if (separator <= 0) throw new Error(`Invalid chunk key: "${key}"`);
  const x = Number(key.slice(0, separator));
  const z = Number(key.slice(separator + 1));
  if (!Number.isInteger(x) || !Number.isInteger(z)) {
    throw new Error(`Invalid chunk key: "${key}"`);
  }
  return { x, z };
}

export function chunkCoordinatesEqual(a: ChunkCoordinate, b: ChunkCoordinate): boolean {
  return a.x === b.x && a.z === b.z;
}

/** Chunk contenant une position monde. */
export function worldToChunk(
  worldX: number,
  worldZ: number,
  chunkSizeMeters: number,
): ChunkCoordinate {
  return {
    x: Math.floor(worldX / chunkSizeMeters),
    z: Math.floor(worldZ / chunkSizeMeters),
  };
}

/** Coin (minimum) d'un chunk, en coordonnées monde. */
export function chunkToWorld(
  coordinate: ChunkCoordinate,
  chunkSizeMeters: number,
): { x: number; z: number } {
  return { x: coordinate.x * chunkSizeMeters, z: coordinate.z * chunkSizeMeters };
}

/** Position à l'intérieur du chunk, dans `[0, taille)`. */
export function getLocalPosition(
  worldX: number,
  worldZ: number,
  chunkSizeMeters: number,
): { x: number; z: number } {
  const origin = chunkToWorld(worldToChunk(worldX, worldZ, chunkSizeMeters), chunkSizeMeters);
  return { x: worldX - origin.x, z: worldZ - origin.z };
}

/** Distance de Chebyshev entre deux chunks : le « rayon » d'un carré de chunks. */
export function chunkDistance(a: ChunkCoordinate, b: ChunkCoordinate): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/**
 * Chunks contenus dans un rayon autour d'un centre, du plus proche au plus lointain.
 * L'ordre compte : il permet de charger d'abord ce que l'observateur voit le mieux.
 */
export function chunksInRadius(center: ChunkCoordinate, radius: number): ChunkCoordinate[] {
  const result: ChunkCoordinate[] = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      result.push({ x: center.x + dx, z: center.z + dz });
    }
  }
  result.sort(
    (a, b) =>
      (a.x - center.x) ** 2 +
      (a.z - center.z) ** 2 -
      ((b.x - center.x) ** 2 + (b.z - center.z) ** 2),
  );
  return result;
}
