import { describe, expect, it } from 'vitest';
import { decodeChunkResources } from '@civ/shared';
import type { ChunkData } from '../chunks/chunkData.js';
import { toChunkPayload } from './chunkPayload.js';

/**
 * `localId` est l'adresse compacte réseau d'une ressource dans son chunk propriétaire.
 * Bug potentiel : le serveur pourrait encoder les positions et les orientations sans
 * transmettre `localId`, obligeant le client à deviner l'adresse à partir de la
 * position — ce qui ne marche plus dès qu'une instance est cachée par un delta réseau.
 * Ce test verrouille la présence et la fidélité du bit-à-bit.
 */
describe('toChunkPayload — localId aller-retour', () => {
  it('conserve le localId de chaque spawn à travers encode → decode', () => {
    const chunkSize = 64;
    const spawns = [
      spawn({ id: 'a', localId: 0, x: 1, y: 2, z: 3 }),
      spawn({ id: 'b', localId: 1, x: 5, y: 4, z: 6 }),
      spawn({ id: 'c', localId: 2, x: 10, y: 6, z: 12 }),
      spawn({ id: 'd', localId: 42, x: 20, y: 8, z: 24 }),
    ];
    const chunk = fakeChunkData(spawns, chunkSize);

    const payload = toChunkPayload(chunk, chunkSize);
    expect(payload.resources.count).toBe(spawns.length);

    const decoded = decodeChunkResources(
      payload.resources,
      chunk.coordinate.x * chunkSize,
      chunk.coordinate.z * chunkSize,
    );

    expect(decoded.count).toBe(spawns.length);
    for (let i = 0; i < spawns.length; i++) {
      expect(decoded.localId[i]).toBe(spawns[i]!.localId);
      expect(decoded.definitionIndex[i]).toBe(spawns[i]!.definitionIndex);
    }
  });
});

function spawn(
  overrides: Partial<ChunkData['resources'][number]> & { id: string; localId: number },
) {
  return {
    id: overrides.id,
    definitionId: 'tree_broadleaf',
    definitionIndex: 0,
    ownerChunkKey: '0:0',
    localId: overrides.localId,
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    z: overrides.z ?? 0,
    scale: 1,
    rotationY: 0,
    foodKcal: 0,
    foodToxicity01: 0,
    harvestServings: 1,
  };
}

function fakeChunkData(resources: ChunkData['resources'][number][], _chunkSize: number): ChunkData {
  const resolution = 4;
  const vertexCount = (resolution + 1) * (resolution + 1);
  return {
    coordinate: { x: 0, z: 0 },
    key: '0:0',
    generationVersion: 'test',
    terrain: {
      resolution,
      heights: new Float32Array(vertexCount),
      waterHeights: new Float32Array(vertexCount).fill(NaN),
      colors: new Uint8Array(vertexCount * 3),
      fields: {
        elevation: new Uint8Array(vertexCount),
        slope: new Uint8Array(vertexCount),
        temperature: new Uint8Array(vertexCount),
        moisture: new Uint8Array(vertexCount),
        fertility: new Uint8Array(vertexCount),
        rockiness: new Uint8Array(vertexCount),
        vegetation: new Uint8Array(vertexCount),
        biome: new Uint8Array(vertexCount),
        region: new Uint8Array(vertexCount),
        walkable: new Uint8Array(vertexCount),
      },
      minHeightM: 0,
      maxHeightM: 0,
      hasWater: false,
    },
    resources,
    waterBodyIndices: [],
    biomeStats: { counts: new Uint16Array(1), dominantIndex: 0, walkableRatio: 1 },
    generationMs: 0,
  };
}
