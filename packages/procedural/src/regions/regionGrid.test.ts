import { describe, expect, it } from 'vitest';
import { HashDomain } from '../core/seedUtils.js';
import { regionAt, regionColorByte, regionKey } from './regionGrid.js';

describe('regionAt', () => {
  it('place deux points de la même cellule macro dans la même région', () => {
    const a = regionAt(10, 20, 100);
    const b = regionAt(90, 80, 100);
    expect(a).toEqual(b);
  });

  it('place deux points de cellules macro voisines dans des régions différentes', () => {
    const a = regionAt(50, 50, 100);
    const b = regionAt(150, 50, 100);
    expect(a).not.toEqual(b);
  });

  it('gère les positions négatives sans ambiguïté avec les positives', () => {
    const negative = regionAt(-10, -10, 100);
    const positive = regionAt(10, 10, 100);
    expect(negative).toEqual({ x: -1, z: -1 });
    expect(positive).toEqual({ x: 0, z: 0 });
    expect(negative).not.toEqual(positive);
  });

  it('est une fonction pure : même entrée, même sortie', () => {
    expect(regionAt(123.4, -56.7, 64)).toEqual(regionAt(123.4, -56.7, 64));
  });
});

describe('regionKey', () => {
  it('produit une clé "x:z" stable, même convention que chunkKey', () => {
    expect(regionKey({ x: 3, z: -2 })).toBe('3:-2');
  });
});

describe('regionColorByte', () => {
  it('reste dans [0, 255]', () => {
    const hash = new HashDomain('seed-a', 'region');
    for (let x = -20; x <= 20; x++) {
      for (let z = -20; z <= 20; z++) {
        const byte = regionColorByte({ x, z }, hash);
        expect(byte).toBeGreaterThanOrEqual(0);
        expect(byte).toBeLessThanOrEqual(255);
      }
    }
  });

  it('est déterministe pour une même seed', () => {
    const hashA = new HashDomain('seed-a', 'region');
    const hashB = new HashDomain('seed-a', 'region');
    expect(regionColorByte({ x: 3, z: -7 }, hashA)).toBe(regionColorByte({ x: 3, z: -7 }, hashB));
  });

  it('varie généralement avec la seed', () => {
    const hashA = new HashDomain('seed-a', 'region');
    const hashB = new HashDomain('seed-b', 'region');
    const coord = { x: 3, z: -7 };
    // Une seule coordonnée pourrait coïncider par hasard ; on vérifie sur un lot que ce
    // n'est pas la seed qui est ignorée.
    let differences = 0;
    for (let x = 0; x < 10; x++) {
      if (regionColorByte({ ...coord, x }, hashA) !== regionColorByte({ ...coord, x }, hashB)) {
        differences++;
      }
    }
    expect(differences).toBeGreaterThan(0);
  });
});
