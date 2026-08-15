import { describe, expect, it } from 'vitest';
import { Activity, Human, Movement, Transform } from './components/index.js';
import { hashWorldState } from './debug/stateHash.js';
import { Simulation } from './simulation.js';

function makeSimulation(seed = 'test-seed', population = 12): Simulation {
  return new Simulation({ seed, population, config: { time: { gameSecondsPerTick: 1 } } });
}

describe('Simulation', () => {
  it('spawns the requested initial population', () => {
    const simulation = makeSimulation('spawn', 15);
    expect(simulation.humanCount).toBe(15);

    for (const entity of simulation.humanIds()) {
      expect(simulation.entities.hasComponent(entity, Human)).toBe(true);
      expect(simulation.entities.hasComponent(entity, Transform)).toBe(true);
      expect(simulation.entities.hasComponent(entity, Movement)).toBe(true);
      expect(simulation.entities.hasComponent(entity, Activity)).toBe(true);
    }
    simulation.dispose();
  });

  it('can start with an empty world', () => {
    const simulation = new Simulation({ seed: 'empty', spawnInitialPopulation: false });
    expect(simulation.humanCount).toBe(0);
    simulation.step(50);
    expect(simulation.clock.currentTick).toBe(50);
    simulation.dispose();
  });

  it('advances its clock one tick at a time', () => {
    const simulation = makeSimulation();
    simulation.start();

    expect(simulation.tick()).toBe(true);
    expect(simulation.clock.currentTick).toBe(1);

    simulation.step(9);
    expect(simulation.clock.currentTick).toBe(10);
    simulation.dispose();
  });

  it('does not advance while paused, and resumes cleanly', () => {
    const simulation = makeSimulation();
    simulation.start();
    simulation.step(5);
    simulation.pause();

    expect(simulation.tick()).toBe(false);
    expect(simulation.clock.currentTick).toBe(5);
    expect(simulation.isRunning).toBe(false);

    simulation.resume();
    expect(simulation.tick()).toBe(true);
    expect(simulation.clock.currentTick).toBe(6);
    simulation.dispose();
  });

  it('keeps step() usable while paused, for debugging', () => {
    const simulation = makeSimulation();
    simulation.start();
    simulation.pause();
    simulation.step(3);
    expect(simulation.clock.currentTick).toBe(3);
    simulation.dispose();
  });

  it('refuses to be used after dispose', () => {
    const simulation = makeSimulation();
    simulation.dispose();
    expect(() => simulation.tick()).toThrow(/disposed/);
  });

  it('keeps every human inside the world bounds', () => {
    const simulation = makeSimulation('bounds', 20);
    simulation.start();
    simulation.step(5000);

    const limit = simulation.world.bounds.halfSizeMeters + 0.001;
    for (const entity of simulation.humanIds()) {
      const transform = simulation.entities.getComponentOrThrow(entity, Transform);
      expect(Math.abs(transform.x)).toBeLessThanOrEqual(limit);
      expect(Math.abs(transform.z)).toBeLessThanOrEqual(limit);
    }
    simulation.dispose();
  });

  it('actually makes humans move over time', () => {
    const simulation = makeSimulation('movement', 10);
    const before = simulation.humanIds().map((entity) => ({
      ...simulation.entities.getComponentOrThrow(entity, Transform),
    }));

    simulation.start();
    simulation.step(2000);

    const after = simulation
      .humanIds()
      .map((entity) => simulation.entities.getComponentOrThrow(entity, Transform));
    const moved = after.filter((transform, index) => {
      const start = before[index]!;
      return Math.hypot(transform.x - start.x, transform.z - start.z) > 1;
    });

    expect(moved.length).toBeGreaterThan(0);
    simulation.dispose();
  });

  it('emits a HumanBorn event per initial human', () => {
    const simulation = new Simulation({ seed: 'events', population: 7 });
    expect(simulation.recorder.countsByName().HumanBorn).toBe(7);
    simulation.dispose();
  });
});

describe('Simulation determinism', () => {
  it('produces an identical world state for the same seed and tick count', () => {
    const a = makeSimulation('determinism', 18);
    const b = makeSimulation('determinism', 18);

    a.start();
    b.start();
    a.step(3000);
    b.step(3000);

    expect(hashWorldState(a)).toBe(hashWorldState(b));
    a.dispose();
    b.dispose();
  });

  it('reaches the same state whether ticks are run one by one or in batches', () => {
    const oneByOne = makeSimulation('batching', 12);
    const batched = makeSimulation('batching', 12);

    oneByOne.start();
    batched.start();
    for (let i = 0; i < 1500; i++) oneByOne.step(1);
    batched.step(1500);

    expect(hashWorldState(oneByOne)).toBe(hashWorldState(batched));
    oneByOne.dispose();
    batched.dispose();
  });

  it('produces a different world for a different seed', () => {
    const a = makeSimulation('seed-a', 12);
    const b = makeSimulation('seed-b', 12);

    a.start();
    b.start();
    a.step(500);
    b.step(500);

    expect(hashWorldState(a)).not.toBe(hashWorldState(b));
    a.dispose();
    b.dispose();
  });

  it('is not disturbed by pausing and resuming', () => {
    const straight = makeSimulation('pause-immune', 10);
    const interrupted = makeSimulation('pause-immune', 10);

    straight.start();
    straight.step(800);

    interrupted.start();
    interrupted.step(300);
    interrupted.pause();
    expect(interrupted.tick()).toBe(false);
    interrupted.resume();
    interrupted.step(500);

    expect(hashWorldState(interrupted)).toBe(hashWorldState(straight));
    straight.dispose();
    interrupted.dispose();
  });
});
