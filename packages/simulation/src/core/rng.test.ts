import { describe, expect, it } from 'vitest';
import { RNG_STREAMS, RandomStream, WorldRng } from './rng.js';

function take(stream: RandomStream, count: number): number[] {
  return Array.from({ length: count }, () => stream.float());
}

describe('WorldRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new WorldRng('seed-alpha');
    const b = new WorldRng('seed-alpha');

    expect(take(a.humans, 50)).toEqual(take(b.humans, 50));
    expect(take(a.behavior, 50)).toEqual(take(b.behavior, 50));
  });

  it('produces different sequences for different seeds', () => {
    const a = new WorldRng('seed-alpha');
    const b = new WorldRng('seed-beta');

    expect(take(a.humans, 20)).not.toEqual(take(b.humans, 20));
  });

  it('keeps streams independent: consuming one does not shift another', () => {
    const reference = new WorldRng('isolation');
    const expected = take(reference.worldGeneration, 10);

    const disturbed = new WorldRng('isolation');
    // Un futur système de langage consommera beaucoup d'aléatoire : cela ne doit rien
    // changer au terrain déjà généré.
    take(disturbed.language, 5000);
    take(disturbed.disease, 137);

    expect(take(disturbed.worldGeneration, 10)).toEqual(expected);
  });

  it('gives every declared stream a distinct sequence', () => {
    const rng = new WorldRng('distinct');
    const firstDraws = RNG_STREAMS.map((name) => rng.stream(name).float());
    expect(new Set(firstDraws).size).toBe(RNG_STREAMS.length);
  });

  it('serializes and restores its full state', () => {
    const rng = new WorldRng('persistence');
    take(rng.humans, 17);
    take(rng.behavior, 5);

    const saved = rng.getState();
    const expected = [...take(rng.humans, 10), ...take(rng.behavior, 10)];

    const restored = new WorldRng('persistence');
    restored.setState(saved);
    expect([...take(restored.humans, 10), ...take(restored.behavior, 10)]).toEqual(expected);
  });

  it('rejects an unknown stream name', () => {
    const rng = new WorldRng('unknown');
    // @ts-expect-error — le nom de stream est contraint par le type, on teste la garde runtime.
    expect(() => rng.stream('nope')).toThrow(/Unknown RNG stream/);
  });
});

describe('RandomStream', () => {
  it('stays within bounds', () => {
    const stream = RandomStream.fromSeed('bounds', 'test');
    for (let i = 0; i < 2000; i++) {
      const value = stream.float();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);

      const integer = stream.int(3, 7);
      expect(integer).toBeGreaterThanOrEqual(3);
      expect(integer).toBeLessThanOrEqual(7);
      expect(Number.isInteger(integer)).toBe(true);
    }
  });

  it('covers the whole inclusive integer range', () => {
    const stream = RandomStream.fromSeed('coverage', 'test');
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(stream.int(0, 3));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('clamps gaussian draws', () => {
    const stream = RandomStream.fromSeed('gaussian', 'test');
    for (let i = 0; i < 1000; i++) {
      const value = stream.clampedGaussian(1.7, 0.2, 1.4, 2);
      expect(value).toBeGreaterThanOrEqual(1.4);
      expect(value).toBeLessThanOrEqual(2);
    }
  });

  it('shuffles deterministically and keeps every element', () => {
    const a = RandomStream.fromSeed('shuffle', 'test').shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = RandomStream.fromSeed('shuffle', 'test').shuffle([1, 2, 3, 4, 5, 6, 7, 8]);

    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('forks reproducible sub-streams', () => {
    const parentA = RandomStream.fromSeed('fork', 'test');
    const parentB = RandomStream.fromSeed('fork', 'test');

    expect(take(parentA.fork('human:1'), 8)).toEqual(take(parentB.fork('human:1'), 8));
    expect(take(parentA.fork('human:1'), 8)).not.toEqual(take(parentB.fork('human:2'), 8));
  });

  it('throws when picking from an empty array', () => {
    const stream = RandomStream.fromSeed('empty', 'test');
    expect(() => stream.pick([])).toThrow(/empty array/);
  });
});
