import type { ChunkPayload, WorldGenerationMetadata } from '@civ/shared';
import { encodeHeights, encodeInt16Array, encodeUint16Array, encodeUint8Array } from '@civ/shared';
import { describe, expect, it } from 'vitest';
import { ChunkStore } from './chunkStore.js';

function fakeMetadata(): WorldGenerationMetadata {
  return {
    generationVersion: 'test',
    seed: 'test-seed',
    sizeChunks: 1,
    chunkSizeMeters: 64,
    terrainResolution: 4,
    minChunk: 0,
    maxChunk: 0,
    waterLevelM: 0,
    regions: { sizeChunks: 2 },
    biomes: [],
    resources: [],
    waterBodies: [],
  };
}

/** Payload minimal mais structurellement valide : résolution 4, aucune ressource, pas d'eau. */
function fakeChunkPayload(
  key = '0:0',
  coordinate = { x: 0, z: 0 },
  waterBodyIndices: number[] = [],
): ChunkPayload {
  const resolution = 4;
  const vertexCount = (resolution + 1) * (resolution + 1);
  const empty8 = encodeUint8Array(new Uint8Array(vertexCount));
  return {
    key,
    coordinate,
    terrain: {
      resolution,
      heights: encodeHeights(new Float32Array(vertexCount)),
      waterHeights: encodeHeights(new Float32Array(vertexCount).fill(NaN)),
      colors: encodeUint8Array(new Uint8Array(vertexCount * 3)),
      fields: {
        elevation: empty8,
        slope: empty8,
        temperature: empty8,
        moisture: empty8,
        fertility: empty8,
        rockiness: empty8,
        vegetation: empty8,
        biome: empty8,
        region: empty8,
        walkable: empty8,
      },
      minHeightM: 0,
      maxHeightM: 0,
      hasWater: false,
    },
    resources: {
      count: 0,
      definitionIndex: encodeUint8Array(new Uint8Array(0)),
      localId: encodeUint16Array(new Uint16Array(0)),
      x: encodeUint16Array(new Uint16Array(0)),
      z: encodeUint16Array(new Uint16Array(0)),
      y: encodeInt16Array(new Int16Array(0)),
      scale: encodeUint8Array(new Uint8Array(0)),
      rotation: encodeUint8Array(new Uint8Array(0)),
    },
    waterBodyIndices,
    dominantBiomeIndex: 0,
    walkableRatio: 1,
    generationMs: 0,
  };
}

describe('ChunkStore — monde réellement observé', () => {
  it('compte les régions uniques reçues, pas les chunks actuellement chargés', () => {
    const store = new ChunkStore();
    store.setMetadata(fakeMetadata());
    store.apply(fakeChunkPayload('0:0', { x: 0, z: 0 }));
    store.apply(fakeChunkPayload('1:0', { x: 1, z: 0 })); // même région (taille 2)
    store.apply(fakeChunkPayload('2:0', { x: 2, z: 0 }));

    expect(store.size).toBe(3);
    expect(store.observedRegionCount).toBe(2);

    store.remove(['0:0', '1:0', '2:0']);
    expect(store.size).toBe(0);
    expect(store.observedRegionCount).toBe(2);
  });

  it("compte seulement les étendues d'eau apparues dans un chunk reçu", () => {
    const store = new ChunkStore();
    store.setMetadata(fakeMetadata());
    store.apply(fakeChunkPayload('0:0', { x: 0, z: 0 }, [2, 7]));
    store.apply(fakeChunkPayload('1:0', { x: 1, z: 0 }, [7]));

    expect(store.observedWaterBodyCount).toBe(2);
  });

  it('réinitialise les observations quand les métadonnées désignent un nouveau monde', () => {
    const store = new ChunkStore();
    store.setMetadata(fakeMetadata());
    store.apply(fakeChunkPayload('0:0', { x: 0, z: 0 }, [2]));

    store.setMetadata({ ...fakeMetadata(), seed: 'another-world' });

    expect(store.observedRegionCount).toBe(0);
    expect(store.observedWaterBodyCount).toBe(0);
  });
});

describe('ChunkStore — sentiers (trails)', () => {
  it('utilise la résolution sentinelle 1 quand le payload n’a pas de champ `trails`', () => {
    const store = new ChunkStore();
    store.setMetadata(fakeMetadata());
    store.apply(fakeChunkPayload());

    expect(store.get('0:0')!.trails).toEqual({ resolution: 1, wear: new Uint8Array(1) });
  });

  it('reconstitue une grille dense locale depuis les cellules creuses transmises', () => {
    const store = new ChunkStore();
    store.setMetadata(fakeMetadata());
    const payload = fakeChunkPayload();
    payload.trails = { resolution: 4, cells: [{ index: 5, wear: 200 }] };
    store.apply(payload);

    const chunk = store.get('0:0')!;
    expect(chunk.trails.resolution).toBe(4);
    expect(chunk.trails.wear).toHaveLength(16);
    expect(chunk.trails.wear[5]).toBe(200);
    expect(chunk.trails.wear[0]).toBe(0);
  });

  describe('applyTrailUpdate', () => {
    it('met à jour les cellules quand la résolution correspond déjà', () => {
      const store = new ChunkStore();
      store.setMetadata(fakeMetadata());
      const payload = fakeChunkPayload();
      payload.trails = { resolution: 4, cells: [{ index: 5, wear: 200 }] };
      store.apply(payload);

      const applied = store.applyTrailUpdate('0:0', 4, [{ index: 5, wear: 255 }]);
      expect(applied).toBe(true);
      expect(store.get('0:0')!.trails.wear[5]).toBe(255);
    });

    /**
     * Cas ajouté par l'optimisation « payload absent quand vide » : un chunk chargé
     * sans usure connue porte la résolution sentinelle 1 (voir `apply`). Sa toute
     * première mise à jour révèle la résolution réelle — elle ne doit PAS être
     * rejetée comme une désynchronisation.
     */
    it('adopte la résolution réelle à la première usure d’un chunk chargé sans `trails`', () => {
      const store = new ChunkStore();
      store.setMetadata(fakeMetadata());
      store.apply(fakeChunkPayload()); // pas de trails → résolution 1

      const applied = store.applyTrailUpdate('0:0', 4, [{ index: 3, wear: 100 }]);

      expect(applied).toBe(true);
      const chunk = store.get('0:0')!;
      expect(chunk.trails.resolution).toBe(4);
      expect(chunk.trails.wear).toHaveLength(16);
      expect(chunk.trails.wear[3]).toBe(100);
    });

    it('rejette une mise à jour dont la résolution ne correspond ni à la courante ni à la sentinelle', () => {
      const store = new ChunkStore();
      store.setMetadata(fakeMetadata());
      const payload = fakeChunkPayload();
      payload.trails = { resolution: 4, cells: [] };
      store.apply(payload);

      expect(store.applyTrailUpdate('0:0', 8, [{ index: 0, wear: 100 }])).toBe(false);
    });

    it('renvoie `false` pour un chunk inconnu', () => {
      const store = new ChunkStore();
      store.setMetadata(fakeMetadata());
      expect(store.applyTrailUpdate('9:9', 4, [{ index: 0, wear: 100 }])).toBe(false);
    });
  });
});
