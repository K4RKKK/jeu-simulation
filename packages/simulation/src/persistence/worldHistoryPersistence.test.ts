import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation.js';

describe('WorldHistory — persistance', () => {
  it('survit à un cycle capture/restauration sans dépendre du navigateur', () => {
    const source = new Simulation({ seed: 'history-save', population: 2 });
    source.start();
    const snapshot = source.captureSnapshot();

    const restored = new Simulation({
      seed: 'history-save',
      population: 0,
      spawnInitialPopulation: false,
    });
    restored.restoreSnapshot(snapshot);

    expect(restored.history.getState()).toEqual(source.history.getState());
    expect(restored.history.values().map((event) => event.name)).toEqual([
      'HumanBorn',
      'HumanBorn',
      'SimulationStarted',
    ]);

    source.dispose();
    restored.dispose();
  });

  it('charge progressivement une sauvegarde v9 antérieure sans champ history', () => {
    const source = new Simulation({ seed: 'legacy-history', population: 1 });
    source.start();
    const { history: _omittedHistory, ...legacySnapshot } = source.captureSnapshot();

    const restored = new Simulation({
      seed: 'legacy-history',
      population: 0,
      spawnInitialPopulation: false,
    });
    restored.restoreSnapshot(legacySnapshot);

    expect(restored.history.values()).toEqual([]);
    source.dispose();
    restored.dispose();
  });
});
