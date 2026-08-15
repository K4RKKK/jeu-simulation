import { describe, expect, it } from 'vitest';
import { PathCache } from './pathCache.js';

const start = { x: 0, z: 0 };
const goal = { x: 5, z: 5 };

describe('PathCache', () => {
  it('returns null on a miss and the path on a hit', () => {
    const cache = new PathCache(8);
    expect(cache.get(start, goal)).toBeNull();
    cache.set(start, goal, [{ x: 0, z: 0 }, { x: 5, z: 5 }]);
    expect(cache.get(start, goal)).toEqual([{ x: 0, z: 0 }, { x: 5, z: 5 }]);
  });

  it('returns the very same array on a hit (read-only contract)', () => {
    const cache = new PathCache(8);
    const path = [{ x: 0, z: 0 }, { x: 5, z: 5 }];
    cache.set(start, goal, path);
    expect(cache.get(start, goal)).toBe(path);
  });

  it('distinguishes start and goal keys', () => {
    const cache = new PathCache(8);
    cache.set(start, goal, [{ x: 0, z: 0 }]);
    expect(cache.get(goal, start)).toBeNull();
  });

  it('evicts the least recently used entry when full', () => {
    const cache = new PathCache(2);
    const a = { x: 0, z: 0 };
    const b = { x: 1, z: 1 };
    const c = { x: 2, z: 2 };
    cache.set(a, b, [a, b]);
    cache.set(b, c, [b, c]);
    // On relit (a,b) : (b,c) devient la plus ancienne.
    cache.get(a, b);
    cache.set(c, a, [c, a]);
    expect(cache.get(a, b)).not.toBeNull();
    expect(cache.get(b, c)).toBeNull();
    expect(cache.get(c, a)).not.toBeNull();
  });

  it('overwrites an existing key', () => {
    const cache = new PathCache(8);
    const first = [{ x: 0, z: 0 }];
    const second = [{ x: 0, z: 0 }, { x: 1, z: 1 }];
    cache.set(start, goal, first);
    cache.set(start, goal, second);
    expect(cache.get(start, goal)).toBe(second);
    expect(cache.size).toBe(1);
  });

  it('refuses a capacity below one', () => {
    expect(() => new PathCache(0)).toThrow();
  });
});