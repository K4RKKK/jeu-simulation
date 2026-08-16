import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  SAVE_FORMAT_VERSION,
  computeSnapshotHash,
  isRecord,
  CorruptedSaveError,
  IncompatibleSaveFormatError,
  validateSaveMetadata,
  validateSimulationSnapshot,
  type PersistenceAdapter,
  type SaveEnvelope,
  type SaveMetadata,
} from './persistenceAdapter.js';
import type { SimulationSnapshot } from './simulationSnapshot.js';

/**
 * Forme réelle du fichier `.snapshot.json` sur disque — jamais un `SimulationSnapshot`
 * nu. `saveId`/`snapshotHash` dupliquent les champs de même nom dans `SaveMetadata` :
 * c'est cette redondance, vérifiée au chargement, qui détecte une paire meta/snapshot
 * dépareillée (voir la doc de `SaveMetadata.snapshotHash`).
 */
interface SnapshotFile {
  readonly saveId: string;
  readonly snapshotHash: string;
  readonly snapshot: SimulationSnapshot;
}

const META_SUFFIX = '.meta.json';
const SNAPSHOT_SUFFIX = '.snapshot.json';
/**
 * Cosmétique uniquement — jamais couvert par les garanties d'intégrité meta/snapshot
 * (pas de `saveId`/`snapshotHash`, pas de rotation de backups) : perdre une miniature
 * n'est jamais une perte de progression, contrairement au reste d'une sauvegarde.
 */
const THUMBNAIL_SUFFIX = '.thumbnail.jpg';
const ACTIVE_WORLD_FILE = 'active-world.json';

/**
 * Nombre de backups conservés par slot en plus de la version courante. Une rotation
 * `slot.bak1` → `slot.bak2` → … a lieu à chaque `save()` réussie AVANT d'écraser la
 * version courante : la version qu'on s'apprête à remplacer devient `bak1`, l'ancien
 * `bak1` devient `bak2`, etc., et tout ce qui dépasse `DEFAULT_BACKUP_COUNT` est purgé.
 */
const DEFAULT_BACKUP_COUNT = 3;

/**
 * Sauvegarde sur disque, un dossier par monde.
 *
 * Une sauvegarde `<name>` produit deux fichiers :
 * - `<name>.meta.json` — quelques centaines d'octets, lu par `list()`.
 * - `<name>.snapshot.json` — le gros du volume (entités, delta…).
 *
 * **Écriture atomique** : chaque fichier est d'abord écrit sous un nom temporaire
 * (`.tmp-<random>`) dans le même dossier, puis renommé vers son nom final.
 * `rename()` est atomique sur le même système de fichiers (POSIX comme NTFS) : un
 * lecteur ne voit jamais un fichier à moitié écrit, seulement l'ancienne version
 * complète ou la nouvelle version complète.
 *
 * **Ordre des renommages** : le snapshot est renommé AVANT les métadonnées. `list()`
 * ne s'appuie que sur les fichiers `.meta.json` existants ; tant que le `.meta.json`
 * n'a pas été renommé, la sauvegarde en cours d'écriture reste invisible. Si le
 * processus meurt entre les deux renommages, le pire cas est un `.snapshot.json` à
 * jour avec un `.meta.json` encore ancien (ou absent) — jamais l'inverse, qui aurait
 * annoncé une sauvegarde dont le contenu n'existe pas encore.
 */
