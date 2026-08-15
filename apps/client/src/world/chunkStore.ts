import type {
  ChunkPayload,
  DecodedResources,
  DecodedTerrain,
  WorldGenerationMetadata,
} from '@civ/shared';
import { decodeChunkResources, decodeChunkTerrain } from '@civ/shared';

export interface LoadedChunk {
  readonly key: string;
  readonly coordinate: { x: number; z: number };
  readonly originX: number;
  readonly originZ: number;
  readonly terrain: DecodedTerrain;
  readonly resources: DecodedResources;
  readonly dominantBiomeIndex: number;
  readonly walkableRatio: number;
  readonly waterBodyIndices: readonly number[];
  readonly generationMs: number;
  /**
   * Non `readonly` : `applyTrailUpdate` remplace cet objet en bloc la toute première
   * fois qu'un chunk chargé sans usure connue (résolution sentinelle `1`, voir `apply`)
   * reçoit sa première vraie mise à jour — la résolution réelle n'est connue qu'à ce
   * moment-là.
   */
  trails: { resolution: number; wear: Uint8Array };
}

/** Ce que l'inspecteur de terrain lit sous le curseur. */
export interface TerrainProbe {
  readonly worldX: number;
  readonly worldZ: number;
  readonly chunkKey: string;
  readonly heightM: number;
  readonly waterHeightM: number | null;
  readonly elevation01: number;
  readonly slope01: number;
  readonly temperature01: number;
  readonly moisture01: number;
  readonly fertility01: number;
  readonly rockiness01: number;
  readonly vegetation01: number;
  readonly biomeIndex: number;
  /**
   * Coordonnée de région (identité vraie, calculée côté client à partir de
   * `metadata.regions.sizeChunks` — pas déduite de l'octet de coloration réseau) et
   * octet de coloration transmis par le serveur (voir `TerrainFieldGrids.region`).
   */
  readonly regionX: number;
  readonly regionZ: number;
  readonly regionColorByte: number;
  /**
   * Praticabilité réelle transmise par le serveur (pente + eau guéable) — jamais
   * recalculée côté client à partir d'un seuil approximatif.
   */
  readonly walkable: boolean;
}

export interface ChunkStoreListeners {
  onChunkAdded?: (chunk: LoadedChunk) => void;
  onChunkRemoved?: (key: string) => void;
  onMetadata?: (metadata: WorldGenerationMetadata) => void;
}

/**
 * Miroir local des chunks reçus.
 *
 * Le client ne génère rien : il décode. Les grilles reçues servent à trois usages — bâtir
 * le maillage, colorer les calques de debug, répondre à l'inspecteur — et sont conservées
 * pour cela plutôt que d'interroger le serveur à chaque clic.
 */
export class ChunkStore {
  private readonly chunks = new Map<string, LoadedChunk>();
  private readonly observedRegions = new Set<string>();
  private readonly observedWaterBodies = new Set<number>();
  private readonly listeners: ChunkStoreListeners;

  metadata: WorldGenerationMetadata | null = null;

  constructor(listeners: ChunkStoreListeners = {}) {
    this.listeners = listeners;
  }

  get size(): number {
    return this.chunks.size;
  }

  /** Régions dont au moins un chunk a réellement été reçu pendant cette session. */
  get observedRegionCount(): number {
    return this.observedRegions.size;
  }

  /** Étendues d'eau présentes dans au moins un chunk réellement reçu. */
  get observedWaterBodyCount(): number {
    return this.observedWaterBodies.size;
  }

  get chunkSizeMeters(): number {
    return this.metadata?.chunkSizeMeters ?? 64;
  }

  /** Côté d'une région, en mètres — dérivé localement, jamais transmis directement. */
  get regionSizeMeters(): number {
    return (this.metadata?.regions.sizeChunks ?? 6) * this.chunkSizeMeters;
  }

  setMetadata(metadata: WorldGenerationMetadata): void {
    this.metadata = metadata;
    this.clear();
    this.listeners.onMetadata?.(metadata);
  }

  values(): IterableIterator<LoadedChunk> {
    return this.chunks.values();
  }

  get(key: string): LoadedChunk | undefined {
    return this.chunks.get(key);
  }

  apply(payload: ChunkPayload): void {
    if (!this.metadata) return;
    const chunkSize = this.metadata.chunkSizeMeters;
    const originX = payload.coordinate.x * chunkSize;
    const originZ = payload.coordinate.z * chunkSize;

    const chunk: LoadedChunk = {
      key: payload.key,
      coordinate: payload.coordinate,
      originX,
      originZ,
      terrain: decodeChunkTerrain(payload.terrain),
      resources: decodeChunkResources(payload.resources, originX, originZ),
      dominantBiomeIndex: payload.dominantBiomeIndex,
      walkableRatio: payload.walkableRatio,
      waterBodyIndices: payload.waterBodyIndices,
      generationMs: payload.generationMs,
      trails: payload.trails
        ? decodeSparseTrails(payload.trails)
        : { resolution: 1, wear: new Uint8Array(1) },
    };

    const previous = this.chunks.get(payload.key);
    if (previous) this.listeners.onChunkRemoved?.(payload.key);
    this.chunks.set(payload.key, chunk);
    const regionSizeChunks = this.metadata.regions.sizeChunks;
    this.observedRegions.add(
      `${Math.floor(payload.coordinate.x / regionSizeChunks)}:${Math.floor(payload.coordinate.z / regionSizeChunks)}`,
    );
    for (const waterBodyIndex of payload.waterBodyIndices) {
      this.observedWaterBodies.add(waterBodyIndex);
    }
    this.listeners.onChunkAdded?.(chunk);
  }

