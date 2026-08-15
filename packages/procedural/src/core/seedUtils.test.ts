import { describe, expect, it } from 'vitest';
import { HashDomain, HashSequence, hashCoords, hashString, unitFromHash } from './seedUtils.js';

describe('hachage déterministe', () => {
  it('produit la même valeur pour la même entrée', () => {
    expect(hashString('prehistory-01')).toBe(hashString('prehistory-01'));
    expect(hashCoords(1234, 5, -7)).toBe(hashCoords(1234, 5, -7));
  });

  it('sépare les entrées voisines', () => {
    const values = new Set<number>();
    for (let x = 0; x < 40; x++) values.add(hashCoords(99, x, 0));
    expect(values.size).toBe(40);
  });

  it('accepte les coordonnées négatives', () => {
    expect(Number.isFinite(hashCoords(1, -1000, -1000))).toBe(true);
    expect(hashCoords(1, -5, 3)).not.toBe(hashCoords(1, 5, 3));
  });

  it('reste dans [0, 1)', () => {
    for (let i = 0; i < 5000; i++) {
      const value = unitFromHash(hashCoords(7, i, i * 3));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('HashDomain', () => {
  it('isole les domaines : deux noms ne se ressemblent jamais', () => {
    const vegetation = new HashDomain('seed', 'vegetation');
    const rocks = new HashDomain('seed', 'rocks');

    let identical = 0;
    for (let i = 0; i < 500; i++) {
      if (vegetation.unit(i, 0) === rocks.unit(i, 0)) identical++;
    }
    expect(identical).toBe(0);
  });

  it('produit des tirages indépendants pour un même point via le sel', () => {
    const domain = new HashDomain('seed', 'trees');
    const position = domain.unitSalted(1, 4, 9);
    const rotation = domain.unitSalted(2, 4, 9);
    const scale = domain.unitSalted(3, 4, 9);

    expect(new Set([position, rotation, scale]).size).toBe(3);
    expect(domain.unitSalted(1, 4, 9)).toBe(position);
  });

  it('reproduit exactement la même valeur pour la même seed', () => {
    const a = new HashDomain('world-a', 'trees');
    const b = new HashDomain('world-a', 'trees');
    const c = new HashDomain('world-b', 'trees');

    expect(a.unit(12, -3)).toBe(b.unit(12, -3));
    expect(a.unit(12, -3)).not.toBe(c.unit(12, -3));
  });

  it('borne correctement les entiers', () => {
    const domain = new HashDomain('seed', 'int');
    for (let i = 0; i < 1000; i++) {
      const value = domain.int(5, i, 0);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
    }
    expect(() => domain.int(0, 1, 1)).toThrow(/positive bound/);
  });
});

describe('HashSequence', () => {
  it('rejoue la même séquence', () => {
    const first = new HashSequence(new HashDomain('seed', 'spawn'));
    const second = new HashSequence(new HashDomain('seed', 'spawn'));
    const take = (sequence: HashSequence): number[] =>
      Array.from({ length: 20 }, () => sequence.next());

    expect(take(first)).toEqual(take(second));
  });

  it('avance à chaque appel', () => {
    const sequence = new HashSequence(new HashDomain('seed', 'spawn'));
    const values = Array.from({ length: 50 }, () => sequence.next());
    expect(new Set(values).size).toBe(50);
  });
});
