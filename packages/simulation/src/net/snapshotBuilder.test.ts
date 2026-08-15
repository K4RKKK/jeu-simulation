import { describe, expect, it } from 'vitest';
import { Transform } from '../components/index.js';
import { Simulation } from '../simulation.js';
import { buildHumanProfiles, buildHumanStates, humanStateEquals } from './snapshotBuilder.js';

function makeSimulation(): Simulation {
  return new Simulation({ seed: 'snapshot', population: 5 });
}

describe('snapshotBuilder', () => {
  it('produces one profile and one state per human', () => {
    const simulation = makeSimulation();
    expect(buildHumanProfiles(simulation)).toHaveLength(5);
    expect(buildHumanStates(simulation)).toHaveLength(5);
    simulation.dispose();
  });

  it('quantizes positions to the configured precision', () => {
    const simulation = makeSimulation();
    const entity = simulation.humanIds()[0]!;
    const transform = simulation.entities.getComponentOrThrow(entity, Transform);
    transform.x = 12.3456789;
    transform.z = -7.987654;
    transform.yaw = 1.23456789;

    const state = buildHumanStates(simulation).find((candidate) => candidate.id === entity)!;
    expect(state.x).toBe(12.35);
    expect(state.z).toBe(-7.99);
    expect(state.yaw).toBe(1.235);
    simulation.dispose();
  });

  it('carries the decision reason all the way to the wire', () => {
    const simulation = makeSimulation();
    simulation.start();
    simulation.step(200);

    for (const state of buildHumanStates(simulation)) {
      expect(state.reason.length).toBeGreaterThan(0);
    }
    simulation.dispose();
  });

  it('detects unchanged states so deltas stay small', () => {
    const simulation = makeSimulation();
    const before = buildHumanStates(simulation);
    const after = buildHumanStates(simulation);

    expect(before.every((state, index) => humanStateEquals(state, after[index]!))).toBe(true);
    simulation.dispose();
  });

  it('detects a state change', () => {
    const simulation = makeSimulation();
    const entity = simulation.humanIds()[0]!;
    const before = buildHumanStates(simulation).find((state) => state.id === entity)!;

    simulation.entities.getComponentOrThrow(entity, Transform).x += 5;
    const after = buildHumanStates(simulation).find((state) => state.id === entity)!;

    expect(humanStateEquals(before, after)).toBe(false);
    simulation.dispose();
  });

  it('ignores sub-quantum jitter, which would otherwise resend every entity each tick', () => {
    const simulation = makeSimulation();
    const entity = simulation.humanIds()[0]!;
    const before = buildHumanStates(simulation).find((state) => state.id === entity)!;

    simulation.entities.getComponentOrThrow(entity, Transform).x += 1e-6;
    const after = buildHumanStates(simulation).find((state) => state.id === entity)!;

    expect(humanStateEquals(before, after)).toBe(true);
    simulation.dispose();
  });
});
