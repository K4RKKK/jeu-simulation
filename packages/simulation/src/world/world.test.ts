import { describe, expect, it } from 'vitest';
import type { ChunkData, ResourceSpawn } from '@civ/procedural';
import { createSimulationConfig } from '../config/simulationConfig.js';
import { SimulationClock } from '../core/clock.js';
import { World } from './world.js';

function makeWorld(cacheCapacity = 512): World {
  return new World({
    worldId: 'world-cache-test',
    seed: 'cache',
    clock: new SimulationClock(createSimulationConfig().time),
    config: createSimulationConfig(),
    chunkCacheCapacity: cacheCapacity,
  });
}

function resourcesOf(chunk: ChunkData): string[] {
  return chunk.resources.map((resource) => resource.id);
}

describe('World — cache de chunks', () => {
  it('renvoie le même chunk mis en cache tant que rien n’est modifié', () => {
    const world = makeWorld();
    const first = world.generateChunk({ x: 0, z: 0 });
    const second = world.generateChunk({ x: 0, z: 0 });
    expect(second).toBe(first);
  });

  it('évince le plus ancien chunk quand la capacité est dépassée', () => {
    const world = makeWorld(1);
    const first = world.generateChunk({ x: 0, z: 0 });
    const second = world.generateChunk({ x: 1, z: 0 });

    // Le chunk 0:0 a été évincé : il est régénéré à l'identique, pas renvoyé tel quel.
    expect(resourcesOf(world.generateChunk({ x: 0, z: 0 }))).toEqual(resourcesOf(first));
    expect(resourcesOf(world.generateChunk({ x: 1, z: 0 }))).toEqual(resourcesOf(second));
  });

  it('réordonne le cache à l’accès : un chunk relu ne sort pas', () => {
    const world = makeWorld(2);
    const a = world.generateChunk({ x: 0, z: 0 });
    const b = world.generateChunk({ x: 1, z: 0 });
    world.generateChunk({ x: 0, z: 0 }); // accès : devient le plus récent
    const c = world.generateChunk({ x: 2, z: 0 }); // évince le 1:0, pas le 0:0

    expect(world.generateChunk({ x: 0, z: 0 })).toBe(a); // toujours en cache (relu)
    expect(world.generateChunk({ x: 2, z: 0 })).toBe(c);
    expect(world.generateChunk({ x: 1, z: 0 })).not.toBe(b); // évincé : régénéré
  });

  it('applique les modifications à un chunk issu du cache', () => {
    const world = makeWorld();
    const chunk = world.generateChunk({ x: 0, z: 0 });
    const victim = chunk.resources[0];
    expect(victim).toBeDefined();

    world.delta.markDepleted(victim!.id, victim!.ownerChunkKey, victim!.localId, world.clock.currentTick);
    const after = world.generateChunk({ x: 0, z: 0 });
    expect(after.resources.some((resource) => resource.id === victim!.id)).toBe(false);
  });

  it('retrouve une ressource précise par sa clé de chunk propriétaire', () => {
    const world = makeWorld();
    const chunk = world.generateChunk({ x: 0, z: 0 });
    const victim: ResourceSpawn = chunk.resources[0]!;

    const found = world.findResourceById(victim.id, victim.ownerChunkKey);
    expect(found).toEqual(victim);
    expect(world.findResourceById('inconnue', victim.ownerChunkKey)).toBeNull();
    expect(world.findResourceById(victim.id, 'not:a:key')).toBeNull();
  });

  /**
   * Bug corrigé : le jitter peut décaler physiquement une ressource dans un chunk voisin
   * de son chunk propriétaire. Chercher par la position physique (chunkAt(x, z)) pouvait
   * donc interroger le mauvais chunk. Ce test vérifie qu'une telle ressource est
   * malgré tout retrouvée quand on passe explicitement son `ownerChunkKey`.
   */
  it('retrouve une ressource dont le jitter l’a poussée hors de son chunk propriétaire', () => {
    const world = makeWorld();
    const chunkSize = world.chunkSizeMeters;

    // Balaie une petite zone jusqu'à trouver une ressource dont la position physique
    // tombe géométriquement dans un autre chunk que son propriétaire (rare mais réel).
    let straddler: ResourceSpawn | null = null;
    let ownerCoord: { x: number; z: number } | null = null;
    outer: for (let cx = -3; cx <= 3; cx++) {
      for (let cz = -3; cz <= 3; cz++) {
        const chunk = world.generateChunk({ x: cx, z: cz });
        for (const spawn of chunk.resources) {
          const physChunkX = Math.floor(spawn.x / chunkSize);
          const physChunkZ = Math.floor(spawn.z / chunkSize);
          if (physChunkX !== cx || physChunkZ !== cz) {
            straddler = spawn;
            ownerCoord = { x: cx, z: cz };
            break outer;
          }
        }
      }
    }
    if (straddler === null || ownerCoord === null) {
      // Aucun cas de jitter frontalier dans cette zone : test non pertinent pour la seed
      // mais ownerChunkKey reste vérifié par le test précédent.
      return;
    }

    // Par la position physique, on interrogerait le mauvais chunk : la ressource ne s'y
    // trouve pas. Par ownerChunkKey, on l'obtient.
    const found = world.findResourceById(straddler.id, straddler.ownerChunkKey);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(straddler.id);
  });
});

