import { describe, expect, it } from 'vitest';
import type { SpatialMemoryEntry, WorldRef } from '../components/cognitiveMemory.js';
import { nearestKnownFood, nearestKnownWater } from './spatialMemoryQuery.js';

function water(
  id: number,
  x: number,
  z: number,
  overrides: Partial<SpatialMemoryEntry> = {},
): SpatialMemoryEntry {
  return {
    id,
    kind: 'water',
    x,
    z,
    lastSeenTick: 0,
    confidence01: 1,
    precisionM: 1,
    encodedConfidence01: 1,
    encodedPrecisionM: 1,
    source: 'directPerception',
    ...overrides,
  };
}

function foodMemory(
  id: number,
  x: number,
  z: number,
  resourceId: string,
  overrides: Partial<SpatialMemoryEntry> = {},
): SpatialMemoryEntry {
  const worldRef: WorldRef = {
    type: 'resource',
    resourceId,
    ownerChunkKey: '0:0',
    localId: id,
  };
  return {
    id,
    kind: 'resource',
    x,
    z,
    lastSeenTick: 0,
    confidence01: 1,
    precisionM: 1,
    encodedConfidence01: 1,
    encodedPrecisionM: 1,
    source: 'directPerception',
    worldRef,
    foodCandidate: true,
    ...overrides,
  };
}

describe('nearestKnownWater', () => {
  it('retourne null quand aucun souvenir de rive n’existe', () => {
    expect(nearestKnownWater([], 0, 0)).toBeNull();
    // Une entrée d'un autre kind ne compte pas.
    expect(nearestKnownWater([foodMemory(0, 0, 0, 'x')], 0, 0)).toBeNull();
  });

  it('préfère le souvenir géographiquement le plus proche à confiance/précision égales', () => {
    const spatial = [water(0, 100, 0), water(1, 10, 0), water(2, 50, 0)];
    expect(nearestKnownWater(spatial, 0, 0)?.id).toBe(1);
  });

  /**
   * Le sens du score : un souvenir imprécis paie l'imprécision comme du déplacement
   * supplémentaire. Un souvenir plus proche mais très flou peut donc perdre contre un
   * souvenir plus lointain mais net.
   */
  it('un souvenir imprécis peut perdre contre un souvenir plus lointain mais net', () => {
    const flou = water(0, 20, 0, { precisionM: 60 }); // coût effectif ≈ 20+60 = 80
    const net = water(1, 40, 0, { precisionM: 1 }); //   coût effectif ≈ 40+1  = 41
    expect(nearestKnownWater([flou, net], 0, 0)?.id).toBe(net.id);
  });

  it('un souvenir à confiance basse perd contre un souvenir plus lointain mais confiant', () => {
    const doute = water(0, 20, 0, { confidence01: 0.1 }); // score ≈ 21 / 0.1 = 210
    const sûr = water(1, 100, 0); //                          score ≈ 101 / 1 = 101
    expect(nearestKnownWater([doute, sûr], 0, 0)?.id).toBe(sûr.id);
  });
});

describe('nearestKnownFood', () => {
  const alwaysFresh = (): false => false;

  it('retourne null sans souvenir de ressource', () => {
    expect(nearestKnownFood([], 0, 0, () => null, alwaysFresh)).toBeNull();
    expect(
      nearestKnownFood([water(0, 0, 0)], 0, 0, () => ({ foodKcal: 100 }), alwaysFresh),
    ).toBeNull();
  });

  it('écarte une entrée dont la ressource est épuisée dans WorldDelta', () => {
    const spatial = [foodMemory(0, 5, 0, 'mangée'), foodMemory(1, 50, 0, 'intacte')];
    const chosen = nearestKnownFood(
      spatial,
      0,
      0,
      () => ({ foodKcal: 100 }),
      (id) => id === 'mangée',
    );
    expect(chosen?.entry.id).toBe(1);
  });

  it('écarte une ressource qui ne présente pas une affordance alimentaire', () => {
    const spatial = [
      foodMemory(0, 5, 0, 'pierre', { foodCandidate: false }),
      foodMemory(1, 50, 0, 'baie'),
    ];
    const chosen = nearestKnownFood(
      spatial,
      0,
      0,
      (worldRef) => ({ foodKcal: worldRef.resourceId === 'pierre' ? 0 : 100 }),
      alwaysFresh,
    );
    expect(chosen?.entry.id).toBe(1);
  });

  it('écarte une entrée dont le monde ne trouve plus la ressource (spawn null)', () => {
    const spatial = [foodMemory(0, 5, 0, 'fantôme'), foodMemory(1, 50, 0, 'réelle')];
    const chosen = nearestKnownFood(
      spatial,
      0,
      0,
      (worldRef) => (worldRef.resourceId === 'fantôme' ? null : { foodKcal: 100 }),
      alwaysFresh,
    );
    expect(chosen?.entry.id).toBe(1);
  });

  it('applique le score confiance/précision comme nearestKnownWater', () => {
    const doute = foodMemory(0, 20, 0, 'a', { confidence01: 0.1 });
    const sûr = foodMemory(1, 100, 0, 'b');
    const chosen = nearestKnownFood([doute, sûr], 0, 0, () => ({ foodKcal: 100 }), alwaysFresh);
    expect(chosen?.entry.id).toBe(sûr.id);
  });

  it('préfère une nourriture apprise comme sûre à une piste toxique plus proche', () => {
    const suspecte = foodMemory(0, 5, 0, 'champignon');
    const sûre = foodMemory(1, 20, 0, 'baie');
    const chosen = nearestKnownFood(
      [suspecte, sûre],
      0,
      0,
      () => ({ foodKcal: 100 }),
      alwaysFresh,
      (entry) => (entry.worldRef?.resourceId === 'champignon' ? 0 : 1),
    );
    expect(chosen?.entry.id).toBe(sûre.id);
  });
});
