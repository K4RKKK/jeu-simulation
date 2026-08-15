import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilePersistenceAdapter } from './fileAdapter.js';
import {
  IncompatibleSaveFormatError,
  SAVE_FORMAT_VERSION,
  computeSnapshotHash,
  type SaveEnvelope,
} from './persistenceAdapter.js';
import { SIMULATION_SNAPSHOT_VERSION, type SimulationSnapshot } from './simulationSnapshot.js';

/**
 * `tick`/`seed`/`configFingerprint` sont dupliqués entre `metadata` et `snapshot` et
 * vérifiés croisés par `FilePersistenceAdapter` — un override de l'un des trois dans
 * `overrides` (métadonnées) est donc automatiquement répercuté dans le snapshot construit
 * ici, pour que les appels existants (`fakeEnvelope({ tick: 2 })`) restent cohérents sans
 * devoir dupliquer chaque override des deux côtés. `snapshotOverrides` reste disponible
 * pour les tests qui veulent volontairement DÉPAREILLER les deux (voir la description
 * `snapshotHash`).
 */
function fakeEnvelope(
  overrides: Partial<SaveEnvelope['metadata']> = {},
  snapshotOverrides: Partial<SimulationSnapshot> = {},
): SaveEnvelope {
  const tick = overrides.tick ?? 1234;
  const seed = overrides.seed ?? 'seed-x';
  const configFingerprint = overrides.configFingerprint ?? 'fingerprint-x';

  const snapshot: SimulationSnapshot = {
    version: SIMULATION_SNAPSHOT_VERSION,
    seed,
    generationVersion: 'worldgen-v1',
    configFingerprint,
    clock: { currentTick: tick, totalGameSeconds: tick, timeScale: 1, paused: false },
    rng: {
      worldGeneration: [1, 2, 3, 4],
      humans: [1, 2, 3, 4],
      behavior: [1, 2, 3, 4],
      metabolism: [1, 2, 3, 4],
      discovery: [1, 2, 3, 4],
      disease: [1, 2, 3, 4],
      language: [1, 2, 3, 4],
    },
    entities: { nextEntityId: 9, ids: [1, 2, 3, 4, 5, 6, 7, 8], components: {} },
    scheduler: { systems: [] },
    delta: { deltas: [], trails: [] },
    history: [],
    ...snapshotOverrides,
  };

  return {
    metadata: {
      formatVersion: SAVE_FORMAT_VERSION,
      saveId: 'save-id-x',
      snapshotHash: computeSnapshotHash(snapshot),
      name: 'test-save',
      seed,
      generationVersion: 'worldgen-v1',
      configFingerprint,
      savedAtIso: '2026-01-01T00:00:00.000Z',
      tick,
      humanCount: 8,
      ...overrides,
    },
    snapshot,
  };
}