export class FilePersistenceAdapter implements PersistenceAdapter {
  /**
   * Une seule écriture à la fois par nom de slot. Sans ce verrou, deux `save()`
   * concurrents sur le même slot (autosave + sauvegarde d'arrêt qui se chevauchent, par
   * exemple) pourraient entrelacer leurs rotations de backups : le `bak1` de l'un
   * écraserait celui de l'autre entre deux étapes, ou une rotation partiellement faite
   * par l'un serait poursuivie par l'autre sur un état incohérent. Une `Promise` par
   * nom sert de mutex asynchrone minimal — pas besoin d'un verrou inter-processus,
   * cet adaptateur ne partage jamais un dossier entre deux processus actifs.
   */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly directory: string,
    private readonly backupCount: number = DEFAULT_BACKUP_COUNT,
  ) {}

  async save(name: string, envelope: SaveEnvelope): Promise<void> {
    assertSafeName(name);
    return this.withLock(name, () => this.writeEnvelope(name, envelope));
  }

  /** Slot servi lors du dernier arrêt/basculement réussi du serveur. */
  async loadActiveWorld(): Promise<string | null> {
    const state = await this.readJson<unknown>(join(this.directory, ACTIVE_WORLD_FILE));
    if (!isRecord(state) || typeof state.name !== 'string') return null;
    assertSafeName(state.name);
    return state.name;
  }

  /** Change uniquement le libellé joueur ; le slot et les URLs restent stables. */
  async setLabel(name: string, label: string): Promise<SaveMetadata> {
    assertSafeName(name);
    if (label.trim().length === 0 || label.length > 64) {
      throw new Error('Nom de monde invalide : longueur hors limites.');
    }
    return this.withLock(name, async () => {
      const source = await this.loadSlotFiles(name, name);
      if (source === null) throw new Error(`Sauvegarde "${name}" introuvable.`);
      const metadata: SaveMetadata = {
        ...source.metadata,
        saveId: randomUUID(),
        label: label.trim(),
      };
      await this.writeEnvelope(name, { metadata, snapshot: source.snapshot });
      return metadata;
    });
  }

  /** Écriture atomique : un crash ne peut pas laisser un pointeur actif tronqué. */
  async saveActiveWorld(name: string): Promise<void> {
    assertSafeName(name);
    await mkdir(this.directory, { recursive: true });
    await this.writeAtomically(join(this.directory, ACTIVE_WORLD_FILE), JSON.stringify({ name }));
  }

  /**
   * Cœur non verrouillé de `save()` — appelé directement (sans reprendre le mutex) par
   * `rename()`/`duplicate()`, qui tiennent déjà leur propre verrou sur le nom cible au
   * moment de l'appel. Reprendre `withLock(name, …)` ici depuis un appelant qui détient
   * déjà ce même verrou bloquerait indéfiniment (la promesse en attente ne se résout
   * jamais avant que l'appelant lui-même ne se termine).
   */
  private async writeEnvelope(name: string, envelope: SaveEnvelope): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await this.rotateBackups(name);

    const snapshotPath = join(this.directory, `${name}${SNAPSHOT_SUFFIX}`);
    const metaPath = join(this.directory, `${name}${META_SUFFIX}`);

    const snapshotFile: SnapshotFile = {
      saveId: envelope.metadata.saveId,
      snapshotHash: envelope.metadata.snapshotHash,
      snapshot: envelope.snapshot,
    };
    await this.writeAtomically(snapshotPath, JSON.stringify(snapshotFile));
    // Les métadonnées sont renommées EN DERNIER : c'est leur présence qui rend la
    // sauvegarde « visible » et « complète » du point de vue de `list()`/`load()`.
    await this.writeAtomically(metaPath, JSON.stringify(envelope.metadata));
  }

  async load(name: string): Promise<SaveEnvelope | null> {
    assertSafeName(name);
    // Verrouillé comme `save()` : sans ce partage du mutex, un `load()` concurrent
    // pourrait tomber pile pendant la fenêtre où `rotateBackups()` a déplacé la version
    // courante vers `bak1` mais n'a pas encore écrit la nouvelle — il verrait
    // faussement « aucune sauvegarde » là où une version parfaitement valide existait
    // une milliseconde plus tôt.
    return this.withLock(name, () => this.loadSlotFiles(name, name));
  }

  /**
   * Charge la sauvegarde la plus récente et structurellement valide d'un slot, en
   * repliant automatiquement sur les backups (`bak1`, `bak2`, …, du plus récent au plus
   * ancien) si la version courante est corrompue. Ne masque une corruption que si un
   * candidat plus ancien est réellement sain — si la version courante ET tous les
   * backups sont corrompus ou absents de façon incohérente, l'erreur du candidat le
   * plus récent est relevée : mieux vaut un démarrage qui échoue bruyamment qu'un monde
   * neuf silencieux qui écraserait ensuite ce qui restait de récupérable sur disque.
   *
   * `null` seulement quand aucune trace de ce slot n'existe (jamais sauvegardé) — un cas
   * légitime, distinct d'une corruption.
   */
  async loadLatestValid(
    name: string,
  ): Promise<{ envelope: SaveEnvelope; source: 'current' | `backup:${number}` } | null> {
    assertSafeName(name);
    return this.withLock(name, async () => {
      let firstError: unknown = null;
      let sawAnyFile = false;

      const current = await this.tryLoadSlotFiles(name, name);
      if (current.found) {
        sawAnyFile = true;
        if (current.envelope !== null) return { envelope: current.envelope, source: 'current' };
        firstError = current.error;
      }

      for (let i = 1; i <= this.backupCount; i++) {
        const backupBase = `${name}.bak${i}`;
        const backup = await this.tryLoadSlotFiles(backupBase, name);
        if (!backup.found) continue;
        sawAnyFile = true;
        if (backup.envelope !== null) {
          return { envelope: backup.envelope, source: `backup:${i}` };
        }
        firstError ??= backup.error;
      }

      if (!sawAnyFile) return null;
      throw firstError ?? new CorruptedSaveError(name, 'aucune version lisible trouvée.');
    });
  }

  private async loadSlotFiles(base: string, displayName: string): Promise<SaveEnvelope | null> {
    const result = await this.tryLoadSlotFiles(base, displayName);
    if (!result.found) return null;
    if (result.envelope !== null) return result.envelope;
    throw result.error;
  }

  /**
   * Tente de lire et valider la paire meta/snapshot d'un `base` (slot courant ou
   * `slot.bakN`) sans lever : le résultat distingue « rien à cet emplacement »
   * (`found: false`, cas normal) de « quelque chose y était mais invalide »
   * (`found: true, envelope: null, error`), pour que les appelants puissent replier sur
   * le candidat suivant plutôt que de propager la première erreur rencontrée.
   */
  private async tryLoadSlotFiles(
    base: string,
    displayName: string,
  ): Promise<{ found: false } | { found: true; envelope: SaveEnvelope | null; error?: unknown }> {
    const metaPath = join(this.directory, `${base}${META_SUFFIX}`);
    const snapshotPath = join(this.directory, `${base}${SNAPSHOT_SUFFIX}`);

    let rawMeta: unknown;
    try {
      // Lecture stricte (ne masque PAS une erreur de parsing JSON derrière `null`,
      // contrairement à `readJson`) : un fichier absent (ENOENT) et un fichier présent
      // mais tronqué doivent produire des résultats différents — `found: false` pour le
      // premier, `found: true` avec une erreur pour le second, sans quoi une métadonnée
      // corrompue serait interprétée comme « slot inexistant » et masquerait l'échec.
      const raw = await readFile(metaPath, 'utf8');
      rawMeta = JSON.parse(raw) as unknown;
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') return { found: false };
      return { found: true, envelope: null, error };
    }

    try {
      // Vérifié AVANT la validation structurelle complète : un `formatVersion` d'une
      // sauvegarde plus ancienne doit produire une `IncompatibleSaveFormatError` claire,
      // pas une `CorruptedSaveError` confuse à cause d'un champ ajouté depuis (ex.
      // `snapshotHash`, introduit en v2) que l'ancien fichier ne pouvait pas avoir.
      if (
        isRecord(rawMeta) &&
        typeof rawMeta.formatVersion === 'number' &&
        rawMeta.formatVersion !== SAVE_FORMAT_VERSION
      ) {
        throw new IncompatibleSaveFormatError(rawMeta.formatVersion, SAVE_FORMAT_VERSION);
      }

      const metadata = validateSaveMetadata(rawMeta, displayName);

      const rawSnapshotFile = await this.readJson<unknown>(snapshotPath);
      if (rawSnapshotFile === null) {
        // Métadonnées présentes mais snapshot absent : sauvegarde corrompue (crash
        // exactement entre les deux renommages, ou fichier supprimé manuellement).
        throw new CorruptedSaveError(
          displayName,
          'métadonnées présentes mais snapshot introuvable.',
        );
      }
      if (
        !isRecord(rawSnapshotFile) ||
        typeof rawSnapshotFile.saveId !== 'string' ||
        typeof rawSnapshotFile.snapshotHash !== 'string' ||
        !isRecord(rawSnapshotFile.snapshot)
      ) {
        throw new CorruptedSaveError(displayName, 'fichier snapshot mal formé.');
      }
      const snapshot = validateSimulationSnapshot(rawSnapshotFile.snapshot, displayName);

      // La paire meta/snapshot doit décrire le MÊME événement de sauvegarde : les deux
      // fichiers sont renommés séparément (voir la doc de classe), donc un crash entre
      // les deux peut laisser un `meta.json` neuf à côté d'un `snapshot.json` ancien (ou
      // l'inverse), chacun individuellement valide mais dépareillés.
      if (rawSnapshotFile.saveId !== metadata.saveId) {
        throw new CorruptedSaveError(
          displayName,
          `paire meta/snapshot dépareillée (saveId "${rawSnapshotFile.saveId}" du fichier ` +
            `snapshot ≠ "${metadata.saveId}" des métadonnées).`,
        );
      }

      // `snapshotHash` est volontairement écrit dans LES DEUX fichiers. Vérifier
      // seulement l'empreinte recalculée contre les métadonnées protégerait bien le
      // contenu, mais laisserait la copie du fichier snapshot totalement décorative :
      // une paire provenant de deux écritures différentes pourrait conserver le même
      // `saveId` après une manipulation externe et passer ce contrôle. Les trois
      // valeurs doivent donc former une seule chaîne de confiance.
      if (rawSnapshotFile.snapshotHash !== metadata.snapshotHash) {
        throw new CorruptedSaveError(
          displayName,
          'paire meta/snapshot dépareillée (snapshotHash différents).',
        );
      }
      const recomputedHash = computeSnapshotHash(snapshot);
      if (recomputedHash !== rawSnapshotFile.snapshotHash) {
        throw new CorruptedSaveError(
          displayName,
          'snapshotHash ne correspond pas au contenu réel du snapshot.',
        );
      }
      if (metadata.tick !== snapshot.clock.currentTick) {
        throw new CorruptedSaveError(
          displayName,
          `tick des métadonnées (${metadata.tick}) ≠ tick du snapshot (${snapshot.clock.currentTick}).`,
        );
      }
      if (metadata.seed !== snapshot.seed) {
        throw new CorruptedSaveError(
          displayName,
          `seed des métadonnées ("${metadata.seed}") ≠ seed du snapshot ("${snapshot.seed}").`,
        );
      }
      if (metadata.configFingerprint !== snapshot.configFingerprint) {
        throw new CorruptedSaveError(
          displayName,
          'configFingerprint des métadonnées ne correspond pas à celui du snapshot.',
        );
      }

      return { found: true, envelope: { metadata, snapshot } };
    } catch (error) {
      return { found: true, envelope: null, error };
    }
  }

  /**
   * Décale `slot` (courant) → `bak1` → `bak2` → … → `bakN`, en purgeant ce qui dépasse
   * `backupCount`. Appelé avant chaque écriture réussie, jamais après : si `save()`
   * échoue en cours de route, la version courante et ses backups précédents restent
   * intacts plutôt que d'avoir été décalés pour rien.
   */
  private async rotateBackups(name: string): Promise<void> {
    if (this.backupCount <= 0) return;

    const oldestBase = `${name}.bak${this.backupCount}`;
    await this.removeSlotFiles(oldestBase);

    for (let i = this.backupCount - 1; i >= 1; i--) {
      await this.renameSlotFiles(`${name}.bak${i}`, `${name}.bak${i + 1}`);
    }
    await this.renameSlotFiles(name, `${name}.bak1`);
  }

  private async renameSlotFiles(fromBase: string, toBase: string): Promise<void> {
    for (const suffix of [SNAPSHOT_SUFFIX, META_SUFFIX]) {
      const from = join(this.directory, `${fromBase}${suffix}`);
      const to = join(this.directory, `${toBase}${suffix}`);
      try {
        await rename(from, to);
      } catch (error) {
        if (isErrnoException(error) && error.code === 'ENOENT') continue;
        throw error;
      }
    }
  }

  private async removeSlotFiles(base: string): Promise<void> {
    await this.removeIfExists(join(this.directory, `${base}${META_SUFFIX}`));
    await this.removeIfExists(join(this.directory, `${base}${SNAPSHOT_SUFFIX}`));
  }

  private async withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(name) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    // La map ne doit jamais retenir un rejet : `withLock` propage l'erreur à SON
    // appelant via `run`, mais l'entrée stockée sert seulement à séquencer les APPELS
    // suivants, qui doivent démarrer même si celui-ci a échoué.
    this.locks.set(
      name,
      run.catch(() => undefined),
    );
    return run;
  }

  async list(): Promise<SaveMetadata[]> {
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') return [];
      throw error;
    }

    // Les backups (`slot.bakN.meta.json`) ne sont pas des slots à part entière : ils ne
    // doivent jamais apparaître comme sauvegardes indépendantes dans la liste.
    const metadataFiles = entries.filter(
      (entry) => entry.endsWith(META_SUFFIX) && !/\.bak\d+\.meta\.json$/.test(entry),
    );
    const results: SaveMetadata[] = [];
    for (const file of metadataFiles) {
      const raw = await this.readJson<unknown>(join(this.directory, file));
      if (raw === null) continue;
      const slotName = file.slice(0, -META_SUFFIX.length);
      try {
        results.push(validateSaveMetadata(raw, slotName));
      } catch {
        // Métadonnées corrompues : ignorées plutôt que de faire échouer tout `list()`
        // pour une seule entrée illisible — `load()`/`loadLatestValid()` restent la
        // source de vérité pour un chargement réel, où la corruption n'est jamais
        // masquée.
      }
    }
    // Plus récent d'abord : c'est ce qu'un utilisateur veut voir en premier.
    results.sort((a, b) => b.savedAtIso.localeCompare(a.savedAtIso));
    return results;
  }

  async delete(name: string): Promise<void> {
    assertSafeName(name);
    return this.withLock(name, async () => {
      // Les métadonnées d'abord : dès qu'elles disparaissent, la sauvegarde n'est plus
      // « visible », même si la suppression du snapshot échoue ensuite.
      await this.removeSlotFiles(name);
      // Un slot supprimé n'a plus d'historique à offrir : ses backups aussi disparaissent,
      // sinon `loadLatestValid()` d'un slot "supprimé" ressusciterait une vieille version.
      for (let i = 1; i <= this.backupCount; i++) {
        await this.removeSlotFiles(`${name}.bak${i}`);
      }
      // Jamais backupée (voir `saveThumbnail`) : une seule copie à retirer.
      await this.removeIfExists(join(this.directory, `${name}${THUMBNAIL_SUFFIX}`));
    });
  }

  async rename(from: string, to: string): Promise<SaveMetadata> {
    assertSafeName(from);
    assertSafeName(to);
    if (from === to) {
      throw new Error(`Nom de sauvegarde invalide : "${to}" est identique au nom actuel.`);
    }
    // Verrous imbriqués sur deux noms DIFFÉRENTS : jamais de ré-entrance sur le même nom
    // (voir la doc de `writeEnvelope`), donc pas de risque de blocage.
    return this.withLock(from, () =>
      this.withLock(to, async () => {
        const source = await this.loadSlotFiles(from, from);
        if (source === null) {
          throw new Error(`Sauvegarde "${from}" introuvable — impossible de la renommer.`);
        }
        if ((await this.loadSlotFiles(to, to)) !== null) {
          throw new Error(`Une sauvegarde nommée "${to}" existe déjà.`);
        }

        const metadata = await this.writeUnderNewName(to, source);
        // Suppression de l'original SEULEMENT après l'écriture réussie sous le nouveau
        // nom : jamais les deux perdues à la fois si le processus meurt entre les deux.
        await this.removeSlotFiles(from);
        for (let i = 1; i <= this.backupCount; i++) await this.removeSlotFiles(`${from}.bak${i}`);
        await this.moveThumbnailIfPresent(from, to);
        return metadata;
      }),
    );
  }

  async duplicate(from: string, to: string): Promise<SaveMetadata> {
    assertSafeName(from);
    assertSafeName(to);
    if (from === to) {
      throw new Error(`Nom de sauvegarde invalide : "${to}" est identique au nom source.`);
    }
    return this.withLock(from, () =>
      this.withLock(to, async () => {
        const source = await this.loadSlotFiles(from, from);
        if (source === null) {
          throw new Error(`Sauvegarde "${from}" introuvable — impossible de la dupliquer.`);
        }
        if ((await this.loadSlotFiles(to, to)) !== null) {
          throw new Error(`Une sauvegarde nommée "${to}" existe déjà.`);
        }
        const snapshot: SimulationSnapshot = { ...source.snapshot, worldId: randomUUID() };
        const metadata = await this.writeUnderNewName(to, {
          snapshot,
          metadata: { ...source.metadata, snapshotHash: computeSnapshotHash(snapshot) },
        });
        await this.copyThumbnailIfPresent(from, to);
        return metadata;
      }),
    );
  }

  /** Best-effort : l'absence de miniature n'empêche jamais un renommage/une duplication. */
  private async moveThumbnailIfPresent(from: string, to: string): Promise<void> {
    try {
      await rename(
        join(this.directory, `${from}${THUMBNAIL_SUFFIX}`),
        join(this.directory, `${to}${THUMBNAIL_SUFFIX}`),
      );
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') return;
      throw error;
    }
  }

  private async copyThumbnailIfPresent(from: string, to: string): Promise<void> {
    const thumbnail = await this.loadThumbnail(from);
    if (thumbnail === null) return;
    await this.writeAtomically(join(this.directory, `${to}${THUMBNAIL_SUFFIX}`), thumbnail);
  }

  /**
   * Écrit une enveloppe déjà chargée sous un nouveau nom, avec un `saveId` frais — c'est
   * un nouvel événement de sauvegarde, même quand le contenu simulé copié est identique
   * à l'instant de l'opération. `snapshotHash` reste inchangé : le contenu du snapshot
   * lui-même n'a pas bougé.
   */
  private async writeUnderNewName(name: string, source: SaveEnvelope): Promise<SaveMetadata> {
    const metadata: SaveMetadata = { ...source.metadata, saveId: randomUUID(), name };
    await this.writeEnvelope(name, { metadata, snapshot: source.snapshot });
    return metadata;
  }

  private async writeAtomically(finalPath: string, content: string | Buffer): Promise<void> {
    const tmpPath = `${finalPath}.tmp-${randomBytes(6).toString('hex')}`;
    // `undefined` (pas d'encodage) pour un `Buffer` binaire : forcer `'utf8'` sur des
    // octets JPEG corromprait l'image, l'encodage n'a de sens que pour du texte.
    await writeFile(tmpPath, content, typeof content === 'string' ? 'utf8' : undefined);
    await rename(tmpPath, finalPath);
  }

  /**
   * Miniature d'aperçu — jamais nécessaire à la simulation, seulement à l'affichage
   * dans « Mes mondes ». `jpegBase64` est le contenu déjà encodé en JPEG (le client
   * capture le canvas et l'encode ; ce module ne fait que le stocker tel quel).
   */
  async saveThumbnail(name: string, jpegBase64: string): Promise<void> {
    assertSafeName(name);
    await mkdir(this.directory, { recursive: true });
    await this.writeAtomically(
      join(this.directory, `${name}${THUMBNAIL_SUFFIX}`),
      Buffer.from(jpegBase64, 'base64'),
    );
  }

  /** `null` si ce monde n'a encore aucune miniature — un cas normal, pas une erreur. */
  async loadThumbnail(name: string): Promise<Buffer | null> {
    assertSafeName(name);
    try {
      return await readFile(join(this.directory, `${name}${THUMBNAIL_SUFFIX}`));
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  private async readJson<T>(path: string): Promise<T | null> {
    try {
      const raw = await readFile(path, 'utf8');
      return JSON.parse(raw) as T;
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  private async removeIfExists(path: string): Promise<void> {
    try {
      await rm(path);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') return;
      throw error;
    }
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/**
 * Un nom de sauvegarde devient un nom de fichier : interdit toute tentative de
 * traversée de répertoire (`../secret`) ou de séparateur de chemin.
 */
function assertSafeName(name: string): void {
  if (name.length === 0 || name.length > 128) {
    throw new Error(`Nom de sauvegarde invalide : longueur (${name.length}) hors limites.`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      `Nom de sauvegarde invalide : "${name}" — seuls lettres, chiffres, "-", "_" sont autorisés.`,
    );
  }
}
