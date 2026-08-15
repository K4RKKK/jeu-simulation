import { describe, expect, it } from 'vitest';
import { ProceduralGenerator } from '../core/proceduralGenerator.js';
import { hashChunk } from '../debug/proceduralDebugData.js';
import { chunkKey } from './chunkCoordinate.js';

/** Monde réduit : ces tests portent sur la mécanique de génération, pas sur l'équilibrage. */
function smallWorld(seed: string): ProceduralGenerator {
  return new ProceduralGenerator({ seed, overrides: { layout: { sizeChunks: 6 } } });
}

describe('ChunkGenerator — déterminisme', () => {
  it('produit deux fois le même chunk pour la même seed et la même coordonnée', () => {
    const a = smallWorld('determinism');
    const b = smallWorld('determinism');

    for (const coordinate of [
      { x: 0, z: 0 },
      { x: -2, z: 1 },
      { x: 2, z: -3 },
    ]) {
      expect(hashChunk(a.generateChunk(coordinate))).toBe(hashChunk(b.generateChunk(coordinate)));
    }
  });

  it('donne le même résultat quel que soit l’ordre de génération', () => {
    // La propriété centrale : un chunk ne dépend d'aucun autre.
    const forward = smallWorld('order');
    const backward = smallWorld('order');

    const coordinates = [
      { x: -1, z: -1 },
      { x: 0, z: 0 },
      { x: 1, z: 1 },
      { x: 2, z: 0 },
    ];
    const first = coordinates.map((coordinate) => hashChunk(forward.generateChunk(coordinate)));
    const second = [...coordinates]
      .reverse()
      .map((coordinate) => hashChunk(backward.generateChunk(coordinate)))
      .reverse();

    expect(second).toEqual(first);
  });

  it('produit des mondes différents pour des seeds différentes', () => {
    const a = smallWorld('seed-a').generateChunk({ x: 0, z: 0 });
    const b = smallWorld('seed-b').generateChunk({ x: 0, z: 0 });
    expect(hashChunk(a)).not.toBe(hashChunk(b));
  });

  it('n’émet jamais de valeur non finie', () => {
    const generator = smallWorld('finite');
    for (const coordinate of generator.bounds.allChunks().slice(0, 12)) {
      const chunk = generator.generateChunk(coordinate);
      for (const height of chunk.terrain.heights) expect(Number.isFinite(height)).toBe(true);
      for (const spawn of chunk.resources) {
        expect(Number.isFinite(spawn.x)).toBe(true);
        expect(Number.isFinite(spawn.y)).toBe(true);
        expect(Number.isFinite(spawn.z)).toBe(true);
        expect(spawn.scale).toBeGreaterThan(0);
      }
    }
  });
});

describe('ChunkGenerator — raccord entre chunks', () => {
  const generator = smallWorld('seams');
  const resolution = generator.config.layout.terrainResolution;
  const side = resolution + 1;

  it('fait coïncider exactement les hauteurs du bord est et du bord ouest', () => {
    const left = generator.generateChunk({ x: 0, z: 0 });
    const right = generator.generateChunk({ x: 1, z: 0 });

    for (let row = 0; row < side; row++) {
      const eastEdge = left.terrain.heights[row * side + resolution] as number;
      const westEdge = right.terrain.heights[row * side] as number;
      expect(eastEdge).toBe(westEdge);
    }
  });

  it('fait coïncider exactement les hauteurs du bord sud et du bord nord', () => {
    const near = generator.generateChunk({ x: 0, z: 0 });
    const far = generator.generateChunk({ x: 0, z: 1 });

    for (let column = 0; column < side; column++) {
      const southEdge = near.terrain.heights[resolution * side + column] as number;
      const northEdge = far.terrain.heights[column] as number;
      expect(southEdge).toBe(northEdge);
    }
  });

  it('fait coïncider aussi les champs et les biomes au bord', () => {
    const left = generator.generateChunk({ x: -1, z: 2 });
    const right = generator.generateChunk({ x: 0, z: 2 });

    for (let row = 0; row < side; row++) {
      expect(left.terrain.fields.moisture[row * side + resolution]).toBe(
        right.terrain.fields.moisture[row * side],
      );
      expect(left.terrain.fields.biome[row * side + resolution]).toBe(
        right.terrain.fields.biome[row * side],
      );
    }
  });

  it('raccorde le coin commun à quatre chunks', () => {
    const a = generator.generateChunk({ x: 0, z: 0 });
    const b = generator.generateChunk({ x: 1, z: 0 });
    const c = generator.generateChunk({ x: 0, z: 1 });
    const d = generator.generateChunk({ x: 1, z: 1 });

    const corner = a.terrain.heights[resolution * side + resolution] as number;
    expect(b.terrain.heights[resolution * side]).toBe(corner);
    expect(c.terrain.heights[resolution]).toBe(corner);
    expect(d.terrain.heights[0]).toBe(corner);
  });
});

