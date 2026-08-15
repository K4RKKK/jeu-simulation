import type {
  ChunkPayload,
  ChunkResourcesPayload,
  ChunkTerrainPayload,
} from '../protocol/world.js';
import {
  RESOURCE_LOCAL_OFFSET_METERS,
  decodeHeights,
  decodeInt16Array,
  decodeUint16Array,
  decodeUint8Array,
} from './binary.js';

/** Grilles d'un chunk, décodées et prêtes à être consommées par le rendu. */
export interface DecodedTerrain {
  readonly resolution: number;
  readonly heights: Float32Array;
  /** `NaN` là où il n'y a pas d'eau. */
  readonly waterHeights: Float32Array;
  readonly colors: Uint8Array;
  readonly fields: {
    readonly elevation: Uint8Array;
    readonly slope: Uint8Array;
    readonly temperature: Uint8Array;
    readonly moisture: Uint8Array;
    readonly fertility: Uint8Array;
    readonly rockiness: Uint8Array;
    readonly vegetation: Uint8Array;
    readonly biome: Uint8Array;
    /** Octet de coloration de région — PAS un identifiant unique, voir `TerrainFieldGrids.region`. */
    readonly region: Uint8Array;
    /** 0/1 par sommet — praticabilité réelle, voir `TerrainFieldGrids.walkable`. */
    readonly walkable: Uint8Array;
  };
  readonly minHeightM: number;
  readonly maxHeightM: number;
  readonly hasWater: boolean;
}

export interface DecodedResources {
  readonly count: number;
  readonly definitionIndex: Uint8Array;
  /**
   * Identifiant local du spawn dans son chunk propriétaire. Utilisé par le rendu pour
   * indexer un mesh et par les deltas réseau (`resource:removed { chunkKey, localId }`).
   */
  readonly localId: Uint16Array;
  /** Position **monde**, en mètres. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly scale: Float32Array;
  readonly rotation: Float32Array;
}

export function decodeChunkTerrain(terrain: ChunkTerrainPayload): DecodedTerrain {
  return {
    resolution: terrain.resolution,
    heights: decodeHeights(terrain.heights),
    waterHeights: decodeHeights(terrain.waterHeights),
    colors: decodeUint8Array(terrain.colors),
    fields: {
      elevation: decodeUint8Array(terrain.fields.elevation),
      slope: decodeUint8Array(terrain.fields.slope),
      temperature: decodeUint8Array(terrain.fields.temperature),
      moisture: decodeUint8Array(terrain.fields.moisture),
      fertility: decodeUint8Array(terrain.fields.fertility),
      rockiness: decodeUint8Array(terrain.fields.rockiness),
      vegetation: decodeUint8Array(terrain.fields.vegetation),
      biome: decodeUint8Array(terrain.fields.biome),
      region: decodeUint8Array(terrain.fields.region),
      walkable: decodeUint8Array(terrain.fields.walkable),
    },
    minHeightM: terrain.minHeightM,
    maxHeightM: terrain.maxHeightM,
    hasWater: terrain.hasWater,
  };
}

/**
 * Décode les ressources et **replace les positions en coordonnées monde**.
 *
 * Elles voyagent en coordonnées locales au chunk : deux octets suffisent alors pour une
 * précision centimétrique, là où une coordonnée monde en aurait exigé quatre.
 */
export function decodeChunkResources(
  resources: ChunkResourcesPayload,
  originX: number,
  originZ: number,
): DecodedResources {
  const count = resources.count;
  const localX = decodeUint16Array(resources.x);
  const localZ = decodeUint16Array(resources.z);
  const rawY = decodeInt16Array(resources.y);
  const rawScale = decodeUint8Array(resources.scale);
  const rawRotation = decodeUint8Array(resources.rotation);

  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const z = new Float32Array(count);
  const scale = new Float32Array(count);
  const rotation = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    x[i] = originX + (localX[i] as number) / 100 - RESOURCE_LOCAL_OFFSET_METERS;
    z[i] = originZ + (localZ[i] as number) / 100 - RESOURCE_LOCAL_OFFSET_METERS;
    y[i] = (rawY[i] as number) / 100;
    scale[i] = (rawScale[i] as number) / 100;
    rotation[i] = ((rawRotation[i] as number) / 256) * Math.PI * 2;
  }

  return {
    count,
    definitionIndex: decodeUint8Array(resources.definitionIndex).slice(0, count),
    localId: decodeUint16Array(resources.localId).slice(0, count),
    x,
    y,
    z,
    scale,
    rotation,
  };
}

/** Origine monde d'un chunk, en mètres. */
export function chunkOrigin(
  payload: ChunkPayload,
  chunkSizeMeters: number,
): { x: number; z: number } {
  return {
    x: payload.coordinate.x * chunkSizeMeters,
    z: payload.coordinate.z * chunkSizeMeters,
  };
}