  applyTrailUpdate(
    chunkKey: string,
    resolution: number,
    cells: readonly { index: number; wear: number }[],
  ): boolean {
    const chunk = this.chunks.get(chunkKey);
    if (!chunk) return false;
    if (chunk.trails.resolution !== resolution) {
      // Résolution sentinelle (`1`, voir `apply`) : ce chunk a été chargé sans usure
      // connue — le serveur omet `trails` pour les chunks jamais foulés (voir
      // `ChunkManager.withTrails`). Sa toute première mise à jour révèle la résolution
      // réelle, qu'on adopte ici plutôt que de rejeter l'update comme une désync.
      if (chunk.trails.resolution !== 1) return false;
      chunk.trails = { resolution, wear: new Uint8Array(resolution * resolution) };
    }
    for (const cell of cells) {
      if (cell.index >= 0 && cell.index < chunk.trails.wear.length) {
        chunk.trails.wear[cell.index] = cell.wear;
      }
    }
    return true;
  }

  remove(keys: readonly string[]): void {
    for (const key of keys) {
      if (!this.chunks.delete(key)) continue;
      this.listeners.onChunkRemoved?.(key);
    }
  }

  clear(): void {
    for (const key of [...this.chunks.keys()]) {
      this.chunks.delete(key);
      this.listeners.onChunkRemoved?.(key);
    }
    this.observedRegions.clear();
    this.observedWaterBodies.clear();
  }

  /**
   * Lit les champs du terrain à une position monde.
   *
   * Le sommet le plus proche suffit : la grille est bien plus fine que la précision utile
   * pour régler une génération, et interpoler huit champs coûterait plus qu'il ne
   * rapporterait.
   */
  probe(worldX: number, worldZ: number): TerrainProbe | null {
    if (!this.metadata) return null;
    const chunkSize = this.metadata.chunkSizeMeters;
    const key = `${Math.floor(worldX / chunkSize)}:${Math.floor(worldZ / chunkSize)}`;
    const chunk = this.chunks.get(key);
    if (!chunk) return null;

    const resolution = chunk.terrain.resolution;
    const step = chunkSize / resolution;
    const column = clampIndex(Math.round((worldX - chunk.originX) / step), resolution + 1);
    const row = clampIndex(Math.round((worldZ - chunk.originZ) / step), resolution + 1);
    const index = row * (resolution + 1) + column;

    const waterHeight = chunk.terrain.waterHeights[index] as number;
    return {
      worldX,
      worldZ,
      chunkKey: key,
      heightM: chunk.terrain.heights[index] as number,
      waterHeightM: Number.isNaN(waterHeight) ? null : waterHeight,
      elevation01: byteTo01(chunk.terrain.fields.elevation[index]),
      slope01: byteTo01(chunk.terrain.fields.slope[index]),
      temperature01: byteTo01(chunk.terrain.fields.temperature[index]),
      moisture01: byteTo01(chunk.terrain.fields.moisture[index]),
      fertility01: byteTo01(chunk.terrain.fields.fertility[index]),
      rockiness01: byteTo01(chunk.terrain.fields.rockiness[index]),
      vegetation01: byteTo01(chunk.terrain.fields.vegetation[index]),
      biomeIndex: chunk.terrain.fields.biome[index] ?? 0,
      regionX: Math.floor(worldX / this.regionSizeMeters),
      regionZ: Math.floor(worldZ / this.regionSizeMeters),
      regionColorByte: chunk.terrain.fields.region[index] ?? 0,
      walkable: (chunk.terrain.fields.walkable[index] ?? 0) === 1,
    };
  }
}

function byteTo01(value: number | undefined): number {
  return (value ?? 0) / 255;
}

function clampIndex(value: number, size: number): number {
  return value < 0 ? 0 : value >= size ? size - 1 : value;
}

/**
 * Reconstitue une grille dense locale à partir des cellules creuses transmises —
 * le rendu (`TrailView`) a besoin d'un accès O(1) par index, mais le réseau ne
 * transmet jamais que ce qui a réellement de l'usure (voir `WorldDelta.trailSparseCells`
 * côté serveur).
 */
function decodeSparseTrails(trails: NonNullable<ChunkPayload['trails']>): {
  resolution: number;
  wear: Uint8Array;
} {
  const wear = new Uint8Array(trails.resolution * trails.resolution);
  for (const cell of trails.cells) {
    if (cell.index >= 0 && cell.index < wear.length) wear[cell.index] = cell.wear;
  }
  return { resolution: trails.resolution, wear };
}
