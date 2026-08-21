import { describe, expect, it } from 'vitest';
import { CognitiveKnowledge, CognitiveMemory, HumanCognition } from '../components/index.js';
import { Simulation } from '../simulation.js';
import {
  migrateSnapshotV9ToV10,
  migrateSnapshotV10ToV11,
  migrateSnapshotV11ToV12,
  type SimulationSnapshot,
} from './simulationSnapshot.js';

function makeSimulation(seed: string): Simulation {
  return new Simulation({ seed, population: 3, config: { time: { gameSecondsPerTick: 1 } } });
}

/**
 * Simule une sauvegarde v9 : un snapshot v10 réel, privé de ses trois entrées
 * cognitives, avec l'empreinte de configuration recalculée selon la formule RÉELLEMENT
 * utilisée par le code v9 (postérieure à l'écologie, antérieure à `cognition` — voir
 * `Simulation.preCognitionConfigFingerprint`). Réutiliser l'empreinte v10 du snapshot
 * source (laquelle inclut `cognition`) aurait fait passer le test de migration pour de
 * mauvaises raisons : ce n'est PAS l'empreinte qu'un vrai v9 aurait jamais portée.
 */
function asV9Snapshot(simulation: Simulation, snapshot: SimulationSnapshot): SimulationSnapshot {
  const {
    CognitiveMemory: _m,
    CognitiveKnowledge: _k,
    HumanCognition: _c,
    ...rest
  } = snapshot.entities.components;
  const preCognitionFingerprint = (
    simulation as unknown as { preCognitionConfigFingerprint(): string }
  ).preCognitionConfigFingerprint();
  return {
    ...snapshot,
    version: 9,
    configFingerprint: preCognitionFingerprint,
    entities: { ...snapshot.entities, components: rest },
  };
}

