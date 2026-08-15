import type {
  ChunkPayload,
  ChunkStats,
  ClockSnapshot,
  EnvironmentSnapshot,
  HumanProfile,
  HumanState,
  NetworkEvent,
  ServerMessage,
  SimulationStats,
  WorldDescriptor,
  WorldGenerationMetadata,
} from '@civ/shared';
import { computeAlpha, lerp, lerpAngle } from './interpolation.js';

export interface InterpolatedPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
}

/** Un humain connu du client : sa fiche, son dernier état, et l'état précédent. */
export interface HumanRecord {
  profile: HumanProfile;
  current: HumanState;
  previous: HumanState;
  previousAt: number;
  currentAt: number;
}

export interface WorldStoreEvents {
  onHumanAdded?: (record: HumanRecord) => void;
  onHumanRemoved?: (id: number) => void;
  onWorldReady?: (world: WorldDescriptor, generation: WorldGenerationMetadata) => void;
  /** Premier état d'intérêt reçu, y compris pour une zone sans aucun humain. */
  onPopulationReady?: () => void;
  onEvents?: (events: readonly NetworkEvent[]) => void;
  onChunk?: (chunk: ChunkPayload) => void;
  onChunkUnload?: (keys: readonly string[]) => void;
  /**
   * Une ressource du monde vient d'être consommée : l'afficher disparue.
   * L'adresse est compacte : `(chunkKey, localId)` → le client tient la table de
   * correspondance depuis le payload initial du chunk.
   */
  onResourceRemoved?: (chunkKey: string, localId: number) => void;
  /** Une ressource procédurale précédemment cachée redevient disponible. */
  onResourceAdded?: (
    chunkKey: string,
    localId: number,
    fields: Record<string, number | string | boolean>,
  ) => void;
  /**
   * Une ressource à plusieurs portions vient d'être partiellement récoltée (elle reste
   * dans le monde). Adresse compacte comme `onResourceRemoved` ; `changedFields` est
   * générique (CLAUDE.md : supporte de futures propriétés sans changer le protocole) —
   * aujourd'hui, seule `remainingFraction01` (0..1, fraction ABSOLUE restante — pas un
   * pourcentage de progression) est réellement produite.
   */
  onResourceUpdated?: (
    chunkKey: string,
    localId: number,
    changedFields: Record<string, number | string | boolean>,
  ) => void;
  onTrailUpdated?: (
    chunkKey: string,
    resolution: number,
    cells: readonly { index: number; wear: number }[],
  ) => void;
  /**
   * Un saut a été détecté dans la séquence `snapshot`/`delta` (un message perdu en
   * route) : le miroir local n'est plus fiable. L'appelant doit envoyer `{ t: 'resync' }`
   * au serveur — `WorldStore` ne connaît pas la connexion, il ne fait que le signaler.
   */
  onDesyncDetected?: () => void;
}

/**
 * Miroir local de l'état du serveur.
 *
 * Le client ne calcule jamais l'état du monde : il l'applique. La seule chose qu'il
 * invente est l'interpolation entre deux échantillons, et uniquement pour l'affichage.
 */
export class WorldStore {
  private readonly humans = new Map<number, HumanRecord>();
  /** Fiches reçues dont l'état n'est pas encore arrivé (ordre des messages non garanti). */
  private readonly pendingProfiles = new Map<number, HumanProfile>();
  private readonly listeners: WorldStoreEvents;
  /**
   * Numéro de séquence `snapshot`/`delta` attendu au PROCHAIN message — `null` tant
   * qu'aucun `init`/`snapshot` (les seuls points de référence fiables) n'a encore été
   * reçu. Contrôle réel de la continuité : voir `apply()`.
   */
  private expectedSequence: number | null = null;
  /**
   * Vrai dès qu'un saut de séquence a été détecté, jusqu'au prochain `snapshot` complet.
   * Tant que c'est vrai, TOUT `delta` reçu est ignoré — pas seulement celui qui a raté sa
   * séquence. Bug corrigé : avant ce flag, `expectedSequence` était réavancé même sur un
   * delta fautif (`= message.sequenceNumber + 1`), donc le delta SUIVANT — s'il reprenait
   * une séquence continue par rapport au fautif — était accepté avant même que le
   * `snapshot` de resynchronisation soit arrivé, laissant le miroir local repartir sur un
   * état qui a un trou (un retrait manqué, par exemple, ne serait plus jamais rejoué).
   */
  private awaitingResync = false;
  private populationReady = false;

