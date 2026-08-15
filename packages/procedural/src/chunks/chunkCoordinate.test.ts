import { describe, expect, it } from 'vitest';
import {
  chunkDistance,
  chunkKey,
  chunkToWorld,
  chunksInRadius,
  getLocalPosition,
  parseChunkKey,
  worldToChunk,
} from './chunkCoordinate.js';
import { WorldBounds } from './worldBounds.js';

const SIZE = 64;

describe('coordonnées de chunk', () => {
  it('associe une position monde à son chunk', () => {
    expect(worldToChunk(0, 0, SIZE)).toEqual({ x: 0, z: 0 });
    expect(worldToChunk(63.9, 63.9, SIZE)).toEqual({ x: 0, z: 0 });
    expect(worldToChunk(64, 0, SIZE)).toEqual({ x: 1, z: 0 });
    expect(worldToChunk(-1, -1, SIZE)).toEqual({ x: -1, z: -1 });
    expect(worldToChunk(-64, -64, SIZE)).toEqual({ x: -1, z: -1 });
    expect(worldToChunk(-65, 0, SIZE)).toEqual({ x: -2, z: 0 });
  });

  it('retrouve l’origine d’un chunk', () => {
    expect(chunkToWorld({ x: 12, z: -4 }, SIZE)).toEqual({ x: 768, z: -256 });
  });

  it('fait un aller-retour sur la clé', () => {
    expect(chunkKey({ x: 12, z: -4 })).toBe('12:-4');
    expect(parseChunkKey('12:-4')).toEqual({ x: 12, z: -4 });
    expect(() => parseChunkKey('douze')).toThrow(/Invalid chunk key/);
    expect(() => parseChunkKey(':3')).toThrow(/Invalid chunk key/);
  });

  it('donne une position locale toujours dans [0, taille)', () => {
    for (const x of [-200.5, -64, -0.1, 0, 31.7, 64, 129.9]) {
      const local = getLocalPosition(x, x, SIZE);
      expect(local.x).toBeGreaterThanOrEqual(0);
      expect(local.x).toBeLessThan(SIZE);
      expect(local.z).toBeGreaterThanOrEqual(0);
      expect(local.z).toBeLessThan(SIZE);
    }
  });

  it('mesure la distance en carrés de chunks', () => {
    expect(chunkDistance({ x: 0, z: 0 }, { x: 3, z: 1 })).toBe(3);
    expect(chunkDistance({ x: -2, z: -2 }, { x: 0, z: 0 })).toBe(2);
  });

  it('énumère un rayon du plus proche au plus lointain', () => {
    const chunks = chunksInRadius({ x: 0, z: 0 }, 2);
    expect(chunks).toHaveLength(25);
    expect(chunks[0]).toEqual({ x: 0, z: 0 });
    expect(chunkDistance({ x: 0, z: 0 }, chunks.at(-1)!)).toBe(2);
    expect(new Set(chunks.map(chunkKey)).size).toBe(25);
  });
});

describe('WorldBounds', () => {
  const bounds = new WorldBounds({
    sizeChunks: 8,
    chunkSizeMeters: 64,
    terrainResolution: 16,
    sampleLatticeMeters: 2,
  });

  it('centre le monde sur l’origine', () => {
    expect(bounds.sizeMeters).toBe(512);
    expect(bounds.halfSizeMeters).toBe(256);
    expect(bounds.minChunk).toBe(-4);
    expect(bounds.maxChunk).toBe(3);
    expect(bounds.chunkCount).toBe(64);
  });

  it('sait ce qui est dedans', () => {
    expect(bounds.contains(0, 0)).toBe(true);
    expect(bounds.contains(255.9, -255.9)).toBe(true);
    expect(bounds.contains(256, 0)).toBe(false);
    expect(bounds.containsChunk({ x: -4, z: 3 })).toBe(true);
    expect(bounds.containsChunk({ x: 4, z: 0 })).toBe(false);
  });

  it('ramène une position hors limites à l’intérieur', () => {
    expect(bounds.contains(bounds.clampX(9999), bounds.clampZ(-9999))).toBe(true);
  });

  it('énumère chaque chunk une seule fois', () => {
    const chunks = bounds.allChunks();
    expect(chunks).toHaveLength(64);
    expect(new Set(chunks.map(chunkKey)).size).toBe(64);
    for (const chunk of chunks) expect(bounds.containsChunk(chunk)).toBe(true);
  });

  it('refuse des dimensions absurdes', () => {
    const layout = {
      sizeChunks: 0,
      chunkSizeMeters: 64,
      terrainResolution: 16,
      sampleLatticeMeters: 2,
    };
    expect(() => new WorldBounds(layout)).toThrow(/positive/);
  });
});
