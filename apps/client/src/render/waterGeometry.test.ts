import { describe, expect, it } from 'vitest';
import { buildWaterSurface } from './waterGeometry.js';

describe('buildWaterSurface', () => {
  it('does not emit a complete cell when only one corner is wet', () => {
    const data = buildWaterSurface({
      resolution: 1,
      chunkSizeMeters: 4,
      terrainHeights: new Float32Array([0, 1, 1, 1]),
      waterHeights: new Float32Array([0.5, Number.NaN, Number.NaN, Number.NaN]),
    });

    expect(data).not.toBeNull();
    expect((data?.positions.length ?? 0) / 9).toBe(1);
    const xs = [...(data?.positions ?? [])].filter((_, index) => index % 3 === 0);
    const zs = [...(data?.positions ?? [])].filter((_, index) => index % 3 === 2);
    expect(Math.max(...xs)).toBeLessThan(4);
    expect(Math.max(...zs)).toBeLessThan(4);
  });

  it('keeps the two triangles of a fully submerged cell', () => {
    const data = buildWaterSurface({
      resolution: 1,
      chunkSizeMeters: 4,
      terrainHeights: new Float32Array([0, 0, 0, 0]),
      waterHeights: new Float32Array([1, 1, 1, 1]),
    });

    expect((data?.positions.length ?? 0) / 9).toBe(2);
    expect([...(data?.depths ?? [])].every((depth) => depth === 1)).toBe(true);
  });

  it('returns no geometry for a dry cell', () => {
    expect(
      buildWaterSurface({
        resolution: 1,
        chunkSizeMeters: 4,
        terrainHeights: new Float32Array([0, 0, 0, 0]),
        waterHeights: new Float32Array(4).fill(Number.NaN),
      }),
    ).toBeNull();
  });
});