  world: WorldDescriptor | null = null;
  clock: ClockSnapshot | null = null;
  environment: EnvironmentSnapshot | null = null;
  stats: SimulationStats | null = null;
  chunkStats: ChunkStats | null = null;
  clientCount = 0;
  lastMessageAt = 0;

  /** Retard d'affichage en ms : ~1,5 intervalle réseau, absorbe la gigue. */
  renderDelayMs = 150;

  constructor(listeners: WorldStoreEvents = {}) {
    this.listeners = listeners;
  }

  get humanCount(): number {
    return this.humans.size;
  }

  get(id: number): HumanRecord | undefined {
    return this.humans.get(id);
  }

  values(): IterableIterator<HumanRecord> {
    return this.humans.values();
  }

  apply(message: ServerMessage, receivedAt: number): void {
    this.lastMessageAt = receivedAt;

    switch (message.t) {
      case 'init':
        this.world = message.world;
        this.clock = message.clock;
        this.environment = message.environment;
        this.reset();
        // Ancre la continuité dès la connexion : le premier `snapshot`/`delta` qui suit
        // doit porter `sequenceNumber + 1`. Sans ça, un tout premier delta perdu juste
        // après l'init n'avait aucune référence à comparer et passait inaperçu.
        this.expectedSequence = message.sequenceNumber + 1;
        // La scène est (re)construite avant d'injecter la population : dans l'autre ordre,
        // une reconstruction de scène effacerait les avatars tout juste créés.
        this.listeners.onWorldReady?.(message.world, message.generation);
        this.upsertProfiles(message.profiles);
        this.upsertStates(message.humans, receivedAt);
        this.listeners.onEvents?.(message.history);
        return;

      case 'chunk':
        this.listeners.onChunk?.(message.chunk);
        return;

      case 'chunkUnload':
        this.listeners.onChunkUnload?.(message.keys);
        return;

      case 'snapshot':
        // Un `snapshot` est l'état COMPLET de la zone observée, jamais un diff : il est toujours accepté
        // et redevient la référence, quelle que soit la séquence précédente — c'est
        // justement ce qu'un `resync` obtient pour sortir d'un désync. Il porte aussi
        // TOUTES les fiches (`profiles`), pas seulement les états : un client qui répond
        // à un resync n'a par définition aucune fiche fiable en mémoire — le delta perdu
        // pouvait justement en introduire une nouvelle.
        this.awaitingResync = false;
        this.expectedSequence = message.sequenceNumber + 1;
        this.clock = message.clock;
        this.environment = message.environment;
        this.upsertProfiles(message.profiles);
        this.upsertStates(message.humans, receivedAt);
        this.removeMissing(message.humans);
        this.markPopulationReady();
        return;

      case 'delta': {
        // Contrôle réel de la continuité : un `delta` est calculé par le serveur contre
        // CE QU'IL CROIT que cette session connaît déjà (voir `ClientSession.computeDelta`)
        // — si un message a été perdu en route, l'appliquer quand même laisserait des
        // humains dans un état périmé pour de bon (un retrait manqué, par exemple, ne
        // sera plus jamais renvoyé). Un saut de séquence est donc une raison de
        // s'ARRÊTER d'appliquer des deltas et de redemander un état complet, pas de
        // deviner — et cet arrêt dure jusqu'au `snapshot` de resynchronisation, pas
        // seulement pour le delta fautif : voir `awaitingResync`.
        if (this.awaitingResync) return;

        const expected = this.expectedSequence;
        const gapDetected = expected !== null && message.sequenceNumber !== expected;
        if (gapDetected) {
          this.awaitingResync = true;
          console.warn(
            `[net] désynchronisation détectée (séquence attendue ${expected}, ` +
              `reçue ${message.sequenceNumber}) — resync demandé`,
          );
          this.listeners.onDesyncDetected?.();
          return;
        }

        this.expectedSequence = message.sequenceNumber + 1;
        this.clock = message.clock;
        this.environment = message.environment;
        this.upsertProfiles(message.profiles);
        this.upsertStates(message.humans, receivedAt);
        for (const id of message.removed) this.remove(id);
        this.markPopulationReady();
        return;
      }

      case 'events':
        this.listeners.onEvents?.(message.events);
        return;

      case 'stats':
        this.stats = message.stats;
        this.chunkStats = message.chunks;
        this.clientCount = message.clientCount;
        return;

      case 'pong':
        return;

      case 'error':
        console.error(`[net] erreur serveur (${message.code}): ${message.message}`);
        return;

      case 'resource:removed':
        // Retrait immédiat : le client hide le mesh désigné par `(chunkKey, localId)`.
        this.listeners.onResourceRemoved?.(message.chunkKey, message.localId);
        return;

      case 'resource:updated':
        // Récolte partielle : la ressource reste dans le monde, seule son apparence change.
        this.listeners.onResourceUpdated?.(
          message.chunkKey,
          message.localId,
          message.changedFields,
        );
        return;

      case 'resource:added':
        this.listeners.onResourceAdded?.(message.chunkKey, message.localId, message.fields);
        return;

      case 'trail:updated':
        this.listeners.onTrailUpdated?.(message.chunkKey, message.resolution, message.cells);
        return;

      default: {
        const exhaustive: never = message;
        console.warn('[net] message inconnu', exhaustive);
      }
    }
  }