describe('ChunkGenerator — ressources', () => {
  const generator = smallWorld('resources');
  const chunkSize = generator.config.layout.chunkSizeMeters;

  it('n’attribue jamais la même ressource à deux chunks', () => {
    const seen = new Map<string, string>();
    for (const coordinate of generator.bounds.allChunks()) {
      const chunk = generator.generateChunk(coordinate);
      for (const spawn of chunk.resources) {
        const previous = seen.get(spawn.id);
        expect(previous, `${spawn.id} déjà produit par ${previous}`).toBeUndefined();
        seen.set(spawn.id, chunk.key);
      }
    }
    expect(seen.size).toBeGreaterThan(100);
  });

  it('garde chaque ressource au voisinage immédiat de son chunk', () => {
    for (const coordinate of generator.bounds.allChunks().slice(0, 10)) {
      const chunk = generator.generateChunk(coordinate);
      const minX = coordinate.x * chunkSize;
      const minZ = coordinate.z * chunkSize;
      for (const spawn of chunk.resources) {
        // Le décalage aléatoire peut faire déborder de quelques mètres : c'est admis et
        // pris en compte par l'encodage réseau, mais pas au-delà.
        expect(spawn.x).toBeGreaterThan(minX - 8);
        expect(spawn.x).toBeLessThan(minX + chunkSize + 8);
        expect(spawn.z).toBeGreaterThan(minZ - 8);
        expect(spawn.z).toBeLessThan(minZ + chunkSize + 8);
      }
    }
  });

  it('respecte un espacement minimal à l’intérieur d’une catégorie', () => {
    const chunk = generator.generateChunk({ x: 0, z: 0 });
    const trees = chunk.resources.filter((spawn) => spawn.definitionId.startsWith('tree_'));

    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        const a = trees[i]!;
        const b = trees[j]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1.5);
      }
    }
  });

  it('ne place aucune ressource dans l’eau', () => {
    for (const coordinate of generator.bounds.allChunks().slice(0, 16)) {
      const chunk = generator.generateChunk(coordinate);
      for (const spawn of chunk.resources) {
        const height = generator.sampler.sampleHeight(spawn.x, spawn.z);
        expect(generator.hydrology.sampleWater(spawn.x, spawn.z, height)).toBeNull();
      }
    }
  });

  it('donne des identifiants stables entre deux générations', () => {
    const other = smallWorld('resources');
    const first = generator.generateChunk({ x: 1, z: -1 }).resources.map((spawn) => spawn.id);
    const second = other.generateChunk({ x: 1, z: -1 }).resources.map((spawn) => spawn.id);
    expect(second).toEqual(first);
  });

  it('renseigne la clé et la version de génération', () => {
    const chunk = generator.generateChunk({ x: 2, z: 2 });
    expect(chunk.key).toBe(chunkKey({ x: 2, z: 2 }));
    expect(chunk.generationVersion).toBe(generator.generationVersion);
  });

  /**
   * `localId` sert d'adresse compacte réseau pour désigner un spawn dans son chunk :
   * il doit être 0..count-1, sans trou ni doublon, et stable entre deux générations.
   */
  it('attribue à chaque spawn un localId 0..N-1 stable entre deux générations', () => {
    const other = smallWorld('resources');
    const first = generator.generateChunk({ x: 1, z: -1 }).resources;
    const second = other.generateChunk({ x: 1, z: -1 }).resources;

    const localIds = first.map((spawn) => spawn.localId);
    const expected = Array.from({ length: first.length }, (_, i) => i);
    expect([...localIds].sort((a, b) => a - b)).toEqual(expected);
    expect(new Set(localIds).size).toBe(localIds.length);

    // Stabilité entre deux instances de la même seed.
    expect(second.map((spawn) => spawn.localId)).toEqual(localIds);
  });

  it('lie chaque spawn à son chunk propriétaire', () => {
    const chunk = generator.generateChunk({ x: 1, z: -1 });
    for (const spawn of chunk.resources) {
      expect(spawn.ownerChunkKey).toBe(chunkKey({ x: 1, z: -1 }));
    }
  });
});

describe('ChunkGenerator — régions', () => {
  // Régions de 2 chunks (contre 6 par défaut) : le petit monde de test (6 chunks de
  // côté) en contient plusieurs, condition nécessaire pour vérifier qu'elles diffèrent.
  const generator = new ProceduralGenerator({
    seed: 'regions',
    overrides: { layout: { sizeChunks: 6 }, regions: { sizeChunks: 2 } },
  });

  it('peuple le champ region, borné à un octet', () => {
    const chunk = generator.generateChunk({ x: 0, z: 0 });
    expect(chunk.terrain.fields.region.length).toBe(chunk.terrain.fields.biome.length);
    for (const byte of chunk.terrain.fields.region) {
      expect(byte).toBeGreaterThanOrEqual(0);
      expect(byte).toBeLessThanOrEqual(255);
    }
  });

  it('donne le même octet à deux sommets connus de la même cellule macro', () => {
    // Région (0,0) : chunks (0,0) et (1,0) partagent la même région (sizeChunks=2).
    const left = generator.generateChunk({ x: 0, z: 0 });
    const right = generator.generateChunk({ x: 1, z: 0 });
    // Sommet le plus à l'est de "left" et le plus à l'ouest de "right" : tous deux à la
    // frontière x=64, strictement à l'intérieur de la même région (0..128).
    const resolution = generator.config.layout.terrainResolution;
    const side = resolution + 1;
    expect(left.terrain.fields.region[resolution]).toBe(right.terrain.fields.region[0]);
    expect(left.terrain.fields.region[side * resolution + resolution]).toBe(
      right.terrain.fields.region[side * resolution],
    );
  });

  it('correspond à ce que ProceduralGenerator.regionAt calcule pour la même position', () => {
    const chunk = generator.generateChunk({ x: 3, z: -2 });
    const worldX = chunk.coordinate.x * generator.config.layout.chunkSizeMeters;
    const worldZ = chunk.coordinate.z * generator.config.layout.chunkSizeMeters;
    const region = generator.regionAt(worldX, worldZ);
    // Deux mondes de MÊME seed doivent s'accorder sur la région d'un même point.
    const other = new ProceduralGenerator({
      seed: 'regions',
      overrides: { layout: { sizeChunks: 6 }, regions: { sizeChunks: 2 } },
    });
    expect(other.regionAt(worldX, worldZ)).toEqual(region);
  });
});
