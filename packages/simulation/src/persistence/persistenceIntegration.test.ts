import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashWorldState } from '../debug/stateHash.js';
import { Simulation } from '../simulation.js';
import { FilePersistenceAdapter } from './fileAdapter.js';
import { createSaveEnvelope } from './persistenceAdapter.js';

function makeSimulation(seed: string, population = 10): Simulation {
  return new Simulation({ seed, population, config: { time: { gameSecondsPerTick: 1 } } });
}

describe('Persistence — bout en bout (Simulation ↔ disque)', () => {
  let dir: string;
  let adapter: FilePersistenceAdapter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'civ-save-e2e-'));
    adapter = new FilePersistenceAdapter(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('sauvegarde une simulation sur disque puis la restaure à l’identique dans une simulation fraîche', async () => {
    const seed = 'e2e-save-load';
    const source = makeSimulation(seed, 8);
    source.start();
    source.step(1500);
    const hashBefore = hashWorldState(source);

    const envelope = createSaveEnvelope(source, 'world-1', '2026-08-13T10:00:00.000Z');
    await adapter.save('world-1', envelope);
    source.dispose();

    const target = makeSimulation(seed, 8);
    const loaded = await adapter.load('world-1');
    expect(loaded).not.toBeNull();
    target.restoreSnapshot(loaded!.snapshot);

    expect(hashWorldState(target)).toBe(hashBefore);
    expect(loaded!.metadata.tick).toBe(1500);
    expect(loaded!.metadata.humanCount).toBe(8);
    target.dispose();
  });

  it('poursuit une simulation restaurée depuis le disque de façon déterministe', async () => {
    const seed = 'e2e-continue';
    const make = () => makeSimulation(seed, 6);

    const source = make();
    source.start();
    source.step(2000);
    await adapter.save(
      'continue-slot',
      createSaveEnvelope(source, 'continue-slot', '2026-08-13T00:00:00.000Z'),
    );
    source.dispose();

    const envelope = (await adapter.load('continue-slot'))!;

    const a = make();
    a.restoreSnapshot(envelope.snapshot);
    a.step(1000);

    const b = make();
    b.restoreSnapshot(envelope.snapshot);
    b.step(1000);

    expect(hashWorldState(a)).toBe(hashWorldState(b));
    a.dispose();
    b.dispose();
  });

  it('liste une sauvegarde après écriture, avec les métadonnées attendues', async () => {
    const source = makeSimulation('e2e-list', 4);
    source.start();
    source.step(100);
    await adapter.save(
      'listed',
      createSaveEnvelope(source, 'listed', '2026-08-13T00:00:00.000Z', 'avant-orage'),
    );
    source.dispose();

    const list = await adapter.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('listed');
    expect(list[0]!.label).toBe('avant-orage');
    expect(list[0]!.tick).toBe(100);
  });

  /**
   * Reproduit le scénario CLI réel : une sauvegarde à 5 humains est chargée dans une
   * simulation dont l'option `population` par défaut (15) créerait normalement plus
   * d'entités que le snapshot n'en contient. Sans `spawnInitialPopulation: false` côté
   * appelant ET `forceNextId` côté `EntityManager`, ce chargement levait à tort.
   */
  it('charge une sauvegarde plus petite que la population par défaut sans lever', async () => {
    const seed = 'e2e-smaller-population';
    const source = makeSimulation(seed, 5);
    source.start();
    source.step(200);
    await adapter.save('small', createSaveEnvelope(source, 'small', '2026-08-13T00:00:00.000Z'));
    source.dispose();

    const envelope = (await adapter.load('small'))!;
    const target = new Simulation({
      seed,
      population: 15, // délibérément plus grand que le snapshot (5)
      config: { time: { gameSecondsPerTick: 1 } },
      spawnInitialPopulation: false,
    });

    expect(() => target.restoreSnapshot(envelope.snapshot)).not.toThrow();
    expect(target.humanCount).toBe(5);
    target.dispose();
  });

  it('refuse de charger une sauvegarde dans une simulation de seed différente', async () => {
    const source = makeSimulation('seed-original', 4);
    source.start();
    source.step(50);
    await adapter.save(
      'mismatch',
      createSaveEnvelope(source, 'mismatch', '2026-08-13T00:00:00.000Z'),
    );
    source.dispose();

    const envelope = (await adapter.load('mismatch'))!;
    const target = makeSimulation('seed-different', 4);
    expect(() => target.restoreSnapshot(envelope.snapshot)).toThrow(/seed/);
    target.dispose();
  });
});
