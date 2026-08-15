import { createHash, randomUUID } from 'node:crypto';
import type { Simulation } from '../simulation.js';
import type { SimulationSnapshot } from './simulationSnapshot.js';

/**
 * Version du format d'enveloppe de sauvegarde — distincte de
 * `SIMULATION_SNAPSHOT_VERSION` (qui versionne le contenu du snapshot lui-même).
 * Celle-ci versionne l'emballage (métadonnées + snapshot) : elle change si la façon
 * de structurer un fichier de sauvegarde change, indépendamment du contenu simulé.
 */
export const SAVE_FORMAT_VERSION = 2;

/**
 * Métadonnées légères d'une sauvegarde — lisibles sans charger le snapshot complet.
 * Permet à `list()` de rester rapide même avec de nombreuses sauvegardes volumineuses
 * (des mondes avec des milliers d'individus).
 */
export interface SaveMetadata {
  readonly formatVersion: number;
  /**
   * Identifiant unique de CET événement de sauvegarde (généré à chaque `save()`,
   * jamais réutilisé) — distinct de `name`/`saveSlot`, qui identifie un emplacement
   * réutilisable. Sert à distancer sans ambiguïté deux écritures successives du même
   * slot (rotation des backups, diagnostics) même quand `savedAtIso` a une résolution
   * trop grossière pour départager deux sauvegardes rapprochées.
   */
  readonly saveId: string;
  /**
   * Empreinte SHA-256 du contenu exact du snapshot écrit sous CE `saveId` (voir
   * `computeSnapshotHash`). Le fichier `.snapshot.json` embarque le même couple
   * `(saveId, snapshotHash)` — au chargement, les deux paires doivent correspondre pour
   * que la sauvegarde soit acceptée. Sans ceci, `meta.json` et `snapshot.json` sont
   * renommés séparément (voir la doc de `FilePersistenceAdapter`) : un crash pile entre
   * les deux renommages d'une écriture ULTÉRIEURE peut laisser un `meta.json` neuf à
   * côté d'un `snapshot.json` resté ancien (ou l'inverse) — deux fichiers individuellement
   * valides, mais qui ne décrivent pas le même événement de sauvegarde.
   */
  readonly snapshotHash: string;
  readonly name: string;
  readonly seed: string;
  readonly generationVersion: string;
  /**
   * Empreinte de la `SimulationConfig` + géométrie du monde au moment de la
   * sauvegarde (copie de `SimulationSnapshot.configFingerprint`) — dupliquée ici pour
   * qu'un outil de gestion des sauvegardes puisse repérer une incompatibilité de
   * configuration sans charger le snapshot complet.
   */
  readonly configFingerprint: string;
  /**
   * Horodatage ISO 8601 de la sauvegarde. Fourni par l'appelant (serveur, CLI) : la
   * simulation elle-même ne connaît jamais l'heure murale (CLAUDE.md règle 4).
   */
  readonly savedAtIso: string;
  readonly tick: number;
  readonly humanCount: number;
  /** Étiquette libre pour l'utilisateur (« avant-catastrophe », « autosave »…). */
  readonly label?: string;
}

/** Enveloppe complète d'une sauvegarde : métadonnées + état simulable. */
export interface SaveEnvelope {
  readonly metadata: SaveMetadata;
  readonly snapshot: SimulationSnapshot;
}

/**
 * Contrat de persistance — indépendant du support (fichier local aujourd'hui, autre
 * backend demain). Toutes les opérations sont asynchrones : un support réseau ou une
 * base de données future n'imposera pas de changer les appelants.
 */
