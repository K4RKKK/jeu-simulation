import { describe, expect, it } from 'vitest';
import { median, summarizeBenchmarkSamples } from './benchmarkStats.js';

describe('benchmarkStats', () => {
  it('calcule la médiane sans dépendre de l’ordre des échantillons', () => {
    expect(median([9, 1, 5])).toBe(5);
    expect(median([8, 2, 4, 6])).toBe(5);
    expect(median([])).toBe(0);
  });

  it('agrège séparément les ticks et chaque système', () => {
    const summary = summarizeBenchmarkSamples([
      {
        averageTickMs: 8,
        tickMsP95: 12,
        tickMsP99: 18,
        tickMsMax: 25,
        systems: [{ name: 'PathfindingSystem', averageMs: 5 }],
      },
      {
        averageTickMs: 4,
        tickMsP95: 8,
        tickMsP99: 10,
        tickMsMax: 15,
        systems: [{ name: 'PathfindingSystem', averageMs: 2 }],
      },
      {
        averageTickMs: 6,
        tickMsP95: 10,
        tickMsP99: 14,
        tickMsMax: 20,
        systems: [{ name: 'PathfindingSystem', averageMs: 3 }],
      },
    ]);

    expect(summary.averageTickMs).toBe(6);
    expect(summary.tickMsP99).toBe(14);
    expect(summary.minAverageTickMs).toBe(4);
    expect(summary.maxAverageTickMs).toBe(8);
    expect(summary.systems[0]).toEqual({ name: 'PathfindingSystem', averageMs: 3 });
  });
});
