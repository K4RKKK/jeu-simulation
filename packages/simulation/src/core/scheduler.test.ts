import { describe, expect, it } from 'vitest';
import { DEFAULT_SIMULATION_CONFIG, type SystemFrequency } from '../config/simulationConfig.js';
import { SimulationScheduler } from './scheduler.js';
import type { SimulationSystem, SystemUpdateContext } from './system.js';

const schedulerConfig = { intervals: { fast: 1, medium: 5, slow: 25, verySlow: 200 } };

class RecordingSystem implements SimulationSystem {
  readonly ticks: number[] = [];
  readonly deltas: number[] = [];

  constructor(
    readonly name: string,
    readonly frequency: SystemFrequency,
  ) {}

  update(context: SystemUpdateContext): void {
    this.ticks.push(context.tick);
    this.deltas.push(context.deltaGameSeconds);
  }
}

function makeContext(tick: number, deltaGameSeconds: number): SystemUpdateContext {
  // Le scheduler ne lit que `tick` et `deltaGameSeconds` : le reste du contexte n'est pas
  // nécessaire pour tester l'ordonnancement lui-même.
  return { tick, deltaGameSeconds } as unknown as SystemUpdateContext;
}

function runTicks(scheduler: SimulationScheduler, count: number, gameSecondsPerTick = 1): void {
  for (let tick = 1; tick <= count; tick++) {
    scheduler.run(tick, gameSecondsPerTick, (delta) => makeContext(tick, delta));
  }
}

describe('SimulationScheduler', () => {
  it('runs a fast system on every tick', () => {
    const scheduler = new SimulationScheduler(schedulerConfig);
    const system = new RecordingSystem('fast', 'fast');
    scheduler.register(system);

    runTicks(scheduler, 5);
    expect(system.ticks).toEqual([1, 2, 3, 4, 5]);
  });

  it('runs a slower system at its configured interval', () => {
    const scheduler = new SimulationScheduler(schedulerConfig);
    const system = new RecordingSystem('medium', 'medium');
    scheduler.register(system);

    runTicks(scheduler, 20);
    expect(system.ticks).toEqual([5, 10, 15, 20]);
  });

  it('spreads systems of the same frequency across different ticks', () => {
    const scheduler = new SimulationScheduler(schedulerConfig);
    const a = new RecordingSystem('a', 'medium');
    const b = new RecordingSystem('b', 'medium');
    const c = new RecordingSystem('c', 'medium');
    scheduler.register(a);
    scheduler.register(b);
    scheduler.register(c);

    runTicks(scheduler, 15);

    expect(a.ticks).toEqual([5, 10, 15]);
    expect(b.ticks).toEqual([1, 6, 11]);
    expect(c.ticks).toEqual([2, 7, 12]);
  });

  it('passes the elapsed game time since the previous run of that system', () => {
    const scheduler = new SimulationScheduler(schedulerConfig);
    const system = new RecordingSystem('medium', 'medium');
    scheduler.register(system);

    runTicks(scheduler, 15, 0.5);

    // 5 ticks × 0,5 s de jeu = 2,5 s à chaque exécution.
    expect(system.deltas).toEqual([2.5, 2.5, 2.5]);
  });

  it('preserves registration order within a tick', () => {
    const scheduler = new SimulationScheduler(schedulerConfig);
    const order: string[] = [];

    const makeSystem = (name: string): SimulationSystem => ({
      name,
      frequency: 'fast',
      update: () => order.push(name),
    });

    scheduler.register(makeSystem('decide'));
    scheduler.register(makeSystem('move'));
    runTicks(scheduler, 1);

    expect(order).toEqual(['decide', 'move']);
  });

  it('rejects duplicate system names', () => {
    const scheduler = new SimulationScheduler(schedulerConfig);
    scheduler.register(new RecordingSystem('same', 'fast'));
    expect(() => scheduler.register(new RecordingSystem('same', 'slow'))).toThrow(
      /already registered/,
    );
  });

  it('resolves every frequency declared in the default configuration', () => {
    const scheduler = new SimulationScheduler(DEFAULT_SIMULATION_CONFIG.scheduler);
    for (const frequency of ['fast', 'medium', 'slow', 'verySlow'] as const) {
      expect(scheduler.intervalFor(frequency)).toBeGreaterThanOrEqual(1);
    }
  });

  /**
   * Bug de persistance évité : sans restaurer `lastRunTick`/`hasRun`, le premier tick
   * après un chargement recalculerait `elapsedTicks` depuis zéro (comme si le système
   * n'avait jamais tourné), lui donnant un `deltaGameSeconds` bien plus grand que la
   * réalité — un métabolisme qui intègre d'un coup des heures de jeu.
   */
  it('round-trips getState/setState so the next run uses the correct elapsed time', () => {
    const scheduler = new SimulationScheduler(schedulerConfig);
    const system = new RecordingSystem('medium', 'medium');
    scheduler.register(system);
    runTicks(scheduler, 12); // dernière exécution au tick 10 (interval=5, phase=0)

    const state = scheduler.getState();

    const restored = new SimulationScheduler(schedulerConfig);
    const restoredSystem = new RecordingSystem('medium', 'medium');
    restored.register(restoredSystem);
    restored.setState(state);

    // Sans setState, le prochain run au tick 15 calculerait elapsedTicks=5 (comme la
    // source) UNIQUEMENT si hasRun/lastRunTick sont corrects. On le vérifie directement.
    restored.run(15, 1, (delta) => makeContext(15, delta));
    expect(restoredSystem.deltas).toEqual([5]); // 15 - 10 = 5 ticks, pas 15
  });

  it('ignores unknown system names in a restored state without throwing', () => {
    const scheduler = new SimulationScheduler(schedulerConfig);
    scheduler.register(new RecordingSystem('known', 'fast'));

    expect(() =>
      scheduler.setState({
        systems: [{ name: 'ghost-system', lastRunTick: 999, hasRun: true }],
      }),
    ).not.toThrow();
  });
});