describe('FilePersistenceAdapter', () => {
  let dir: string;
  let adapter: FilePersistenceAdapter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'civ-save-test-'));
    adapter = new FilePersistenceAdapter(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a save through save() then load()', async () => {
    const envelope = fakeEnvelope();
    await adapter.save('slot1', envelope);

    const loaded = await adapter.load('slot1');
    expect(loaded).toEqual(envelope);
  });

  it('returns null for a save that does not exist', async () => {
    expect(await adapter.load('never-saved')).toBeNull();
  });

  it('list() returns metadata without needing the snapshot, sorted newest first', async () => {
    await adapter.save(
      'old',
      fakeEnvelope({ name: 'old', savedAtIso: '2026-01-01T00:00:00.000Z' }),
    );
    await adapter.save(
      'new',
      fakeEnvelope({ name: 'new', savedAtIso: '2026-06-01T00:00:00.000Z' }),
    );

    const list = await adapter.list();
    expect(list.map((m) => m.name)).toEqual(['new', 'old']);
  });

  it('list() on an empty/missing directory returns an empty array, not an error', async () => {
    const emptyDir = join(dir, 'does-not-exist-yet');
    const emptyAdapter = new FilePersistenceAdapter(emptyDir);
    expect(await emptyAdapter.list()).toEqual([]);
  });

  it('delete() removes both files and is idempotent', async () => {
    await adapter.save('to-remove', fakeEnvelope({ name: 'to-remove' }));
    expect(await adapter.load('to-remove')).not.toBeNull();

    await adapter.delete('to-remove');
    expect(await adapter.load('to-remove')).toBeNull();

    // Un second appel ne doit pas lever.
    await expect(adapter.delete('to-remove')).resolves.toBeUndefined();
  });

  it('overwrites an existing save cleanly (no stale leftover fields)', async () => {
    await adapter.save('slot', fakeEnvelope({ name: 'slot', tick: 100 }));
    await adapter.save('slot', fakeEnvelope({ name: 'slot', tick: 200 }));

    const loaded = await adapter.load('slot');
    expect(loaded?.metadata.tick).toBe(200);
  });

  it('rejects a save whose formatVersion does not match', async () => {
    await adapter.save('bad-version', fakeEnvelope({ name: 'bad-version', formatVersion: 999 }));
    await expect(adapter.load('bad-version')).rejects.toThrow(IncompatibleSaveFormatError);
  });

  it('rejects path traversal attempts in the save name', async () => {
    await expect(adapter.save('../evil', fakeEnvelope())).rejects.toThrow(/invalide/);
    await expect(adapter.load('../../etc/passwd')).rejects.toThrow(/invalide/);
    await expect(adapter.delete('a/b')).rejects.toThrow(/invalide/);
  });

  /**
   * Preuve directe de l'écriture atomique : après `save()`, il ne doit rester AUCUN
   * fichier temporaire (`.tmp-*`) dans le dossier — l'écriture s'est terminée par un
   * renommage, jamais par un fichier à moitié écrit visible.
   */
  it('leaves no temporary file behind after a successful save', async () => {
    await adapter.save('clean', fakeEnvelope({ name: 'clean' }));
    const files = await readdir(dir);
    expect(files.some((f) => f.includes('.tmp-'))).toBe(false);
    expect(files.sort()).toEqual(['clean.meta.json', 'clean.snapshot.json']);
  });

  /**
   * Simule le pire cas de crash : les métadonnées existent mais le fichier snapshot a
   * disparu (crash exactement entre les deux renommages, ou suppression manuelle). Le
   * chargement doit échouer avec un message clair plutôt que planter silencieusement
   * ou renvoyer un état partiel.
   */
  it('raises a clear error when metadata exists but the snapshot file is missing', async () => {
    await adapter.save('half', fakeEnvelope({ name: 'half' }));
    await rm(join(dir, 'half.snapshot.json'));

    await expect(adapter.load('half')).rejects.toThrow(/corrompue/);
  });

  /**
   * Un fichier snapshot orphelin sans métadonnées (crash avant le second renommage)
   * doit rester invisible à `list()` et à `load()` : sans métadonnées valides, la
   * sauvegarde n'a jamais été considérée « complète ».
   */
  it('ignores an orphaned snapshot file with no matching metadata', async () => {
    await writeFile(join(dir, 'orphan.snapshot.json'), JSON.stringify(fakeEnvelope().snapshot));
    expect(await adapter.list()).toEqual([]);
    expect(await adapter.load('orphan')).toBeNull();
  });

  it('round-trips several independent slots without cross-contamination', async () => {
    await adapter.save('a', fakeEnvelope({ name: 'a', tick: 1 }));
    await adapter.save('b', fakeEnvelope({ name: 'b', tick: 2 }));
    await adapter.save('c', fakeEnvelope({ name: 'c', tick: 3 }));

    const [a, b, c] = await Promise.all([adapter.load('a'), adapter.load('b'), adapter.load('c')]);
    expect(a?.metadata.tick).toBe(1);
    expect(b?.metadata.tick).toBe(2);
    expect(c?.metadata.tick).toBe(3);

    const names = (await adapter.list()).map((m) => m.name).sort();
    expect(names).toEqual(['a', 'b', 'c']);
  });

  it('produces byte-identical JSON content readable outside the adapter', async () => {
    const envelope = fakeEnvelope({ name: 'raw-check' });
    await adapter.save('raw-check', envelope);

    const rawMeta = JSON.parse(await readFile(join(dir, 'raw-check.meta.json'), 'utf8'));
    expect(rawMeta).toEqual(envelope.metadata);
  });

  /** Lit un fichier `.meta.json` directement — les noms de backup (`slot.bak1`)
   * contiennent un point et sont donc rejetés par `assertSafeName`, ils ne sont
   * atteignables qu'en lisant le disque, jamais via l'API publique de l'adaptateur. */
  async function readBackupMeta(base: string): Promise<{ tick: number } | null> {
    try {
      const raw = await readFile(join(dir, `${base}${'.meta.json'}`), 'utf8');
      return JSON.parse(raw) as { tick: number };
    } catch {
      return null;
    }
  }

  describe('rotation des backups', () => {
    it('conserve les versions précédentes sous bak1/bak2/… en écrasant', async () => {
      await adapter.save('rot', fakeEnvelope({ name: 'rot', tick: 1 }));
      await adapter.save('rot', fakeEnvelope({ name: 'rot', tick: 2 }));
      await adapter.save('rot', fakeEnvelope({ name: 'rot', tick: 3 }));

      expect((await adapter.load('rot'))?.metadata.tick).toBe(3);
      expect((await readBackupMeta('rot.bak1'))?.tick).toBe(2);
      expect((await readBackupMeta('rot.bak2'))?.tick).toBe(1);
    });

    it('purge les backups au-delà de backupCount', async () => {
      const smallAdapter = new FilePersistenceAdapter(dir, 1);
      await smallAdapter.save('cap', fakeEnvelope({ name: 'cap', tick: 1 }));
      await smallAdapter.save('cap', fakeEnvelope({ name: 'cap', tick: 2 }));
      await smallAdapter.save('cap', fakeEnvelope({ name: 'cap', tick: 3 }));

      expect((await readBackupMeta('cap.bak1'))?.tick).toBe(2);
      expect(await readBackupMeta('cap.bak2')).toBeNull();
    });

    it('list() ignore les fichiers de backup — ils ne sont pas des slots', async () => {
      await adapter.save('visible', fakeEnvelope({ name: 'visible', tick: 1 }));
      await adapter.save('visible', fakeEnvelope({ name: 'visible', tick: 2 }));

      const names = (await adapter.list()).map((m) => m.name);
      expect(names).toEqual(['visible']);
    });

    it('delete() supprime aussi les backups du slot', async () => {
      await adapter.save('gone', fakeEnvelope({ name: 'gone', tick: 1 }));
      await adapter.save('gone', fakeEnvelope({ name: 'gone', tick: 2 }));

      await adapter.delete('gone');

      expect(await adapter.load('gone')).toBeNull();
      expect(await readBackupMeta('gone.bak1')).toBeNull();
    });
  });

  describe('validation structurelle', () => {
    it('rejette des métadonnées JSON valides mais structurellement incomplètes', async () => {
      await adapter.save('shape', fakeEnvelope({ name: 'shape' }));
      const metaPath = join(dir, 'shape.meta.json');
      const raw = JSON.parse(await readFile(metaPath, 'utf8'));
      delete raw.seed;
      await writeFile(metaPath, JSON.stringify(raw));

      await expect(adapter.load('shape')).rejects.toThrow(/corrompue/);
    });

    it('rejette un snapshot structurellement incomplet', async () => {
      await adapter.save('snap-shape', fakeEnvelope({ name: 'snap-shape' }));
      const snapshotPath = join(dir, 'snap-shape.snapshot.json');
      const raw = JSON.parse(await readFile(snapshotPath, 'utf8'));
      delete raw.snapshot.entities;
      await writeFile(snapshotPath, JSON.stringify(raw));

      await expect(adapter.load('snap-shape')).rejects.toThrow(/corrompue/);
    });

    /**
     * Le couple `(saveId, snapshotHash)` est dupliqué entre `meta.json` et
     * `snapshot.json` justement pour détecter ce cas : les deux fichiers sont renommés
     * séparément (voir la doc de classe), un crash pile entre les deux renommages d'une
     * écriture ULTÉRIEURE peut laisser un `meta.json` neuf à côté d'un `snapshot.json`
     * resté ancien — deux fichiers chacun individuellement valides.
     */
    it('rejette une paire meta/snapshot dépareillée (saveId différent)', async () => {
      await adapter.save('mismatch', fakeEnvelope({ name: 'mismatch' }));
      const snapshotPath = join(dir, 'mismatch.snapshot.json');
      const raw = JSON.parse(await readFile(snapshotPath, 'utf8'));
      raw.saveId = 'a-different-save-id';
      await writeFile(snapshotPath, JSON.stringify(raw));

      await expect(adapter.load('mismatch')).rejects.toThrow(/corrompue/);
    });

    it('rejette une paire dont les deux copies de snapshotHash diffèrent', async () => {
      await adapter.save('hash-mismatch', fakeEnvelope({ name: 'hash-mismatch' }));
      const snapshotPath = join(dir, 'hash-mismatch.snapshot.json');
      const raw = JSON.parse(await readFile(snapshotPath, 'utf8'));
      raw.snapshotHash = '0'.repeat(64);
      await writeFile(snapshotPath, JSON.stringify(raw));

      await expect(adapter.load('hash-mismatch')).rejects.toThrow(/snapshotHash différents/);
    });

    it('rejette un snapshot dont le contenu a été modifié sans mettre à jour snapshotHash', async () => {
      await adapter.save('tampered', fakeEnvelope({ name: 'tampered' }));
      const snapshotPath = join(dir, 'tampered.snapshot.json');
      const raw = JSON.parse(await readFile(snapshotPath, 'utf8'));
      raw.snapshot.clock.currentTick = 9999;
      await writeFile(snapshotPath, JSON.stringify(raw));

      await expect(adapter.load('tampered')).rejects.toThrow(/corrompue/);
    });
  });

  describe('loadLatestValid()', () => {
    it("renvoie null quand le slot n'a jamais existé", async () => {
      expect(await adapter.loadLatestValid('never')).toBeNull();
    });

    it('renvoie la version courante quand elle est saine, sans toucher aux backups', async () => {
      await adapter.save('healthy', fakeEnvelope({ name: 'healthy', tick: 42 }));

      const result = await adapter.loadLatestValid('healthy');
      expect(result?.source).toBe('current');
      expect(result?.envelope.metadata.tick).toBe(42);
    });

    it('replie sur bak1 quand la version courante est corrompue', async () => {
      await adapter.save('fallback', fakeEnvelope({ name: 'fallback', tick: 1 }));
      await adapter.save('fallback', fakeEnvelope({ name: 'fallback', tick: 2 }));

      // Corrompt uniquement la version courante (tick 2) ; bak1 (tick 1) reste sain.
      const metaPath = join(dir, 'fallback.meta.json');
      await writeFile(metaPath, '{not json');

      const result = await adapter.loadLatestValid('fallback');
      expect(result?.source).toBe('backup:1');
      expect(result?.envelope.metadata.tick).toBe(1);
    });

    it('lève une erreur quand la version courante ET tous les backups sont corrompus', async () => {
      await adapter.save('all-bad', fakeEnvelope({ name: 'all-bad' }));
      await writeFile(join(dir, 'all-bad.meta.json'), '{not json');

      await expect(adapter.loadLatestValid('all-bad')).rejects.toThrow();
    });
  });

  describe('mutex de sauvegarde', () => {
    it('sérialise des save() concurrents sur le même slot sans corrompre les backups', async () => {
      await adapter.save('race', fakeEnvelope({ name: 'race', tick: 0 }));

      await Promise.all([
        adapter.save('race', fakeEnvelope({ name: 'race', tick: 1 })),
        adapter.save('race', fakeEnvelope({ name: 'race', tick: 2 })),
        adapter.save('race', fakeEnvelope({ name: 'race', tick: 3 })),
      ]);

      // Peu importe l'ordre final exact : le résultat doit rester un état COHÉRENT
      // (chargeable), jamais un mélange de fichiers à moitié écrits par des rotations
      // entrelacées.
      const current = await adapter.load('race');
      expect(current).not.toBeNull();
      const bak1 = await readBackupMeta('race.bak1');
      expect(bak1).not.toBeNull();
    });
  });

  describe('rename()', () => {
    it('déplace un slot vers un nouveau nom, mis à jour dans les métadonnées', async () => {
      await adapter.save('old-name', fakeEnvelope({ name: 'old-name', tick: 42 }));

      const result = await adapter.rename('old-name', 'new-name');
      expect(result.name).toBe('new-name');
      expect(result.tick).toBe(42);

      expect(await adapter.load('old-name')).toBeNull();
      const renamed = await adapter.load('new-name');
      expect(renamed?.metadata.name).toBe('new-name');
      expect(renamed?.metadata.tick).toBe(42);
    });

    it('supprime aussi les backups de l’ancien nom', async () => {
      await adapter.save('a', fakeEnvelope({ name: 'a', tick: 1 }));
      await adapter.save('a', fakeEnvelope({ name: 'a', tick: 2 }));
      expect(await readBackupMeta('a.bak1')).not.toBeNull();

      await adapter.rename('a', 'b');

      expect(await readBackupMeta('a.bak1')).toBeNull();
      expect(await adapter.load('b')).not.toBeNull();
    });

    it('génère un saveId frais (nouvel événement de sauvegarde)', async () => {
      const original = fakeEnvelope({ name: 'x' });
      await adapter.save('x', original);
      const renamed = await adapter.rename('x', 'y');
      expect(renamed.saveId).not.toBe(original.metadata.saveId);
    });

    it('lève si le slot source n’existe pas', async () => {
      await expect(adapter.rename('never-saved', 'x')).rejects.toThrow(/introuvable/);
    });

    it('lève si le nom cible existe déjà', async () => {
      await adapter.save('a', fakeEnvelope({ name: 'a' }));
      await adapter.save('b', fakeEnvelope({ name: 'b' }));
      await expect(adapter.rename('a', 'b')).rejects.toThrow(/existe déjà/);
      // Aucun des deux slots ne doit avoir été touché par la tentative refusée.
      expect(await adapter.load('a')).not.toBeNull();
      expect(await adapter.load('b')).not.toBeNull();
    });

    it('rejette un nom cible invalide (traversée de répertoire)', async () => {
      await adapter.save('a', fakeEnvelope({ name: 'a' }));
      await expect(adapter.rename('a', '../evil')).rejects.toThrow(/invalide/);
    });
  });

  describe('duplicate()', () => {
    it('copie un slot sous un nouveau nom sans toucher l’original', async () => {
      await adapter.save('source', fakeEnvelope({ name: 'source', tick: 7 }));

      const result = await adapter.duplicate('source', 'copy');
      expect(result.name).toBe('copy');
      expect(result.tick).toBe(7);

      const original = await adapter.load('source');
      const copy = await adapter.load('copy');
      expect(original).not.toBeNull();
      expect(copy?.metadata.name).toBe('copy');
      expect(copy?.metadata.tick).toBe(7);
    });

    it('génère un saveId frais pour la copie', async () => {
      const original = fakeEnvelope({ name: 'source' });
      await adapter.save('source', original);
      const copy = await adapter.duplicate('source', 'copy');
      expect(copy.saveId).not.toBe(original.metadata.saveId);
    });

    it('lève si le slot source n’existe pas', async () => {
      await expect(adapter.duplicate('never-saved', 'x')).rejects.toThrow(/introuvable/);
    });

    it('lève si le nom cible existe déjà', async () => {
      await adapter.save('a', fakeEnvelope({ name: 'a' }));
      await adapter.save('b', fakeEnvelope({ name: 'b' }));
      await expect(adapter.duplicate('a', 'b')).rejects.toThrow(/existe déjà/);
    });
  });

  describe('miniatures (saveThumbnail/loadThumbnail)', () => {
    const fakeJpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'); // en-tête JPEG minimal

    it('renvoie null tant qu’aucune miniature n’a été sauvegardée', async () => {
      await adapter.save('a', fakeEnvelope({ name: 'a' }));
      expect(await adapter.loadThumbnail('a')).toBeNull();
    });

    it('round-trip une miniature octet pour octet', async () => {
      await adapter.save('a', fakeEnvelope({ name: 'a' }));
      await adapter.saveThumbnail('a', fakeJpegBase64);

      const loaded = await adapter.loadThumbnail('a');
      expect(loaded?.toString('base64')).toBe(fakeJpegBase64);
    });

    it('écrase une miniature existante', async () => {
      await adapter.save('a', fakeEnvelope({ name: 'a' }));
      await adapter.saveThumbnail('a', fakeJpegBase64);
      const otherJpeg = Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]).toString('base64');
      await adapter.saveThumbnail('a', otherJpeg);

      expect((await adapter.loadThumbnail('a'))?.toString('base64')).toBe(otherJpeg);
    });

    it('delete() retire aussi la miniature', async () => {
      await adapter.save('a', fakeEnvelope({ name: 'a' }));
      await adapter.saveThumbnail('a', fakeJpegBase64);
      await adapter.delete('a');
      expect(await adapter.loadThumbnail('a')).toBeNull();
    });

    it('rename() déplace la miniature vers le nouveau nom', async () => {
      await adapter.save('a', fakeEnvelope({ name: 'a' }));
      await adapter.saveThumbnail('a', fakeJpegBase64);
      await adapter.rename('a', 'b');

      expect(await adapter.loadThumbnail('a')).toBeNull();
      expect((await adapter.loadThumbnail('b'))?.toString('base64')).toBe(fakeJpegBase64);
    });

    it('rename() sans miniature existante ne lève pas', async () => {
      await adapter.save('a', fakeEnvelope({ name: 'a' }));
      await expect(adapter.rename('a', 'b')).resolves.toBeDefined();
      expect(await adapter.loadThumbnail('b')).toBeNull();
    });

    it('duplicate() copie la miniature sans toucher à l’original', async () => {
      await adapter.save('a', fakeEnvelope({ name: 'a' }));
      await adapter.saveThumbnail('a', fakeJpegBase64);
      await adapter.duplicate('a', 'copy');

      expect((await adapter.loadThumbnail('a'))?.toString('base64')).toBe(fakeJpegBase64);
      expect((await adapter.loadThumbnail('copy'))?.toString('base64')).toBe(fakeJpegBase64);
    });
  });
});
