import { describe, expect, it } from 'vitest';
import { instanceTint } from './instanceTint.js';

describe('instanceTint', () => {
  it('varies between distinct rotations', () => {
    const tints = [0, 0.5, 1.5, 3, 4.5, 6].map((rotation) => instanceTint(rotation).getHex());
    expect(new Set(tints).size).toBeGreaterThan(1);
  });

  it('stays within a subtle range around white', () => {
    for (let rotation = 0; rotation < Math.PI * 2; rotation += 0.05) {
      const { r, g, b } = instanceTint(rotation);
      for (const channel of [r, g, b]) {
        expect(channel).toBeGreaterThan(0.85);
        expect(channel).toBeLessThan(1.15);
      }
    }
  });

  it('is deterministic', () => {
    expect(instanceTint(2.4).getHex()).toBe(instanceTint(2.4).getHex());
  });
});