  /** Pose affichable à l'instant présent, interpolée entre les deux derniers états. */
  poseOf(record: HumanRecord, now: number): InterpolatedPose {
    const alpha = computeAlpha(record.previousAt, record.currentAt, now - this.renderDelayMs);
    return {
      x: lerp(record.previous.x, record.current.x, alpha),
      y: lerp(record.previous.y, record.current.y, alpha),
      z: lerp(record.previous.z, record.current.z, alpha),
      yaw: lerpAngle(record.previous.yaw, record.current.yaw, alpha),
      speed: lerp(record.previous.speed, record.current.speed, alpha),
    };
  }

  reset(): void {
    for (const id of [...this.humans.keys()]) this.remove(id);
    this.pendingProfiles.clear();
    this.expectedSequence = null;
    this.awaitingResync = false;
    this.populationReady = false;
  }

  /* ---- Interne -------------------------------------------------------- */

  private upsertProfiles(profiles: readonly HumanProfile[]): void {
    for (const profile of profiles) {
      const existing = this.humans.get(profile.id);
      if (existing) existing.profile = profile;
      else this.pendingProfiles.set(profile.id, profile);
    }
  }

  private upsertStates(states: readonly HumanState[], receivedAt: number): void {
    for (const state of states) {
      const existing = this.humans.get(state.id);
      if (existing) {
        existing.previous = existing.current;
        existing.previousAt = existing.currentAt;
        existing.current = state;
        existing.currentAt = receivedAt;
        continue;
      }

      const profile = this.pendingProfiles.get(state.id);
      if (!profile) {
        // Un état sans fiche ne peut pas être affiché : le prochain snapshot complet
        // rétablira la cohérence, inutile de deviner.
        console.warn(`[net] état reçu pour l'humain ${state.id} sans profil connu`);
        continue;
      }
      this.pendingProfiles.delete(state.id);

      const record: HumanRecord = {
        profile,
        current: state,
        previous: state,
        previousAt: receivedAt,
        currentAt: receivedAt,
      };
      this.humans.set(state.id, record);
      this.listeners.onHumanAdded?.(record);
    }
  }

  private removeMissing(states: readonly HumanState[]): void {
    const present = new Set(states.map((state) => state.id));
    for (const id of [...this.humans.keys()]) {
      if (!present.has(id)) this.remove(id);
    }
  }

  private remove(id: number): void {
    if (!this.humans.delete(id)) return;
    this.pendingProfiles.delete(id);
    this.listeners.onHumanRemoved?.(id);
  }

  private markPopulationReady(): void {
    if (this.populationReady) return;
    this.populationReady = true;
    this.listeners.onPopulationReady?.();
  }
}
