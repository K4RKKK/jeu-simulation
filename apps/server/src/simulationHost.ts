import { randomUUID } from 'node:crypto';
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type NetworkEvent,
  type ServerMessage,
} from '@civ/shared';
import { buildWorldGenerationMetadata } from '@civ/procedural';
import {
  createSaveEnvelope,
  FilePersistenceAdapter,
  Simulation,
  SimulationLoop,
  buildHumanProfiles,
  buildHumanStates,
  type SaveMetadata,
} from '@civ/simulation';
import type { WebSocket } from 'ws';
import type { ServerConfig } from './config.js';
import { sendToSessionsHoldingChunk } from './net/chunkScopedBroadcast.js';
import { ChunkStreamer } from './net/chunkStreamer.js';
import { ClientSession } from './net/clientSession.js';
import { EntityInterestManager, eventsForInterest } from './net/entityInterestManager.js';
import { toNetworkEvent } from './net/eventFormatter.js';
import { ChunkManager } from './world/chunkManager.js';
import { WorldSaveCoordinator } from './worldSaveCoordinator.js';

/** Aucun monde de ce nom n'a de sauvegarde — distinct d'une erreur de validation. */
export class WorldNotFoundError extends Error {
  constructor(readonly worldName: string) {
    super(`Monde "${worldName}" introuvable.`);
    this.name = 'WorldNotFoundError';
  }
}

/** Le monde actuellement servi ne peut pas être renommé/supprimé sous lui-même. */
export class ActiveWorldConflictError extends Error {
  constructor(
    readonly worldName: string,
    action: string,
  ) {
    super(
      `Impossible de ${action} le monde actif ("${worldName}") — changez d'abord de monde actif.`,
    );
    this.name = 'ActiveWorldConflictError';
  }
}

/** Persistance désactivée (`CIV_SAVE_DIR` vide) : aucune opération sur des mondes nommés. */
export class PersistenceDisabledError extends Error {
  constructor() {
    super(
      'Persistance désactivée sur ce serveur (CIV_SAVE_DIR vide) — mondes éphémères uniquement.',
    );
    this.name = 'PersistenceDisabledError';
  }
}

/**
 * Hôte de la simulation.
 *
 * Responsabilité : faire vivre un monde et le diffuser. Le monde tourne dès le démarrage du
 * processus, qu'un client soit connecté ou non. Aucune règle de jeu n'est décidée ici :
 * l'hôte lit l'état, il ne l'écrit jamais — la seule exception étant la régénération d'un
 * monde neuf, réservée au développement.
 */
export class SimulationHost {
  private simulation: Simulation;
  private loop: SimulationLoop;
  private chunks: ChunkManager;
  private streamer: ChunkStreamer;
  private entityInterest: EntityInterestManager;

  private readonly sessions = new Set<ClientSession>();
  private netTimer: ReturnType<typeof setInterval> | null = null;
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;
  private lastFullSnapshotTick = 0;
  private lastStatsTick = 0;
  private lastAutosaveTick = 0;
  /**
   * Numéro de tour de diffusion, incrémenté une fois par `broadcast()`. Sert
   * uniquement à horodater les messages `resource:removed`/`resource:updated`/
   * `resource:added`/`trail:updated`, dont le client ne vérifie pas encore la
   * continuité (le `client:resync` n'existe pas). Ce n'est PAS la séquence d'état —
   * pour `snapshot`/`delta`, voir `ClientSession.nextStateSequence()`, qui avance par
   * session et seulement quand un état part réellement vers ce client (un compteur
   * global aurait produit de faux sauts dès qu'un client ne recevait rien un tour).
   */
  private sequenceNumber = 0;
  private readonly persistence: FilePersistenceAdapter | null;
  private readonly saves: WorldSaveCoordinator;
  /**
   * Nom du slot de sauvegarde actuellement servi — remplace `config.saveSlot` comme
   * cible de l'autosave dès que `createWorld()`/`activateWorld()` bascule le monde actif.
   * `config` reste `readonly` (c'est la configuration d'HÉBERGEMENT au démarrage) ; ce
   * champ est la seule source de vérité mutable pour « quel monde tourne maintenant ».
   */
  private activeWorldName: string;
  private activeWorldLabel: string | undefined;
  private recoveryNotice: string | null = null;
  private started = false;

