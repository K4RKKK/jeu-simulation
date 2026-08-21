import { describe, expect, it } from 'vitest';
import { scanForShorePoint } from './perceptionModel.js';

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