export interface PersistenceAdapter {
  /** Écrit la sauvegarde de façon atomique : jamais de fichier à moitié écrit visible. */
  save(name: string, envelope: SaveEnvelope): Promise<void>;
  /** `null` si aucune sauvegarde de ce nom n'existe. */
  load(name: string): Promise<SaveEnvelope | null>;
  /** Métadonnées de toutes les sauvegardes connues, triées par date décroissante. */
  list(): Promise<SaveMetadata[]>;
  /** Ne lève pas si la sauvegarde n'existait pas déjà. */
  delete(name: string): Promise<void>;
  /**
   * Déplace un slot vers un nouveau nom (renommage) : charge l'enveloppe existante, la
   * réécrit sous `to` avec un `saveId` frais, puis supprime `from` (et ses backups) une
   * fois l'écriture réussie — jamais l'inverse, pour ne jamais perdre les deux copies à
   * la fois si le processus meurt entre les deux étapes. Lève si `from` n'existe pas ou
   * si `to` existe déjà.
   */
  rename(from: string, to: string): Promise<SaveMetadata>;
  /**
   * Copie un slot vers un nouveau nom : l'original reste intact. Comme `rename`, la
   * copie reçoit un `saveId` frais (c'est un nouvel événement de sauvegarde, même si le
   * contenu simulé est identique à l'instant de la copie). Lève si `from` n'existe pas
   * ou si `to` existe déjà.
   */
  duplicate(from: string, to: string): Promise<SaveMetadata>;
  /**
   * Miniature d'aperçu — jamais nécessaire à la simulation, seulement à l'affichage
   * dans une liste de mondes. Aucune garantie d'intégrité meta/snapshot ne s'applique
   * (pas de `saveId`/`snapshotHash`, pas de backups) : une miniature perdue ou absente
   * n'est jamais une perte de progression.
   */
  saveThumbnail(name: string, jpegBase64: string): Promise<void>;
  /** `null` si ce monde n'a encore aucune miniature — un cas normal, pas une erreur. */
  loadThumbnail(name: string): Promise<Buffer | null>;
}

/**
 * Erreur explicite plutôt qu'une migration silencieuse (CLAUDE.md « pas de faux
 * code ») : un format de sauvegarde plus ancien ou plus récent que celui-ci est refusé.
 */
export class IncompatibleSaveFormatError extends Error {
  constructor(
    readonly foundVersion: number,
    readonly expectedVersion: number,
  ) {
    super(
      `Format de sauvegarde incompatible : trouvé v${foundVersion}, attendu v${expectedVersion}.`,
    );
    this.name = 'IncompatibleSaveFormatError';
  }
}

/**
 * Sauvegarde structurellement invalide : un fichier a été lu et parsé comme JSON avec
 * succès, mais son contenu ne ressemble pas à une `SaveMetadata`/`SimulationSnapshot`
 * (champ manquant, type incorrect). Distincte de `IncompatibleSaveFormatError` (version
 * reconnue mais rejetée délibérément) — celle-ci signale un fichier tronqué, corrompu,
 * ou étranger, jamais rencontré via un chemin normal du programme.
 */
export class CorruptedSaveError extends Error {
  constructor(name: string, reason: string) {
    super(`Sauvegarde "${name}" corrompue : ${reason}`);
    this.name = 'CorruptedSaveError';
  }
}

/**
 * Empreinte du contenu exact d'un `SimulationSnapshot`, indépendante de `saveId` (qui
 * identifie l'ÉVÉNEMENT d'écriture, pas le contenu). Basée sur la même sérialisation
 * `JSON.stringify` que celle réellement écrite sur disque : `JSON.stringify` est
 * déterministe pour un même objet (l'ordre des clés d'un objet JS, y compris le
 * réordonnancement des clés numériques par le moteur, est stable), donc recalculer
 * cette empreinte depuis un snapshot relu produit la même valeur que celle calculée à
 * l'écriture, tant que le contenu n'a pas changé.
 */
export function computeSnapshotHash(snapshot: SimulationSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Valide la forme minimale d'une `SaveMetadata` lue depuis le disque avant de la faire
 * confiance. Un `JSON.parse` réussi ne garantit rien sur la forme du contenu — un
 * fichier tronqué par un crash au milieu d'une écriture non atomique externe (copie
 * manuelle, synchronisation cloud interrompue…) peut rester du JSON valide tout en
 * ayant perdu des champs.
 */
