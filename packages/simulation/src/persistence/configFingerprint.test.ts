import { describe, expect, it } from 'vitest';
import { computeConfigFingerprint } from './configFingerprint.js';

describe('computeConfigFingerprint', () => {
  const worldShape = { sizeMeters: 1536, chunkSizeMeters: 64 };

  it('is stable across independent calls with the same input', () => {
    const config = { movement: { walkSpeedMps: 1.4 }, pathfinding: { tileSizeMeters: 2 } };
    const a = computeConfigFingerprint(config, worldShape);
    const b = computeConfigFingerprint(config, worldShape);
    expect(a).toBe(b);
  });

  it('is insensitive to object key order (canonical stringify)', () => {
    const a = computeConfigFingerprint(
      { movement: { walkSpeedMps: 1.4, trailWearPerMeter: 0.01 } },
      worldShape,
    );
    const b = computeConfigFingerprint(
      { movement: { trailWearPerMeter: 0.01, walkSpeedMps: 1.4 } },
      worldShape,
    );
    expect(a).toBe(b);
  });

  it('changes when a config value changes (the exact bug scenario reported)', () => {
    const before = computeConfigFingerprint({ movement: { walkSpeedMps: 1.4 } }, worldShape);
    const after = computeConfigFingerprint({ movement: { walkSpeedMps: 1.8 } }, worldShape);
    expect(before).not.toBe(after);
  });

  it('changes when the world geometry changes even if config is identical', () => {
    const config = { movement: { walkSpeedMps: 1.4 } };
    const a = computeConfigFingerprint(config, { sizeMeters: 1536, chunkSizeMeters: 64 });
    const b = computeConfigFingerprint(config, { sizeMeters: 2048, chunkSizeMeters: 64 });
    expect(a).not.toBe(b);
  });

  it('is insensitive to array element order changes only if actually reordered (arrays stay positional)', () => {
    const a = computeConfigFingerprint({ list: [1, 2, 3] }, worldShape);
    const b = computeConfigFingerprint({ list: [3, 2, 1] }, worldShape);
    expect(a).not.toBe(b);
  });
});
