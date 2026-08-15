import { describe, expect, it } from 'vitest';
import { SimulationMetrics } from './metrics.js';

describe('SimulationMetrics.reset', () => {
  it('retire aussi les ticks d’échauffement, pas seulement les systèmes', () => {
    const metrics = new SimulationMetrics();
    metrics.beginTick();
    metrics.beginSystem();
    metrics.endSystem('WarmupSystem');
    metrics.endTick();
    expect(metrics.snapshot(1).averageTickMs).toBeGreaterThanOrEqual(0);
    expect(metrics.snapshot(1).systems).toHaveLength(1);

    metrics.reset();

    const reset = metrics.snapshot(1);
    expect(reset.averageTickMs).toBe(0);
    expect(reset.tickMsMax).toBe(0);
    expect(reset.systems).toEqual([]);
  });
});