  constructor(private readonly config: ServerConfig) {
    const built = this.buildWorld(config.worldSeed);
    this.simulation = built.simulation;
    this.loop = built.loop;
    this.chunks = built.chunks;
    this.streamer = built.streamer;
    this.entityInterest = built.entityInterest;
    this.persistence =
      config.saveDir.length > 0 ? new FilePersistenceAdapter(config.saveDir) : null;
    this.activeWorldName = config.saveSlot;
    this.activeWorldLabel = undefined;
    this.saves = new WorldSaveCoordinator(this.persistence, () => ({
      simulation: this.simulation,
      name: this.activeWorldName,
      label: this.activeWorldLabel,
    }));
  }

  get currentSimulation(): Simulation {
    return this.simulation;
  }

  get clientCount(): number {
    return this.sessions.size;
  }

  /** Nom du monde actuellement servi — un seul à la fois, partagé par tous les observateurs. */
  get activeWorld(): string {
    return this.activeWorldName;
  }

  consumeSaveRecoveryNotice(): string | null {
    const notice = this.recoveryNotice;
    this.recoveryNotice = null;
    return notice;
  }

  /**
   * Charge la sauvegarde du monde si elle existe, avant tout démarrage.
   *
   * Remplace le monde fraîchement construit dans le constructeur (jetable) par un
   * monde restauré — à l'identique de `regenerate()`, mais sans session à réinitialiser
   * puisque personne n'est encore connecté. La seed effective devient celle de la
   * sauvegarde : un monde persistant garde sa géographie, quoi que dise
   * `CIV_WORLD_SEED` une fois qu'une sauvegarde existe.
   *
   * **Corruption** : si le slot n'a jamais été sauvegardé, `loadLatestValid()` renvoie
   * `null` et le monde neuf du constructeur reste en place — cas légitime. Mais si un
   * fichier existe et que ni lui ni ses backups ne sont lisibles, cette méthode REJETTE
   * plutôt que de continuer sur le monde neuf : démarrer silencieusement sur un monde
   * vierge sous le nom d'un slot existant, puis laisser l'autosave l'écraser, aurait
   * détruit pour de bon ce qui restait de récupérable. Un démarrage qui échoue
   * bruyamment force l'opérateur à regarder le dossier de sauvegardes avant de perdre
   * quoi que ce soit.
   */
  async initialize(): Promise<void> {
    if (this.persistence === null) return;
    const remembered = await this.persistence.loadActiveWorld();
    let initialSlot = remembered ?? this.config.saveSlot;
    let result = await this.persistence.loadLatestValid(initialSlot);
    if (result === null && remembered !== null && remembered !== this.config.saveSlot) {
      console.warn(
        `[server] le monde actif mémorisé "${remembered}" n'existe plus ; repli sur "${this.config.saveSlot}".`,
      );
      initialSlot = this.config.saveSlot;
      result = await this.persistence.loadLatestValid(initialSlot);
    }
    if (result === null) return;
    const { envelope, source } = result;

    if (source !== 'current') {
      this.recoveryNotice = `La sauvegarde principale de « ${envelope.metadata.label ?? initialSlot} » était endommagée. Le serveur a restauré ${source}.`;
      console.warn(
        `[server] sauvegarde "${initialSlot}" corrompue — restauration depuis ${source} ` +
          `(tick ${envelope.metadata.tick.toLocaleString('fr-FR')}, sauvegardée le ${envelope.metadata.savedAtIso}).`,
      );
    }

    this.simulation.dispose();
    const built = this.buildWorld(envelope.metadata.seed, {
      spawnInitialPopulation: false,
      worldId: envelope.snapshot.worldId,
    });
    built.simulation.restoreSnapshot(envelope.snapshot);
    this.simulation = built.simulation;
    this.loop = built.loop;
    this.chunks = built.chunks;
    this.streamer = built.streamer;
    this.entityInterest = built.entityInterest;
    this.activeWorldName = initialSlot;
    this.activeWorldLabel = envelope.metadata.label;
    this.lastAutosaveTick = this.simulation.clock.currentTick;

    console.log(
      `[server] sauvegarde "${initialSlot}" chargée — tick ${envelope.metadata.tick.toLocaleString('fr-FR')}, ` +
        `sauvegardée le ${envelope.metadata.savedAtIso}, ${envelope.metadata.humanCount} humains`,
    );
  }

