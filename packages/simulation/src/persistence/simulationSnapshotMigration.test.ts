import { describe, expect, it } from 'vitest';
import { CognitiveKnowledge, CognitiveMemory, HumanCognition } from '../components/index.js';
import { Simulation } from '../simulation.js';
import { migrateSnapshotV9ToV10, type SimulationSnapshot } from './simulationSnapshot.js';

function makeSimulation(seed: string): Simulation {
  return new Simulation({ seed, population: 3, config: { time: { gameSecondsPerTick: 1 } } });
}

/** Simule une sauvegarde v9 : un snapshot v10 réel, privé de ses trois entrées cognitives. */
function asV9Snapshot(snapshot: SimulationSnapshot): SimulationSnapshot {
  const {
    CognitiveMemory: _m,
    CognitiveKnowledge: _k,
    HumanCognition: _c,
    ...rest
  } = snapshot.entities.components;
  return {
    ...snapshot,
    version: 9,
    entities: { ...snapshot.entities, components: rest },
  };
}

describe('migrateSnapshotV9ToV10', () => {
  it('ajoute les trois composants cognitifs, vides, pour chaque humain existant', () => {
    const simulation = makeSimulation('migration-v9-v10');
    const humanIds = simulation.humanIds();
    const v9 = asV9Snapshot(simulation.captureSnapshot());
    simulation.dispose();

    expect(v9.entities.components.CognitiveMemory).toBeUndefined();

    const migrated = migrateSnapshotV9ToV10(v9);

    expect(migrated.version).toBe(10);
    const byId = <T>(name: string): Map<number, T> =>
      new Map((migrated.entities.components[name] ?? []) as [number, T][]);
    const memories = byId('CognitiveMemory');
    const knowledges = byId('CognitiveKnowledge');
    const cognitions = byId('HumanCognition');

    for (const id of humanIds) {
      expect(memories.get(id)).toEqual({ nextMemoryId: 0, spatial: [], episodic: [], social: [] });
      expect(knowledges.get(id)).toEqual({ nextBeliefId: 0, beliefs: [] });
      expect(cognitions.get(id)).toEqual({ activeGoalId: null, decisionReason: null });
    }
  });

  it('ne touche pas le snapshot original (pure)', () => {
    const simulation = makeSimulation('migration-v9-purity');
    const v9 = asV9Snapshot(simulation.captureSnapshot());
    simulation.dispose();

    migrateSnapshotV9ToV10(v9);

    expect(v9.version).toBe(9);
    expect(v9.entities.components.CognitiveMemory).toBeUndefined();
  });

  it('refuse une version différente de 9', () => {
    const simulation = makeSimulation('migration-wrong-version');
    const snapshot = simulation.captureSnapshot(); // déjà v10
    simulation.dispose();

    expect(() => migrateSnapshotV9ToV10(snapshot)).toThrow();
  });

  it('Simulation.restoreSnapshot migre automatiquement une sauvegarde v9', () => {
    const source = makeSimulation('migration-end-to-end');
    source.start();
    source.step(50);
    const v9 = asV9Snapshot(source.captureSnapshot());
    const humanIds = source.humanIds();
    source.dispose();

    const target = makeSimulation('migration-end-to-end');
    expect(() => target.restoreSnapshot(v9)).not.toThrow();

    for (const id of humanIds) {
      expect(target.entities.getComponentOrThrow(id, CognitiveMemory)).toEqual({
        nextMemoryId: 0,
        spatial: [],
        episodic: [],
        social: [],
      });
      expect(target.entities.getComponentOrThrow(id, CognitiveKnowledge)).toEqual({
        nextBeliefId: 0,
        beliefs: [],
      });
      expect(target.entities.getComponentOrThrow(id, HumanCognition)).toEqual({
        activeGoalId: null,
        decisionReason: null,
      });
    }
    target.dispose();
  });
});
