import { describe, expect, it } from 'vitest';
import { variantForRotation } from './resourceVariant.js';

describe('variantForRotation', () => {
  it('returns the single variant when there is only one', () => {
    for (const rotation of [0, 1, 4, Math.PI * 2 - 0.01]) {
      expect(variantForRotation(rotation, 1)).toBe(0);
    }
  });

  it('covers every variant exactly once per full turn', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 600; i++) {
      seen.add(variantForRotation((i / 600) * Math.PI * 2, 3));
    }
    expect(seen).toEqual(new Set([0, 1, 2]));
  });

  it('maps the start of the turn to the first variant', () => {
    expect(variantForRotation(0, 3)).toBe(0);
  });

  it('stays within bounds for rotations close to a full turn', () => {
    expect(variantForRotation(Math.PI * 2 - 0.001, 3)).toBe(2);
  });

  it('is deterministic', () => {
    expect(variantForRotation(2.71, 3)).toBe(variantForRotation(2.71, 3));
  });
});