export function validateSaveMetadata(value: unknown, name: string): SaveMetadata {
  if (!isRecord(value)) throw new CorruptedSaveError(name, 'métadonnées absentes ou non-objet.');
  const errors: string[] = [];
  if (typeof value.formatVersion !== 'number') errors.push('formatVersion manquant');
  if (!isNonEmptyString(value.saveId)) errors.push('saveId manquant');
  if (!isNonEmptyString(value.snapshotHash)) errors.push('snapshotHash manquant');
  if (!isNonEmptyString(value.name)) errors.push('name manquant');
  if (!isNonEmptyString(value.seed)) errors.push('seed manquant');
  if (!isNonEmptyString(value.generationVersion)) errors.push('generationVersion manquant');
  if (!isNonEmptyString(value.configFingerprint)) errors.push('configFingerprint manquant');
  if (!isNonEmptyString(value.savedAtIso)) errors.push('savedAtIso manquant');
  if (typeof value.tick !== 'number') errors.push('tick manquant');
  if (typeof value.humanCount !== 'number') errors.push('humanCount manquant');
  if (errors.length > 0) throw new CorruptedSaveError(name, errors.join(', ') + '.');
  return value as unknown as SaveMetadata;
}

/**
 * Valide la forme minimale d'un `SimulationSnapshot` lu depuis le disque. Ne vérifie
 * pas la cohérence interne (ex. tous les `entityId` référencés existent) — seulement
 * que les champs structurants attendus par `restoreSnapshot` sont présents avec le bon
 * type, pour échouer proprement avant de passer un objet à moitié formé au reste du
 * moteur.
 */
export function validateSimulationSnapshot(value: unknown, name: string): SimulationSnapshot {
  if (!isRecord(value)) throw new CorruptedSaveError(name, 'snapshot absent ou non-objet.');
  const errors: string[] = [];
  if (typeof value.version !== 'number') errors.push('version manquante');
  if (value.worldId !== undefined && !isNonEmptyString(value.worldId)) errors.push('worldId invalide');
  if (!isNonEmptyString(value.seed)) errors.push('seed manquant');
  if (!isNonEmptyString(value.generationVersion)) errors.push('generationVersion manquant');
  if (!isNonEmptyString(value.configFingerprint)) errors.push('configFingerprint manquant');
  if (!isRecord(value.clock)) errors.push('clock manquant');
  if (!isRecord(value.rng)) errors.push('rng manquant');
  if (
    !isRecord(value.entities) ||
    !Array.isArray((value.entities as Record<string, unknown>).ids)
  ) {
    errors.push('entities manquant ou invalide');
  }
  if (!isRecord(value.scheduler)) errors.push('scheduler manquant');
  if (!isRecord(value.delta)) errors.push('delta manquant');
  if (value.history !== undefined && !Array.isArray(value.history)) {
    errors.push('history invalide');
  }
  if (errors.length > 0) throw new CorruptedSaveError(name, errors.join(', ') + '.');
  return value as unknown as SimulationSnapshot;
}

/**
 * Construit l'enveloppe complète à partir d'une simulation vivante.
 *
 * `savedAtIso` est fourni par l'appelant (jamais lu depuis `Date.now()` ici) : CLAUDE.md
 * règle 4 interdit toute source de temps mural dans le cœur de simulation, et ce module
 * de persistance — bien qu'il touche le disque — reste logiquement adjacent au cœur.
 * Seuls `apps/server` et `packages/simulation/src/cli` ont le droit de lire l'horloge
 * murale ; ce sont eux qui appellent cette fonction avec `new Date().toISOString()`.
 */
export function createSaveEnvelope(
  simulation: Simulation,
  name: string,
  savedAtIso: string,
  label?: string,
): SaveEnvelope {
  const snapshot = simulation.captureSnapshot();
  const metadata: SaveMetadata = {
    formatVersion: SAVE_FORMAT_VERSION,
    saveId: randomUUID(),
    snapshotHash: computeSnapshotHash(snapshot),
    name,
    seed: snapshot.seed,
    generationVersion: snapshot.generationVersion,
    configFingerprint: snapshot.configFingerprint,
    savedAtIso,
    tick: snapshot.clock.currentTick,
    humanCount: simulation.humanCount,
    ...(label === undefined ? {} : { label }),
  };
  return { metadata, snapshot };
}