  start(): void {
    this.started = true;
    this.loop.start();
    const intervalMs = Math.max(10, Math.round(1000 / this.config.netRateHz));
    this.netTimer = setInterval(() => this.broadcast(), intervalMs);

    if (this.persistence !== null && this.config.autosaveIntervalTicks > 0) {
      // Vérifié toutes les 5 s réelles : l'autosave n'a pas besoin d'une précision au
      // tick près, seulement de ne pas rater une fenêtre par un intervalle trop large.
      this.autosaveTimer = setInterval(() => void this.autosaveIfDue(), 5000);
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.netTimer !== null) {
      clearInterval(this.netTimer);
      this.netTimer = null;
    }
    if (this.autosaveTimer !== null) {
      clearInterval(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    this.loop.stop();
    for (const session of this.sessions) session.close();
    this.sessions.clear();

    if (this.persistence !== null && this.config.saveOnShutdown) {
      // Une écriture en vol (autosave démarré juste avant l'arrêt) doit se terminer
      // AVANT que le process ne sorte : sans cette attente, `saveNow` ci-dessous verrait
      // cette écriture comme « en vol » et l'ignorerait, et le process pourrait quitter
      // avant même que cette écriture — pourtant réellement lancée — ait fini d'écrire
      // sur disque.
      await this.saves.waitForIdle();
      await this.saves.save('arrêt du serveur');
    }

    this.chunks.clear();
    this.simulation.dispose();
  }

  /* ---- Persistance ----------------------------------------------------- */

  private async autosaveIfDue(): Promise<void> {
    const tick = this.simulation.clock.currentTick;
    if (tick - this.lastAutosaveTick < this.config.autosaveIntervalTicks) return;
    // Avancé seulement APRÈS succès (voir `saveNow`) : un autosave qui échoue (disque
    // plein, permission refusée…) ne doit pas faire croire qu'un tick a bien été
    // sauvegardé — le prochain contrôle (5 s plus tard) retentera aussitôt plutôt que
    // d'attendre un intervalle entier de plus.
    const saved = await this.saves.save('autosave');
    if (saved) this.lastAutosaveTick = tick;
  }

  /* ---- Gestion des mondes (multi-sauvegardes nommées) ------------------ */

  /**
   * Un seul monde est actif à la fois (voir `activeWorld`) : ces opérations ne font
   * jamais tourner plusieurs simulations en parallèle. `createWorld`/`activateWorld`
   * remplacent donc le monde servi pour TOUS les observateurs connectés au même moment —
   * même mécanisme que `regenerate()` (dispose → reconstruit → `sendInit` à toutes les
   * sessions), à la différence que ces méthodes-ci ne sont PAS gardées par
   * `config.allowRegenerate` : créer/changer de monde est une action normale du jeu,
   * pas un outil de développement.
   */

  async listWorlds(): Promise<SaveMetadata[]> {
    if (this.persistence === null) return [];
    return this.persistence.list();
  }

  /** Construit un monde neuf sous un nom de sauvegarde inédit et le rend actif. */
  async createWorld(options: {
    name: string;
    seed?: string;
    sizeChunks?: number;
    population?: number;
  }): Promise<SaveMetadata> {
    if (this.persistence === null) throw new PersistenceDisabledError();
    if ((await this.listWorlds()).some((world) => (world.label ?? world.name) === options.name)) {
      throw new Error(`Un monde nommé "${options.name}" existe déjà.`);
    }

    const slot = `world-${randomUUID()}`;
    const seed = options.seed ?? `world-${randomUUID().slice(0, 8)}`;
    const built = this.buildWorld(seed, {
      worldSizeChunks: options.sizeChunks,
      population: options.population,
      spawnInitialPopulation: true,
      worldId: randomUUID(),
    });
    try {
      const envelope = createSaveEnvelope(
        built.simulation,
        slot,
        new Date().toISOString(),
        options.name,
      );
      await this.saveCurrentBeforeSwitch();
      await this.persistence.save(slot, envelope);
      await this.persistence.saveActiveWorld(slot);
      this.swapWorld(built, slot, options.name);

      console.log(
        `[server] nouveau monde "${options.name}" créé dans le slot "${slot}" (seed "${seed}")`,
      );
      return envelope.metadata;
    } catch (error) {
      built.chunks.clear();
      built.simulation.dispose();
      throw error;
    }
  }

  /** Charge un monde déjà sauvegardé et le rend actif — remplace le monde en cours. */
  async activateWorld(name: string): Promise<SaveMetadata> {
    if (this.persistence === null) throw new PersistenceDisabledError();
    const result = await this.persistence.loadLatestValid(name);
    if (result === null) throw new WorldNotFoundError(name);
    const { envelope, source } = result;

    if (source !== 'current') {
      this.recoveryNotice = `La sauvegarde principale de « ${envelope.metadata.label ?? name} » était endommagée. Le serveur a restauré ${source}.`;
      console.warn(
        `[server] monde "${name}" corrompu — activation depuis ${source} ` +
          `(tick ${envelope.metadata.tick.toLocaleString('fr-FR')}).`,
      );
    }

    const built = this.buildWorld(envelope.metadata.seed, {
      spawnInitialPopulation: false,
      worldId: envelope.snapshot.worldId,
    });
    try {
      built.simulation.restoreSnapshot(envelope.snapshot);
      await this.saveCurrentBeforeSwitch();
      await this.persistence.saveActiveWorld(name);
      this.swapWorld(built, name, envelope.metadata.label);
    } catch (error) {
      built.chunks.clear();
      built.simulation.dispose();
      throw error;
    }

    console.log(
      `[server] monde actif changé pour "${name}" — tick ${envelope.metadata.tick.toLocaleString('fr-FR')}`,
    );
    return envelope.metadata;
  }

  async renameWorld(name: string, newName: string): Promise<SaveMetadata> {
    if (this.persistence === null) throw new PersistenceDisabledError();
    if (
      (await this.listWorlds()).some(
        (world) => world.name !== name && (world.label ?? world.name) === newName,
      )
    ) {
      throw new Error(`Un monde nommé "${newName}" existe déjà.`);
    }
    const metadata = await this.persistence.setLabel(name, newName);
    if (name === this.activeWorldName) this.activeWorldLabel = metadata.label;
    return metadata;
  }

  async duplicateWorld(name: string, newName: string): Promise<SaveMetadata> {
    if (this.persistence === null) throw new PersistenceDisabledError();
    if ((await this.listWorlds()).some((world) => (world.label ?? world.name) === newName)) {
      throw new Error(`Un monde nommé "${newName}" existe déjà.`);
    }
    const slot = `world-${randomUUID()}`;
    await this.persistence.duplicate(name, slot);
    return this.persistence.setLabel(slot, newName);
  }

  async deleteWorld(name: string): Promise<void> {
    if (this.persistence === null) throw new PersistenceDisabledError();
    if (name === this.activeWorldName) throw new ActiveWorldConflictError(name, 'supprimer');
    await this.persistence.delete(name);
  }

  /**
   * Miniature d'aperçu — jamais nécessaire à la simulation. Le client capture son
   * propre canvas et envoie l'image déjà encodée ; ce serveur ne fait que la stocker.
   */
  async saveWorldThumbnail(name: string, jpegBase64: string): Promise<void> {
    if (this.persistence === null) throw new PersistenceDisabledError();
    await this.persistence.saveThumbnail(name, jpegBase64);
  }

  /** `null` si ce monde n'a encore aucune miniature. */
  async loadWorldThumbnail(name: string): Promise<Buffer | null> {
    if (this.persistence === null) return null;
    return this.persistence.loadThumbnail(name);
  }

  /** Vue synthétique du monde, exposée par l'API HTTP et par `/worldinfo`. */
  describe(): Record<string, unknown> {
    const hydrology = this.simulation.world.hydrology.stats;
    return {
      world: this.simulation.world.toDescriptor(),
      generationVersion: this.simulation.world.generationVersion,
      clock: this.simulation.clock.toSnapshot(),
      environment: this.simulation.world.environmentSnapshot(),
      region: this.simulation.world.regions.stats({ x: 0, z: 0 }, this.simulation.entities),
      ecology: this.simulation.world.ecology.sample({ x: 0, z: 0 }, this.simulation.entities),
      population: this.simulation.humanCount,
      chunks: this.chunks.stats(),
      water: hydrology,
      waterBodies: this.simulation.world.hydrology.bodies.length,
      modifications: this.simulation.world.delta.depletedOrRemovedCount,
      clients: this.sessions.size,
      stats: this.simulation.stats(),
    };
  }

  /* ---- Cycle de vie d'un client -------------------------------------- */

  addClient(socket: WebSocket): ClientSession {
    const session = new ClientSession(socket);
    this.sessions.add(session);
    this.sendInit(session);

    socket.on('message', (raw: unknown) => this.handleMessage(session, String(raw)));
    socket.on('close', () => this.removeClient(session));
    socket.on('error', (error: Error) => {
      console.error(`[ws] session ${session.id} error:`, error.message);
      this.removeClient(session);
    });

    console.log(`[ws] client ${session.id} connected (${this.sessions.size} total)`);
    return session;
  }

  removeClient(session: ClientSession): void {
    if (!this.sessions.delete(session)) return;
    session.close();
    console.log(`[ws] client ${session.id} disconnected (${this.sessions.size} total)`);
  }

  private sendInit(session: ClientSession): void {
    // Le client n'a pas encore annoncé où se trouve sa caméra. Envoyer ici toute la
    // population rendrait le premier paquet proportionnel au monde entier ; le premier
    // `chunkInterest`, émis dès que la scène est prête, introduira les humains visibles.
    session.send({
      t: 'init',
      protocolVersion: PROTOCOL_VERSION,
      world: this.simulation.world.toDescriptor(),
      generation: buildWorldGenerationMetadata(this.simulation.world.generator),
      clock: this.simulation.clock.toSnapshot(),
      environment: this.simulation.world.environmentSnapshot(),
      sequenceNumber: session.currentStateSequence,
      history: this.simulation.history
        .values()
        .map((event) =>
          toNetworkEvent(event, this.simulation.clock.dateAtTick(event.payload.tick)),
        ),
      profiles: [],
      humans: [],
    });
    session.rememberFullState([], []);
    session.forgetAllChunks();
  }

  private handleMessage(session: ClientSession, raw: string): void {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      session.send({ t: 'error', code: 'bad_message', message: parsed.error });
      return;
    }

    const message = parsed.value;
    switch (message.t) {
      case 'hello':
        if (message.protocolVersion !== PROTOCOL_VERSION) {
          session.send({
            t: 'error',
            code: 'protocol_mismatch',
            message: `Server speaks protocol ${PROTOCOL_VERSION}, client speaks ${message.protocolVersion}`,
          });
        }
        return;
      case 'ping':
        session.send({ t: 'pong', clientTime: message.clientTime });
        return;
      case 'control':
        this.applyControl(message.action, message.timeScale);
        return;
      case 'chunkInterest':
        session.interestCenter = { x: message.center.x, z: message.center.z };
        session.interestRadius = message.radius;
        return;
      case 'regenerate':
        this.regenerate(session, message.seed);
        return;
      case 'resync':
        session.requestResync();
        return;
      default: {
        const exhaustive: never = message;
        throw new Error(`Unhandled client message: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  private applyControl(action: 'pause' | 'resume' | 'setTimeScale', timeScale?: number): void {
    switch (action) {
      case 'pause':
        this.simulation.pause();
        return;
      case 'resume':
        this.simulation.resume();
        return;
      case 'setTimeScale':
        if (timeScale !== undefined) this.simulation.clock.setTimeScale(timeScale);
        return;
      default: {
        const exhaustive: never = action;
        throw new Error(`Unhandled control action: ${String(exhaustive)}`);
      }
    }
  }

  /**
   * Remplace le monde par un monde neuf.
   *
   * Volontairement verrouillé par la configuration : détruire un monde qui tourne depuis
   * des semaines ne doit pas tenir à un clic dans un panneau de debug.
   */
  private regenerate(session: ClientSession, seed?: string): void {
    if (!this.config.allowRegenerate) {
      session.send({
        t: 'error',
        code: 'forbidden',
        message: 'World regeneration is disabled on this server (CIV_ALLOW_REGENERATE)',
      });
      return;
    }

    const nextSeed = seed ?? `world-${this.simulation.clock.currentTick}-${this.sessions.size}`;
    console.log(`[server] régénération du monde avec la seed "${nextSeed}"`);

    this.loop.stop();
    this.chunks.clear();
    this.simulation.dispose();

    const built = this.buildWorld(nextSeed);
    this.simulation = built.simulation;
    this.loop = built.loop;
    this.chunks = built.chunks;
    this.streamer = built.streamer;
    this.entityInterest = built.entityInterest;
    this.lastFullSnapshotTick = 0;
    this.lastStatsTick = 0;
    this.loop.start();

    for (const client of this.sessions) {
      try {
        this.sendInit(client);
      } catch (error) {
        console.error(
          `[ws] impossible de resynchroniser la session ${client.id} après la bascule:`,
          error,
        );
        this.removeClient(client);
      }
    }
  }

  private buildWorld(
    seed: string,
    options: {
      spawnInitialPopulation?: boolean;
      worldSizeChunks?: number;
      population?: number;
      worldId?: string;
    } = {},
  ): {
    simulation: Simulation;
    loop: SimulationLoop;
    chunks: ChunkManager;
    streamer: ChunkStreamer;
    entityInterest: EntityInterestManager;
  } {
    const simulation = new Simulation({
      seed,
      worldId: options.worldId ?? randomUUID(),
      population: options.population ?? this.config.population,
      config: {
        time: { tickRateHz: this.config.tickRateHz },
        network: { netRateHz: this.config.netRateHz },
      },
      generation: {
        layout: { sizeChunks: options.worldSizeChunks ?? this.config.worldSizeChunks },
      },
      spawnInitialPopulation: options.spawnInitialPopulation ?? true,
    });

    const loop = new SimulationLoop(simulation, {
      onError: (error) => console.error('[simulation] tick failed:', error),
    });
    const chunks = new ChunkManager(simulation, {
      budgetMsPerPass: this.config.chunkBudgetMs,
    });
    const streamer = new ChunkStreamer(chunks, simulation.world.bounds);
    const entityInterest = new EntityInterestManager(
      simulation.world.generator.config.layout.chunkSizeMeters,
    );

    console.log(
      `[server] monde "${simulation.world.worldId}" — ${simulation.world.sizeMeters} m, ` +
        `${simulation.world.hydrology.bodies.length} points d'eau, ` +
        `${simulation.humanCount} humains`,
    );
    return { simulation, loop, chunks, streamer, entityInterest };
  }

  /** Engage une instance déjà construite et validée ; l'ancien monde reste intact avant ce point. */
  private swapWorld(
    built: {
      simulation: Simulation;
      loop: SimulationLoop;
      chunks: ChunkManager;
      streamer: ChunkStreamer;
      entityInterest: EntityInterestManager;
    },
    name: string,
    label?: string,
  ): void {
    this.loop.stop();
    this.chunks.clear();
    this.simulation.dispose();
    this.simulation = built.simulation;
    this.loop = built.loop;
    this.chunks = built.chunks;
    this.streamer = built.streamer;
    this.entityInterest = built.entityInterest;
    this.activeWorldName = name;
    this.activeWorldLabel = label;
    this.lastFullSnapshotTick = 0;
    this.lastStatsTick = 0;
    this.lastAutosaveTick = this.simulation.clock.currentTick;
    if (this.started) this.loop.start();
    for (const client of this.sessions) {
      try {
        this.sendInit(client);
      } catch (error) {
        console.error(
          `[ws] impossible de resynchroniser la session ${client.id} après la bascule:`,
          error,
        );
        this.removeClient(client);
      }
    }
  }

  /** Sauvegarde sans masquer l'erreur : une bascule ne doit jamais perdre la progression quittée. */
  private async saveCurrentBeforeSwitch(): Promise<void> {
    await this.saves.saveStrict();
  }

  /* ---- Diffusion ------------------------------------------------------ */

  private broadcast(): void {
    // Les événements sont vidés à chaque tour, même sans client : laisser le tampon se
    // remplir ferait recevoir au premier connecté un historique arbitrairement ancien.
    const drained = this.simulation.recorder.drain();
    const removals = this.simulation.world.journal.consumeRemovals();
    const trailChanges = this.simulation.world.journal.consumeTrailChanges();
    const resourceUpdates = this.simulation.world.journal.consumeResourceUpdates();
    const resourceAdditions = this.simulation.world.journal.consumeResourceAdditions();
    if (this.sessions.size === 0) return;

    this.streamer.run(this.sessions);

    const clock = this.simulation.clock.toSnapshot();
    const profiles = buildHumanProfiles(this.simulation);
    const humans = buildHumanStates(this.simulation);
    this.entityInterest.rebuild(profiles, humans);

    const fullSnapshotDue =
      clock.tick - this.lastFullSnapshotTick >=
      this.simulation.config.network.fullSnapshotEveryTicks;
    if (fullSnapshotDue) this.lastFullSnapshotTick = clock.tick;

    // Le cycle de vie des chunks reste sur le bus — historique, métriques, debug serveur —
    // mais ne part pas sur le réseau : c'est un détail d'hébergement, et le diffuser
    // représenterait des centaines de messages sans usage côté observateur.
    const events: NetworkEvent[] = drained
      .filter((event) => !event.name.startsWith('Chunk'))
      .map((event) => toNetworkEvent(event, this.simulation.clock.dateAtTick(event.payload.tick)));

    for (const session of this.sessions) {
      if (!session.isOpen) {
        this.removeClient(session);
        continue;
      }

      // `consumeNeedsFullSnapshot()` DOIT être appelé même quand `fullSnapshotDue` est déjà
      // vrai : sinon une demande de resync arrivée pendant un tour de snapshot périodique
      // resterait « armée » et déclencherait un snapshot supplémentaire, non désiré, au
      // tour suivant.
      const sessionNeedsFullSnapshot = session.consumeNeedsFullSnapshot();
      const visible = this.entityInterest.select(session.interestCenter, session.interestRadius);
      const environment = this.environmentFor(session);
      if (fullSnapshotDue || sessionNeedsFullSnapshot) {
        // Séquence PAR SESSION, avancée seulement parce qu'un état part réellement
        // vers ce client précis — voir la doc de `nextStateSequence()`. Un `snapshot`
        // demandé par resync suit exactement le même chemin qu'un snapshot périodique :
        // CE client reçoit un état complet même si les autres reçoivent un delta ce
        // tour-ci — le désync d'un client n'attend jamais le prochain snapshot global.
        session.send({
          t: 'snapshot',
          sequenceNumber: session.nextStateSequence(),
          clock,
          environment,
          profiles: visible.profiles,
          humans: visible.humans,
        });
        session.rememberFullState(visible.profiles, visible.humans);
      } else {
        const delta = session.computeDelta(visible.profiles, visible.humans);
        if (delta.humans.length > 0 || delta.profiles.length > 0 || delta.removed.length > 0) {
          session.send({
            t: 'delta',
            sequenceNumber: session.nextStateSequence(),
            clock,
            environment,
            ...delta,
          });
        }
        // Sinon : rien à envoyer à CE client ce tour-ci, sa séquence n'avance pas —
        // c'est exactement le comportement qui évite les faux désync.
      }

      const visibleEvents = eventsForInterest(events, visible.entityIds);
      if (visibleEvents.length > 0) session.send({ t: 'events', events: visibleEvents });
    }

    // Une ressource consommée disparaît immédiatement chez les observateurs qui
    // possèdent DÉJÀ ce chunk — jamais chez ceux qui regardent ailleurs dans le monde
    // (voir `sendToSessionsHoldingChunk`). Le delta n'embarque que l'adresse compacte
    // `(chunkKey, localId)` — aucun besoin de retransmettre l'identifiant complet, le
    // client tient déjà la table de correspondance depuis le payload initial du chunk.
    for (const removal of removals) {
      const message: ServerMessage = {
        t: 'resource:removed',
        chunkKey: removal.ownerChunkKey,
        localId: removal.localId,
        sequenceNumber: this.sequenceNumber,
      };
      sendToSessionsHoldingChunk(this.sessions, removal.ownerChunkKey, message);
    }

    // Récolte partielle d'une ressource à plusieurs portions (voir `World.harvestResource`) :
    // même adressage compact et même filtrage par chunk détenu que `resource:removed`.
    for (const update of resourceUpdates) {
      const message: ServerMessage = {
        t: 'resource:updated',
        chunkKey: update.ownerChunkKey,
        localId: update.localId,
        sequenceNumber: this.sequenceNumber,
        changedFields: update.changedFields,
        state: 'modified',
      };
      sendToSessionsHoldingChunk(this.sessions, update.ownerChunkKey, message);
    }

    for (const addition of resourceAdditions) {
      const message: ServerMessage = {
        t: 'resource:added',
        chunkKey: addition.ownerChunkKey,
        localId: addition.localId,
        sequenceNumber: this.sequenceNumber,
        fields: addition.changedFields,
      };
      sendToSessionsHoldingChunk(this.sessions, addition.ownerChunkKey, message);
    }

    const trailsByChunk = new Map<
      string,
      { resolution: number; cells: Array<{ index: number; wear: number }> }
    >();
    for (const change of trailChanges) {
      const group = trailsByChunk.get(change.chunkKey) ?? {
        resolution: change.resolution,
        cells: [],
      };
      group.cells.push({ index: change.cellIndex, wear: Math.round(change.wear01 * 255) });
      trailsByChunk.set(change.chunkKey, group);
    }
    for (const [chunkKey, update] of trailsByChunk) {
      const message: ServerMessage = { t: 'trail:updated', chunkKey, ...update };
      sendToSessionsHoldingChunk(this.sessions, chunkKey, message);
    }

    if (clock.tick - this.lastStatsTick >= this.config.tickRateHz) {
      this.lastStatsTick = clock.tick;
      const stats = this.simulation.stats();
      const chunkStats = this.chunks.stats();
      for (const session of this.sessions) {
        session.send({ t: 'stats', stats, clientCount: this.sessions.size, chunks: chunkStats });
      }
    }

    this.sequenceNumber++;
  }

  /** La météo envoyée correspond à la région réellement observée par ce client. */
  private environmentFor(session: ClientSession) {
    const center = session.interestCenter;
    if (center === null) return this.simulation.world.environmentSnapshot();
    const chunkSize = this.simulation.world.generator.config.layout.chunkSizeMeters;
    return this.simulation.world.environmentAt(
      (center.x + 0.5) * chunkSize,
      (center.z + 0.5) * chunkSize,
    );
  }
}