describe('migrateSnapshotV9ToV10', () => {
  it('ajoute les trois composants cognitifs, vides, pour chaque humain existant', () => {
    const simulation = makeSimulation('migration-v9-v10');
    const humanIds = simulation.humanIds();
    const v9 = asV9Snapshot(simulation, simulation.captureSnapshot());
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
    const v9 = asV9Snapshot(simulation, simulation.captureSnapshot());
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
    const v9 = asV9Snapshot(source, source.captureSnapshot());
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

  it('rejette une v9 dont la configuration de comportement (hors cognition) a réellement changé', () => {
    const source = makeSimulation('migration-fingerprint-drift');
    const v9 = asV9Snapshot(source, source.captureSnapshot());
    source.dispose();

    const target = new Simulation({
      seed: 'migration-fingerprint-drift',
      population: 3,
      config: { time: { gameSecondsPerTick: 1 }, movement: { arrivalRadiusMeters: 99 } },
    });

    expect(() => target.restoreSnapshot(v9)).toThrow('configuration incompatible');
    target.dispose();
  });
});

/**
 * Simule une sauvegarde v10 : version ramenée à 10, champs `encodedConfidence01` /
 * `encodedPrecisionM` retirés des entrées spatiales, source forcée à `selfExperience`.
 * Permet de tester `migrateSnapshotV10ToV11` sans avoir de vraies sauvegardes v10 sur
 * disque.
 */
function asV10Snapshot(snapshot: SimulationSnapshot): SimulationSnapshot {
  type LegacySpatial = Record<string, unknown>;
  type LegacyMem = {
    nextMemoryId: number;
    spatial: LegacySpatial[];
    episodic: unknown[];
    social: unknown[];
  };

  const cogMemEntries = (snapshot.entities.components.CognitiveMemory ?? []) as unknown as [
    number,
    LegacyMem,
  ][];

  const downgraded = cogMemEntries.map(([id, mem]): [number, LegacyMem] => [
    id,
    {
      ...mem,
      spatial: mem.spatial.map((entry) => {
        const { encodedConfidence01: _ec, encodedPrecisionM: _ep, ...rest } = entry;
        return { ...rest, source: 'selfExperience' };
      }),
    },
  ]);

  return {
    ...snapshot,
    version: 10,
    entities: {
      ...snapshot.entities,
      components: {
        ...snapshot.entities.components,
        CognitiveMemory:
          downgraded as unknown as SimulationSnapshot['entities']['components']['CognitiveMemory'],
      },
    },
  };
}

describe('migrateSnapshotV10ToV11', () => {
  it('backfille encodedConfidence01 et encodedPrecisionM depuis les valeurs existantes', () => {
    const simulation = makeSimulation('migration-v10-v11');
    simulation.start();
    simulation.step(200);
    const v10 = asV10Snapshot(simulation.captureSnapshot());
    simulation.dispose();

    expect(v10.version).toBe(10);
    const migrated = migrateSnapshotV10ToV11(v10);
    expect(migrated.version).toBe(11);

    type SpatialEntry = {
      encodedConfidence01?: number;
      encodedPrecisionM?: number;
      confidence01: number;
      precisionM: number;
    };
    const entries = (migrated.entities.components.CognitiveMemory ?? []) as unknown as [
      number,
      { spatial: SpatialEntry[] },
    ][];
    const allSpatial = entries.flatMap(([, mem]) => mem.spatial);

    if (allSpatial.length > 0) {
      for (const entry of allSpatial) {
        expect(entry.encodedConfidence01).toBeDefined();
        expect(entry.encodedPrecisionM).toBeDefined();
      }
    }
  });

  it('convertit la source selfExperience en directPerception', () => {
    const simulation = makeSimulation('migration-source-conv');
    simulation.start();
    simulation.step(200);
    const v10 = asV10Snapshot(simulation.captureSnapshot());
    simulation.dispose();

    const migrated = migrateSnapshotV10ToV11(v10);
    type SpatialEntry = { source: string };
    const entries = (migrated.entities.components.CognitiveMemory ?? []) as unknown as [
      number,
      { spatial: SpatialEntry[] },
    ][];
    const allSpatial = entries.flatMap(([, mem]) => mem.spatial);

    for (const entry of allSpatial) {
      expect(entry.source).not.toBe('selfExperience');
    }
  });

  it('refuse une version différente de 10', () => {
    const simulation = makeSimulation('migration-v10-wrong');
    const v11 = simulation.captureSnapshot();
    simulation.dispose();

    expect(() => migrateSnapshotV10ToV11(v11)).toThrow();
  });

  it('ne touche pas le snapshot original (pure)', () => {
    const simulation = makeSimulation('migration-v10-purity');
    const v10 = asV10Snapshot(simulation.captureSnapshot());
    simulation.dispose();

    migrateSnapshotV10ToV11(v10);

    expect(v10.version).toBe(10);
  });

  it('Simulation.restoreSnapshot migre automatiquement une sauvegarde v10', () => {
    const source = makeSimulation('migration-v10-e2e');
    source.start();
    source.step(50);
    const v10 = asV10Snapshot(source.captureSnapshot());
    source.dispose();

    const target = makeSimulation('migration-v10-e2e');
    expect(() => target.restoreSnapshot(v10)).not.toThrow();
    target.dispose();
  });
});

/**
 * Simule une sauvegarde v11 : version ramenée à 11, entrées `Memory` réenrichies avec les
 * anciens tableaux `food`/`water` que la Phase 3.5 a retirés.
 */
function asV11Snapshot(snapshot: SimulationSnapshot): SimulationSnapshot {
  type MemoryLegacy = {
    lastFoodScanX: number | null;
    lastFoodScanZ: number | null;
    lastWaterScanX: number | null;
    lastWaterScanZ: number | null;
  };
  const memEntries = (snapshot.entities.components.Memory ?? []) as unknown as [
    number,
    MemoryLegacy,
  ][];
  const downgraded = memEntries.map(([id, mem]): [number, unknown] => [
    id,
    {
      ...mem,
      food: [
        {
          resourceId: 'legacy',
          definitionId: 'berry_bush',
          ownerChunkKey: '0:0',
          localId: 0,
          x: 10,
          z: 10,
          foodKcal: 300,
          lastSeenTick: 5,
        },
      ],
      water: [{ x: 20, z: 20, lastSeenTick: 5 }],
    },
  ]);
  return {
    ...snapshot,
    version: 11,
    entities: {
      ...snapshot.entities,
      components: {
        ...snapshot.entities.components,
        Memory: downgraded as unknown as SimulationSnapshot['entities']['components']['Memory'],
      },
    },
  };
}

describe('migrateSnapshotV11ToV12', () => {
  it('retire food et water de chaque entrée Memory, conserve les positions de scan', () => {
    const simulation = makeSimulation('migration-v11-v12');
    const v11 = asV11Snapshot(simulation.captureSnapshot());
    simulation.dispose();

    const migrated = migrateSnapshotV11ToV12(v11);
    expect(migrated.version).toBe(12);

    type MemoryEntry = {
      food?: unknown;
      water?: unknown;
      lastFoodScanX: number | null;
      lastWaterScanX: number | null;
    };
    const entries = (migrated.entities.components.Memory ?? []) as unknown as [
      number,
      MemoryEntry,
    ][];
    for (const [, mem] of entries) {
      expect(mem.food).toBeUndefined();
      expect(mem.water).toBeUndefined();
      // Les positions de scan (encore utilisées par PerceptionSystem) sont conservées.
      expect('lastFoodScanX' in mem).toBe(true);
      expect('lastWaterScanX' in mem).toBe(true);
    }
  });

  it('refuse une version différente de 11', () => {
    const simulation = makeSimulation('migration-v11-wrong');
    const v12 = simulation.captureSnapshot();
    simulation.dispose();
    expect(() => migrateSnapshotV11ToV12(v12)).toThrow();
  });

  it('ne touche pas le snapshot original (pure)', () => {
    const simulation = makeSimulation('migration-v11-purity');
    const v11 = asV11Snapshot(simulation.captureSnapshot());
    simulation.dispose();
    migrateSnapshotV11ToV12(v11);
    expect(v11.version).toBe(11);
  });

  it('Simulation.restoreSnapshot migre automatiquement une sauvegarde v11', () => {
    const source = makeSimulation('migration-v11-e2e');
    source.start();
    source.step(30);
    const v11 = asV11Snapshot(source.captureSnapshot());
    source.dispose();

    const target = makeSimulation('migration-v11-e2e');
    expect(() => target.restoreSnapshot(v11)).not.toThrow();
    target.dispose();
  });
});

describe('configFingerprint — cognition (v11)', () => {
  it('deux snapshots v10 avec des réglages cognitifs différents sont incompatibles', () => {
    const source = new Simulation({
      seed: 'cognition-fingerprint-drift',
      population: 1,
      config: { time: { gameSecondsPerTick: 1 } },
    });
    const snapshot = source.captureSnapshot();
    source.dispose();

    const target = new Simulation({
      seed: 'cognition-fingerprint-drift',
      population: 1,
      config: {
        time: { gameSecondsPerTick: 1 },
        cognition: { spatialConfidenceHalfLifeSeconds: 999999 },
      },
    });

    expect(() => target.restoreSnapshot(snapshot)).toThrow('configuration incompatible');
    target.dispose();
  });
});
