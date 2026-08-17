import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilePersistenceAdapter } from '@civ/simulation';
import type { ServerConfig } from './config.js';
import { InvalidThumbnailError, SimulationHost } from './simulationHost.js';

function makeConfig(overrides: Partial<ServerConfig>): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    worldSeed: 'persistence-test-seed',
    worldSizeChunks: 4,
    population: 3,
    tickRateHz: 20,
    netRateHz: 10,
    chunkBudgetMs: 8,
    allowRegenerate: true,
    saveDir: '',
    saveSlot: 'world',
    autosaveIntervalTicks: 0,
    saveOnShutdown: true,
    trustedOrigins: [],
    ...overrides,
  };
}

describe('SimulationHost — persistance', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'civ-host-save-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('initialize() ne fait rien quand aucune sauvegarde n’existe encore', async () => {
    const host = new SimulationHost(makeConfig({ saveDir: dir }));
    await host.initialize();
    expect(host.currentSimulation.world.seed).toBe('persistence-test-seed');
    await host.stop();
  });

  it('sauvegarde à l’arrêt puis recharge le même monde au prochain démarrage', async () => {
    const host = new SimulationHost(makeConfig({ saveDir: dir, saveSlot: 'my-world' }));
    await host.initialize();
    host.currentSimulation.start();
    host.currentSimulation.step(500);
    const tickAtStop = host.currentSimulation.clock.currentTick;
    const populationAtStop = host.currentSimulation.humanCount;

    await host.stop(); // déclenche saveOnShutdown

    // Nouvel hôte, seed CONFIGURÉE délibérément différente : la sauvegarde doit primer.
    const restarted = new SimulationHost(
      makeConfig({ saveDir: dir, saveSlot: 'my-world', worldSeed: 'a-totally-different-seed' }),
    );
    await restarted.initialize();

    expect(restarted.currentSimulation.world.seed).toBe('persistence-test-seed');
    expect(restarted.currentSimulation.clock.currentTick).toBe(tickAtStop);
    expect(restarted.currentSimulation.humanCount).toBe(populationAtStop);
    await restarted.stop();
  });

  it('redémarre sur le dernier monde activé et conserve son worldId permanent', async () => {
    const host = new SimulationHost(makeConfig({ saveDir: dir }));
    const created = await host.createWorld({ name: 'La vallée de Nara', seed: 'same-seed' });
    const worldId = host.currentSimulation.world.worldId;
    await host.stop();

    const restarted = new SimulationHost(makeConfig({ saveDir: dir }));
    await restarted.initialize();
    expect(restarted.activeWorld).toBe(created.name);
    expect(restarted.currentSimulation.world.worldId).toBe(worldId);
    expect((await restarted.listWorlds()).find((world) => world.name === created.name)?.label).toBe(
      'La vallée de Nara',
    );
    await restarted.stop();
  });

  it('ne sauvegarde pas à l’arrêt quand saveOnShutdown est désactivé', async () => {
    const host = new SimulationHost(
      makeConfig({ saveDir: dir, saveSlot: 'no-save', saveOnShutdown: false }),
    );
    await host.initialize();
    host.currentSimulation.step(50);
    await host.stop();

    const restarted = new SimulationHost(makeConfig({ saveDir: dir, saveSlot: 'no-save' }));
    await restarted.initialize();
    // Rien n'a été sauvegardé : le monde redémarre neuf, tick 0.
    expect(restarted.currentSimulation.clock.currentTick).toBe(0);
    await restarted.stop();
  });

  it('fonctionne sans persistance quand saveDir est vide (monde éphémère)', async () => {
    const host = new SimulationHost(makeConfig({ saveDir: '' }));
    await host.initialize(); // no-op, pas d'adaptateur
    host.currentSimulation.step(10);
    await expect(host.stop()).resolves.toBeUndefined();
  });

  it('initialize() rejette plutôt que de démarrer un monde neuf quand la sauvegarde est corrompue', async () => {
    const host = new SimulationHost(makeConfig({ saveDir: dir, saveSlot: 'corrupt-world' }));
    await host.initialize();
    host.currentSimulation.step(20);
    await host.stop();

    // Corrompt la seule copie existante (pas de backup à ce stade : un seul save()).
    await writeFile(join(dir, 'corrupt-world.meta.json'), '{not json');

    const restarted = new SimulationHost(makeConfig({ saveDir: dir, saveSlot: 'corrupt-world' }));
    await expect(restarted.initialize()).rejects.toThrow();
  });

  it('initialize() se replie silencieusement sur un backup sain si la version courante est corrompue', async () => {
    const host = new SimulationHost(makeConfig({ saveDir: dir, saveSlot: 'recoverable' }));
    await host.initialize();
    host.currentSimulation.step(10);
    await host.stop();
    // Un deuxième cycle produit un `bak1` derrière la version courante.
    const host2 = new SimulationHost(makeConfig({ saveDir: dir, saveSlot: 'recoverable' }));
    await host2.initialize();
    host2.currentSimulation.step(10);
    const tickAtStop = host2.currentSimulation.clock.currentTick;
    await host2.stop();

    // Corrompt uniquement la version courante — bak1 reste sain.
    await writeFile(join(dir, 'recoverable.meta.json'), '{not json');

    const restarted = new SimulationHost(makeConfig({ saveDir: dir, saveSlot: 'recoverable' }));
    await expect(restarted.initialize()).resolves.toBeUndefined();
    expect(restarted.currentSimulation.clock.currentTick).toBeLessThanOrEqual(tickAtStop);
    await restarted.stop();
  });
});

