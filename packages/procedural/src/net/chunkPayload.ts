import type { ChunkPayload } from '@civ/shared';
import {
  RESOURCE_LOCAL_OFFSET_METERS,
  encodeHeights,
  encodeInt16Array,
  encodeUint16Array,
  encodeUint8Array,
} from '@civ/shared';
import type { ChunkData } from '../chunks/chunkData.js';

/**
 * Traduit un chunk généré en message réseau.
 *
 * C'est la frontière du package procédural : au-dessus, des tableaux typés en pleine
 * précision ; en dessous, des grilles quantifiées. Aucune structure interne du générateur
 * n'atteint le client, ce qui laisse toute liberté de refondre la génération sans casser le
 * protocole.
 */
export function toChunkPayload(chunk: ChunkData, chunkSizeMeters: number): ChunkPayload {
  const originX = chunk.coordinate.x * chunkSizeMeters;
  const originZ = chunk.coordinate.z * chunkSizeMeters;
  const count = chunk.resources.length;

  const definitionIndex = new Uint8Array(count);
  const localId = new Uint16Array(count);
  const localX = new Uint16Array(count);
  const localZ = new Uint16Array(count);
  const heightCm = new Int16Array(count);
  const scale = new Uint8Array(count);
  const rotation = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    const spawn = chunk.resources[i]!;
    definitionIndex[i] = spawn.definitionIndex;
    // `localId` = adresse compacte et stable du spawn dans son chunk propriétaire, sur
    // 16 bits (jusqu'à 65 535 individus par chunk — largement au-dessus de la limite
    // pratique `maxPerChunk`).
    localId[i] = clampUint16(spawn.localId);
    // Coordonnées locales décalées : deux octets suffisent au centimètre, et le décalage
    // absorbe les individus légèrement débordants.
    localX[i] = clampUint16(Math.round((spawn.x - originX + RESOURCE_LOCAL_OFFSET_METERS) * 100));
    localZ[i] = clampUint16(Math.round((spawn.z - originZ + RESOURCE_LOCAL_OFFSET_METERS) * 100));
    heightCm[i] = clampInt16(Math.round(spawn.y * 100));
    scale[i] = clampUint8(Math.round(spawn.scale * 100));
    rotation[i] = Math.round((spawn.rotationY / (Math.PI * 2)) * 256) & 255;
  }

  return {
    key: chunk.key,
    coordinate: { x: chunk.coordinate.x, z: chunk.coordinate.z },
    terrain: {
      resolution: chunk.terrain.resolution,
      heights: encodeHeights(chunk.terrain.heights),
      waterHeights: encodeHeights(chunk.terrain.waterHeights),
      colors: encodeUint8Array(chunk.terrain.colors),
      fields: {
        elevation: encodeUint8Array(chunk.terrain.fields.elevation),
        slope: encodeUint8Array(chunk.terrain.fields.slope),
        temperature: encodeUint8Array(chunk.terrain.fields.temperature),
        moisture: encodeUint8Array(chunk.terrain.fields.moisture),
        fertility: encodeUint8Array(chunk.terrain.fields.fertility),
        rockiness: encodeUint8Array(chunk.terrain.fields.rockiness),
        vegetation: encodeUint8Array(chunk.terrain.fields.vegetation),
        biome: encodeUint8Array(chunk.terrain.fields.biome),
        region: encodeUint8Array(chunk.terrain.fields.region),
        walkable: encodeUint8Array(chunk.terrain.fields.walkable),
      },
      minHeightM: round2(chunk.terrain.minHeightM),
      maxHeightM: round2(chunk.terrain.maxHeightM),
      hasWater: chunk.terrain.hasWater,
    },
    resources: {
      count,
      definitionIndex: encodeUint8Array(definitionIndex),
      localId: encodeUint16Array(localId),
      x: encodeUint16Array(localX),
      z: encodeUint16Array(localZ),
      y: encodeInt16Array(heightCm),
      scale: encodeUint8Array(scale),
      rotation: encodeUint8Array(rotation),
    },
    waterBodyIndices: [...chunk.waterBodyIndices],
    dominantBiomeIndex: chunk.biomeStats.dominantIndex,
    walkableRatio: round2(chunk.biomeStats.walkableRatio),
    generationMs: round2(chunk.generationMs),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampUint16(value: number): number {
  return value < 0 ? 0 : value > 65535 ? 65535 : value;
}

function clampUint8(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function clampInt16(value: number): number {
  return value < -32767 ? -32767 : value > 32767 ? 32767 : value;
}