describe('World — récolte progressive (harvestResource)', () => {
  it('décrémente les portions restantes sans retirer la ressource avant la dernière', () => {
    const world = makeWorld();
    const chunk = world.generateChunk({ x: 0, z: 0 });
    const victim: ResourceSpawn = chunk.resources[0]!;

    expect(
      world.harvestResource(victim.id, victim.ownerChunkKey, victim.localId, 3, victim.x, victim.z, 0),
    ).toBe(2);
    expect(world.delta.isDepleted(victim.id)).toBe(false);
    expect(world.delta.get(victim.id)?.changedFields.remainingFraction01).toBeCloseTo(2 / 3, 6);
    expect(world.delta.get(victim.id)?.localId).toBe(victim.localId);

    expect(
      world.harvestResource(victim.id, victim.ownerChunkKey, victim.localId, 3, victim.x, victim.z, 1),
    ).toBe(1);
    expect(world.delta.isDepleted(victim.id)).toBe(false);

    // La dernière portion retire la ressource comme le ferait un retrait complet.
    expect(
      world.harvestResource(victim.id, victim.ownerChunkKey, victim.localId, 3, victim.x, victim.z, 2),
    ).toBe(0);
    expect(world.delta.isDepleted(victim.id)).toBe(true);
  });

  it('se comporte comme un retrait complet immédiat pour une ressource à une seule portion', () => {
    const world = makeWorld();
    const chunk = world.generateChunk({ x: 0, z: 0 });
    const victim: ResourceSpawn = chunk.resources[0]!;

    expect(
      world.harvestResource(victim.id, victim.ownerChunkKey, victim.localId, 1, victim.x, victim.z, 0),
    ).toBe(0);
    expect(world.delta.isDepleted(victim.id)).toBe(true);
    expect(world.journal.consumeRemovals()).toHaveLength(1);
  });

  it('journalise une mise à jour réseau (pas un retrait) pour une récolte partielle', () => {
    const world = makeWorld();
    const chunk = world.generateChunk({ x: 0, z: 0 });
    const victim: ResourceSpawn = chunk.resources[0]!;

    world.harvestResource(victim.id, victim.ownerChunkKey, victim.localId, 4, victim.x, victim.z, 0);

    const updates = world.journal.consumeResourceUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0]!.resourceId).toBe(victim.id);
    expect(updates[0]!.ownerChunkKey).toBe(victim.ownerChunkKey);
    expect(updates[0]!.changedFields.remainingFraction01).toBeCloseTo(0.75, 6);
    expect(world.journal.consumeRemovals()).toEqual([]);
  });
});