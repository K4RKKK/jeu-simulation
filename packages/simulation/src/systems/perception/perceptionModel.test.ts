import { describe, expect, it } from 'vitest';
import type { MemoryComponent } from '../../components/index.js';
import {
  nearestFood,
  nearestWater,
  rememberFood,
  rememberWater,
  scanForShorePoint,
  type PerceptionMemoryConfig,
} from './perceptionModel.js';

const config: PerceptionMemoryConfig = {
  foodMemoryTtlTicks: 100,
  waterMemoryTtlTicks: 100,
  maxFoodEntries: 2,
  maxWaterEntries: 2,
};

function emptyMemory(): MemoryComponent {
  return {
    food: [],
    water: [],
    lastFoodScanX: null,
    lastFoodScanZ: null,
    lastWaterScanX: null,
    lastWaterScanZ: null,
  };
}

function food(resourceId: string, x: number, z: number) {
  return {
    resourceId,
    definitionId: 'berry_bush',
    ownerChunkKey: '0:0',
    localId: 0,
    x,
    z,
    foodKcal: 300,
  };
}

describe('scanForShorePoint', () => {
  const waterAt = (x: number, z: number): number => (x === 8 && z === 8 ? 0 : 1000);

  it('renvoie le point courant quand on est déjà sur une rive', () => {
    expect(scanForShorePoint(8, 8, 50, 8, 2.5, () => true, waterAt)).toEqual({ x: 8, z: 8 });
  });

  it('trouve le point de rive le plus proche par anneaux', () => {
    // (8, 8) est la seule rive : elle est sur le premier anneau depuis (0, 0).
    expect(scanForShorePoint(0, 0, 50, 8, 2.5, () => true, waterAt)).toEqual({ x: 8, z: 8 });
  });

  it('renvoie null quand aucune rive n’est dans le rayon', () => {
    expect(scanForShorePoint(100, 100, 50, 8, 2.5, () => true, waterAt)).toBeNull();
  });

  it('est déterministe : deux appels identiques renvoient le même point', () => {
    const a = scanForShorePoint(0, 0, 50, 8, 2.5, () => true, waterAt);
    const b = scanForShorePoint(0, 0, 50, 8, 2.5, () => true, waterAt);
    expect(a).toEqual(b);
  });

  it('écarte une rive dont l’approche directe traverse un obstacle', () => {
    const twoShores = (x: number, z: number): number =>
      (x === -8 && z === -8) || (x === -8 && z === 8) ? 0 : 1000;
    const isWalkable = (x: number, z: number): boolean => x !== -4 || z !== -4;

    expect(scanForShorePoint(0, 0, 50, 8, 2.5, isWalkable, twoShores)).toEqual({
      x: -8,
      z: 8,
    });
  });
});

describe('mémoire de nourriture', () => {
  it('mémorise, déduplique par ressource et rafraîchit la date de vue', () => {
    const memory = emptyMemory();
    rememberFood(memory, food('bush@1', 10, 10), 10, config);
    rememberFood(memory, food('bush@2', 20, 20), 10, config);
    rememberFood(memory, food('bush@1', 15, 15), 50, config); // revu, déplacé en fin

    expect(memory.food).toHaveLength(2);
    const refreshed = memory.food.find((entry) => entry.resourceId === 'bush@1');
    expect(refreshed).toMatchObject({ x: 15, z: 15, lastSeenTick: 50 });
    expect(memory.food[memory.food.length - 1]!.resourceId).toBe('bush@1');
  });

  it('oublie la plus ancienne entrée quand la capacité est dépassée', () => {
    const memory = emptyMemory();
    rememberFood(memory, food('a', 0, 0), 10, config);
    rememberFood(memory, food('b', 0, 0), 10, config);
    rememberFood(memory, food('c', 0, 0), 10, config);

    expect(memory.food.map((entry) => entry.resourceId)).toEqual(['b', 'c']);
  });

  it('oublie les entrées périmées au prochain usage', () => {
    const memory = emptyMemory();
    rememberFood(memory, food('a', 0, 0), 10, config);
    rememberFood(memory, food('b', 50, 50), 150, config); // 'a' a 140 ticks d'âge

    expect(memory.food.map((entry) => entry.resourceId)).toEqual(['b']);
  });

  it('ne propose pas une ressource cueillie ni une entrée périmée', () => {
    const memory = emptyMemory();
    rememberFood(memory, food('cueilli', 5, 5), 10, config);
    rememberFood(memory, food('vieux', 6, 6), 10, config);
    rememberFood(memory, food('frais', 7, 7), 200, config);

    // 'vieux' a expiré ; 'cueilli' est filtré par le monde.
    const nearest = nearestFood(
      memory,
      0,
      0,
      200,
      config,
      (resourceId) => resourceId === 'cueilli',
    );
    expect(nearest?.resourceId).toBe('frais');
  });

  it('renvoie la ressource mémorisée la plus proche', () => {
    const memory = emptyMemory();
    rememberFood(memory, food('loin', 80, 80), 200, config);
    rememberFood(memory, food('proche', 5, 5), 200, config);

    expect(nearestFood(memory, 0, 0, 200, config, () => false)?.resourceId).toBe('proche');
    expect(nearestFood(memory, 0, 0, 200, config, () => false)).toMatchObject({ x: 5, z: 5 });
  });
});

describe('mémoire de rives', () => {
  it('mémorise, déduplique par cellule de 4 m et borne la taille', () => {
    const memory = emptyMemory();
    rememberWater(memory, { x: 10, z: 10 }, 10, config);
    rememberWater(memory, { x: 11, z: 10 }, 20, config); // même cellule arrondie
    rememberWater(memory, { x: 30, z: 30 }, 30, config);
    rememberWater(memory, { x: 50, z: 50 }, 40, config);

    expect(memory.water).toHaveLength(2);
    expect(memory.water[0]).toMatchObject({ x: 30, z: 30, lastSeenTick: 30 });
    expect(memory.water[1]).toMatchObject({ x: 50, z: 50, lastSeenTick: 40 });
  });

  it('renvoie la rive mémorisée la plus proche, encore fraîche', () => {
    const memory = emptyMemory();
    rememberWater(memory, { x: 40, z: 40 }, 10, config);
    rememberWater(memory, { x: 8, z: 8 }, 200, config);

    expect(nearestWater(memory, 0, 0, 200, config)).toMatchObject({ x: 8, z: 8 });
  });
});
