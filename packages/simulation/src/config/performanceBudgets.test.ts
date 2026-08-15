import { describe, expect, it } from 'vitest';
import { DEFAULT_PERFORMANCE_BUDGETS, checkPerformanceBudgets } from './performanceBudgets.js';

describe('checkPerformanceBudgets', () => {
  it('reports no violation when every measurement stays within budget', () => {
    const violations = checkPerformanceBudgets({
      simulationTickMsAvg: 1,
      chunkGenerationMsP95: 50,
    });
    expect(violations).toEqual([]);
  });

  it('reports a violation with the exact budget and measured value', () => {
    const violations = checkPerformanceBudgets({ simulationTickMsAvg: 42 });
    expect(violations).toEqual([
      {
        metric: 'simulationTickMsAvg',
        budget: DEFAULT_PERFORMANCE_BUDGETS.simulationTickMsAvg,
        measured: 42,
      },
    ]);
  });

  it('ignores metrics that were not measured', () => {
    const violations = checkPerformanceBudgets({});
    expect(violations).toEqual([]);
  });

  it('accepts a custom budget set instead of the defaults', () => {
    const violations = checkPerformanceBudgets(
      { pathfindingMsPerRequestP95: 10 },
      { ...DEFAULT_PERFORMANCE_BUDGETS, pathfindingMsPerRequestP95: 5 },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.budget).toBe(5);
  });

  it('does not flag a measurement exactly at the budget (strictly greater only)', () => {
    const violations = checkPerformanceBudgets({
      simulationTickMsAvg: DEFAULT_PERFORMANCE_BUDGETS.simulationTickMsAvg,
    });
    expect(violations).toEqual([]);
  });
});