describe('SimulationHost — gestion des mondes (multi-sauvegardes nommées)', () => {
  let dir: string;
  let host: SimulationHost;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'civ-host-worlds-'));
    host = new SimulationHost(makeConfig({ saveDir: dir, saveSlot: 'world' }));
    await host.initialize();
  });

  afterEach(async () => {
    await host.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('listWorlds() renvoie [] tant que persistance désactivée', async () => {
    const ephemeral = new SimulationHost(makeConfig({ saveDir: '' }));
    expect(await ephemeral.listWorlds()).toEqual([]);
    await ephemeral.stop();
  });

  it('createWorld() bascule le monde actif et l’enregistre immédiatement', async () => {
    expect(host.activeWorld).toBe('world');

    const metadata = await host.createWorld({ name: 'valley-01', seed: 'valley-seed' });
    expect(metadata.name).toMatch(/^world-[0-9a-f-]{36}$/);
    expect(metadata.label).toBe('valley-01');
    expect(metadata.seed).toBe('valley-seed');
    expect(host.activeWorld).toBe(metadata.name);
    expect(host.currentSimulation.world.seed).toBe('valley-seed');

    // `SaveMetadata` (couche `SimulationHost`/persistance) ne porte pas `isActive` —
    // ce champ n'existe que sur `WorldSummary`, calculé à la frontière HTTP
    // (`toWorldSummary` dans `index.ts`) en comparant au nom actif. Ici on vérifie la
    // source de vérité dont `isActive` dérive : `host.activeWorld`.
    const worlds = await host.listWorlds();
    expect(worlds.find((w) => w.label === 'valley-01')).toBeDefined();
    expect(host.activeWorld).toBe(metadata.name);
  });

  it('createWorld() applique sizeChunks/population demandés', async () => {
    await host.createWorld({ name: 'small-world', sizeChunks: 2, population: 5 });
    expect(host.currentSimulation.humanCount).toBe(5);
  });

  it('createWorld() rejette un nom déjà utilisé sans toucher au monde actif', async () => {
    await host.createWorld({ name: 'taken' });
    const activeBefore = host.activeWorld;

    await expect(host.createWorld({ name: 'taken' })).rejects.toThrow(/existe déjà/);
    expect(host.activeWorld).toBe(activeBefore);
  });

  it('activateWorld() recharge un monde précédemment sauvegardé et le rend actif', async () => {
    // `createWorld` sauvegarde immédiatement — pas besoin d'attendre un autosave pour
    // que ce monde soit rechargeable.
    const first = await host.createWorld({ name: 'first' });
    host.currentSimulation.step(15);

    // Un deuxième monde, actif entre-temps.
    const second = await host.createWorld({ name: 'second' });
    expect(host.activeWorld).toBe(second.name);

    const activated = await host.activateWorld(first.name);
    expect(activated.label).toBe('first');
    expect(host.activeWorld).toBe(first.name);
    expect(host.currentSimulation.clock.currentTick).toBe(15); // sauvegardé juste avant la bascule
  });

  it('activateWorld() lève WorldNotFoundError pour un nom inconnu', async () => {
    await expect(host.activateWorld('never-existed')).rejects.toThrow(/introuvable/);
  });

  it('renomme le libellé du monde actif mais refuse toujours de le supprimer', async () => {
    const active = await host.createWorld({ name: 'Mon monde' });
    const renamed = await host.renameWorld(active.name, 'La vallée de Nara');
    expect(renamed.name).toBe(active.name);
    expect(renamed.label).toBe('La vallée de Nara');
    await expect(host.deleteWorld(active.name)).rejects.toThrow(/actif/);
  });

  it('renameWorld() fonctionne sur un monde non-actif', async () => {
    const original = await host.createWorld({ name: 'to-rename' });
    await host.createWorld({ name: 'other-active' }); // 'to-rename' n'est plus actif

    const renamed = await host.renameWorld(original.name, 'renamed-world');
    expect(renamed.name).toBe(original.name);
    expect(renamed.label).toBe('renamed-world');

    const worlds = await host.listWorlds();
    expect(worlds.some((w) => w.label === 'to-rename')).toBe(false);
    expect(worlds.some((w) => w.label === 'renamed-world')).toBe(true);
  });

  it('duplicateWorld() copie un monde sans supprimer l’original', async () => {
    const source = await host.createWorld({ name: 'source-world' });
    const copy = await host.duplicateWorld(source.name, 'copy-world');

    const worlds = await host.listWorlds();
    expect(worlds.some((w) => w.label === 'source-world')).toBe(true);
    expect(worlds.some((w) => w.label === 'copy-world')).toBe(true);
    expect(copy.name).not.toBe(source.name);
    const sourceEnvelope = await new FilePersistenceAdapter(dir).load(source.name);
    const copyEnvelope = await new FilePersistenceAdapter(dir).load(copy.name);
    expect(copyEnvelope?.snapshot.worldId).not.toBe(sourceEnvelope?.snapshot.worldId);
  });

  it('deleteWorld() fonctionne sur un monde non-actif', async () => {
    const toDelete = await host.createWorld({ name: 'to-delete' });
    await host.createWorld({ name: 'other-active' });

    await host.deleteWorld(toDelete.name);
    const worlds = await host.listWorlds();
    expect(worlds.some((w) => w.label === 'to-delete')).toBe(false);
  });

  describe('miniatures de sauvegarde', () => {
    const fakeJpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');

    it('loadWorldThumbnail() renvoie null tant qu’aucune miniature n’a été envoyée', async () => {
      expect(await host.loadWorldThumbnail('world')).toBeNull();
    });

    it('round-trip une miniature pour le monde actif', async () => {
      await host.saveWorldThumbnail('world', fakeJpegBase64);
      const loaded = await host.loadWorldThumbnail('world');
      expect(loaded?.toString('base64')).toBe(fakeJpegBase64);
    });

    it('loadWorldThumbnail() renvoie null (pas une erreur) quand la persistance est désactivée', async () => {
      const ephemeral = new SimulationHost(makeConfig({ saveDir: '' }));
      expect(await ephemeral.loadWorldThumbnail('anything')).toBeNull();
      await ephemeral.stop();
    });

    it('saveWorldThumbnail() lève quand la persistance est désactivée', async () => {
      const ephemeral = new SimulationHost(makeConfig({ saveDir: '' }));
      await expect(ephemeral.saveWorldThumbnail('anything', fakeJpegBase64)).rejects.toThrow();
      await ephemeral.stop();
    });

    it('refuse un contenu qui ne commence pas par la signature JPEG', async () => {
      const notJpeg = Buffer.from('ceci nest pas une image').toString('base64');
      await expect(host.saveWorldThumbnail('world', notJpeg)).rejects.toThrow(
        InvalidThumbnailError,
      );
    });

    it('refuse un base64 mal formé', async () => {
      await expect(host.saveWorldThumbnail('world', 'pas-du-tout-du-base64!!!')).rejects.toThrow(
        InvalidThumbnailError,
      );
    });

    it('refuse une image trop volumineuse', async () => {
      const oversized = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff]),
        Buffer.alloc(600 * 1024, 0),
      ]).toString('base64');
      await expect(host.saveWorldThumbnail('world', oversized)).rejects.toThrow(
        InvalidThumbnailError,
      );
    });
  });
});
