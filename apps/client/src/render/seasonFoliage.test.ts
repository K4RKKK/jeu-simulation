import { describe, expect, it } from 'vitest';
import { seasonFoliageTint } from './seasonFoliage.js';

describe('seasonFoliageTint', () => {
  it('keeps evergreens unchanged in every season', () => {
    for (const season of ['printemps', 'été', 'automne', 'hiver'] as const) {
      const { r, g, b } = seasonFoliageTint(season, false);
      expect([r, g, b]).toEqual([1, 1, 1]);
    }
  });

  it('is the identity in summer', () => {
    const { r, g, b } = seasonFoliageTint('été', true);
    expect([r, g, b]).toEqual([1, 1, 1]);
  });

  it('turns autumn foliage redder than its green base', () => {
    const autumn = seasonFoliageTint('automne', true);
    const summer = seasonFoliageTint('été', true);
    expect(autumn.r).toBeGreaterThan(summer.r);
    expect(autumn.g).toBeLessThan(summer.g);
    expect(autumn.b).toBeLessThan(summer.b);
  });

  it('dims winter foliage instead of saturating it', () => {
    const winter = seasonFoliageTint('hiver', true);
    expect(winter.r).toBeLessThan(0.8);
    expect(winter.g).toBeLessThan(0.8);
  });
});
