import type { ChunkPayload } from '@civ/shared';
import { chunkKey, toChunkPayload, type ChunkCoordinate, type ChunkData } from '@civ/procedural';
import type { Simulation } from '@civ/simulation';

/**
 * Cycle de vie d'un chunk côté serveur.
 *
 * `Generating` est un état bref aujourd'hui — la génération est synchrone — mais il est
 * représenté explicitement : c'est lui qui accueillera une génération en worker sans que
 * le reste du serveur change.
 */
export type ChunkState = 'Unloaded' | 'Generating' | 'Loaded' | 'Active';

export interface ChunkEntry {
  readonly key: string;
  readonly coordinate: ChunkCoordinate;
  state: ChunkState;
  data: ChunkData | null;
  payload: ChunkPayload | null;
  lastTouchedTick: number;
  /**
   * Révision DES RESSOURCES DE CE CHUNK (`WorldDelta.resourceRevision`) au moment où
   * `payload` a été construit. Sert de clé de fraîcheur : si
   * `delta.resourceRevision(key) === payloadResourceRevision`, le payload est encore
   * valide — sans avoir à balayer quoi que ce soit, la révision est déjà par chunk.
   */
  payloadResourceRevision: number;
  payloadTrailRevision: number;
  /** Tick auquel ce chunk a quitté la zone active — pour l'hystérésis avant démotion. */
  leftActiveAtTick: number | null;
}

export interface ChunkManagerOptions {
  /** Nombre maximum de chunks conservés en mémoire. */
  maxCached?: number;
  /** Temps maximum consacré à la génération à chaque passe, en millisecondes. */
  budgetMsPerPass?: number;
  /**
   * Nombre de ticks pendant lesquels un chunk sortant de la zone active reste malgré
   * tout marqué `Active` — hystérésis évitant le battement quand un observateur
   * traverse une frontière de chunk.
   */
  activeGraceTicks?: number;
}

export interface ChunkManagerStats {
  cached: number;
  active: number;
  queued: number;
  generatedTotal: number;
  averageGenerationMs: number;
  lastGenerationMs: number;
}

/**
 * Génère, met en cache et libère les chunks.
 *
 * Deux règles gouvernent ce composant :
 *
 * 1. **Ne jamais régénérer ce que l'on possède déjà.** Un chunk coûte quelques
 *    millisecondes ; le recalculer à chaque message réseau saturerait le serveur.
 * 2. **Ne jamais bloquer la boucle de simulation.** La génération est bornée par un budget
 *    de temps par passe. Un client qui découvre une grande région reçoit ses chunks en
 *    plusieurs passes plutôt qu'en gelant le monde pour tout le monde.
 *
 * Trois bugs historiques corrigés :
 *
 * - **Transition Active manquée après génération retardée.** Un chunk demandé par le
 *   client mais pas encore généré lors du premier `setActive` restait `Loaded` après
 *   génération, car `setActive` supposait qu'un `activeKeys.has(key)` valait « déjà
 *   Active ». Maintenant, chaque nouvelle génération vérifie l'ensemble actif et se
 *   promeut immédiatement si son chunk est désiré.
 * - **Réencodage de payload à chaque appel après une seule cueillette.** L'ancien code
 *   balayait toutes les ressources d'un chunk pour vérifier si une était `depleted`,
 *   et le faisait à chaque `payloadFor`. Maintenant, on stocke la révision du chunk au
 *   moment de l'encodage : tant qu'elle n'a pas changé, le payload est réutilisé sans
 *   balayage. Bug corrigé une seconde fois dans le même esprit : cette révision était
 *   d'abord un compteur GLOBAL (toute mutation de ressource, n'importe où dans le
 *   monde, la faisait avancer), ce qui obligeait quand même à balayer chaque chunk
 *   actif dès qu'un seul avait changé, pour savoir si CE chunk-là était concerné.
 *   `WorldDelta.resourceRevision` est maintenant tenue PAR CHUNK (symétrique à
 *   `trailRevision`) : la révision EST la réponse, plus un simple indice à vérifier.
 * - **Absence d'hystérésis.** Sortir puis rentrer dans un chunk provoquait des
 *   Loaded → Active → Loaded à chaque tick de mouvement à la frontière. On garde
 *   maintenant l'état `Active` pendant `activeGraceTicks` avant de démotter.
 */
export class ChunkManager {
  private readonly entries = new Map<string, ChunkEntry>();
  private readonly queue: ChunkCoordinate[] = [];
  private readonly queued = new Set<string>();
  private readonly activeKeys = new Set<string>();

  private readonly maxCached: number;
  private readonly budgetMsPerPass: number;
  private readonly activeGraceTicks: number;

  private generatedTotal = 0;
  private generationMsTotal = 0;
  private lastGenerationMs = 0;

  constructor(
    private readonly simulation: Simulation,
    options: ChunkManagerOptions = {},
  ) {
    this.maxCached = options.maxCached ?? 640;
    this.budgetMsPerPass = options.budgetMsPerPass ?? 8;
    this.activeGraceTicks = Math.max(0, options.activeGraceTicks ?? 0);
  }

  /** Demande un chunk ; ne fait rien s'il est déjà chargé ou en file. */
  request(coordinate: ChunkCoordinate): void {
    if (!this.simulation.world.bounds.containsChunk(coordinate)) return;
    const key = chunkKey(coordinate);
    if (this.entries.has(key) || this.queued.has(key)) return;
    this.queued.add(key);
    this.queue.push(coordinate);
  }

  /**
   * Génère ce qui est en attente, dans la limite du budget.
   * Retourne les clés effectivement produites pendant cette passe.
   */
  pump(): string[] {
    this.expireGracePeriods();
    if (this.queue.length === 0) return [];
    const deadline = performance.now() + this.budgetMsPerPass;
    const produced: string[] = [];
    const tick = this.simulation.clock.currentTick;

    while (this.queue.length > 0 && performance.now() < deadline) {
      const coordinate = this.queue.shift() as ChunkCoordinate;
      const key = chunkKey(coordinate);
      this.queued.delete(key);
      if (this.entries.has(key)) continue;

      const entry: ChunkEntry = {
        key,
        coordinate,
        state: 'Generating',
        data: null,
        payload: null,
        lastTouchedTick: tick,
        payloadResourceRevision: -1,
        payloadTrailRevision: -1,
        leftActiveAtTick: null,
      };
      this.entries.set(key, entry);

      // `generateChunk` applique déjà `WorldDelta.apply` (filtre depleted/removed) —
      // `data` est donc la vue « vécue » du chunk, pas la génération procédurale brute.
      const data = this.simulation.world.generateChunk(coordinate);
      entry.data = data;
      entry.payload = this.withResourceStates(
        this.withTrails(toChunkPayload(data, this.simulation.world.chunkSizeMeters), key),
        data,
      );
      entry.payloadResourceRevision = this.simulation.world.delta.resourceRevision(key);
      entry.payloadTrailRevision = this.simulation.world.delta.trailRevision(key);

      // Le chunk peut avoir été déclaré Active pendant qu'il était en file : la promotion
      // n'a pas eu lieu (`activeKeys.has(key)` était vrai mais aucune entrée n'existait).
      // On la fait maintenant, avant même que l'état `Loaded` soit observé — le chunk n'a
      // jamais rendu de service en `Loaded`, il est directement `Active`.
      if (this.activeKeys.has(key)) {
        entry.state = 'Active';
        this.simulation.events.emit('ChunkLoaded', { tick, key });
      } else {
        entry.state = 'Loaded';
      }

      this.generatedTotal++;
      this.generationMsTotal += data.generationMs;
      this.lastGenerationMs = data.generationMs;
      produced.push(key);

      this.simulation.events.emit('ChunkGenerated', {
        tick,
        key,
        generationMs: Math.round(data.generationMs * 100) / 100,
        resourceCount: data.resources.length,
      });
    }

    this.evictStaleChunks();
    return produced;
  }

  payloadFor(key: string): ChunkPayload | null {
    const entry = this.entries.get(key);
    if (!entry || entry.state === 'Generating') return null;
    entry.lastTouchedTick = this.simulation.clock.currentTick;
    return this.payloadUpToDate(entry);
  }

  /**
   * Payload serviable, débarrassé des ressources consommées depuis la génération.
   *
   * Utilise la révision DE CE CHUNK (ressources + sentiers, chacune tenue séparément
   * par `WorldDelta`) comme clé de fraîcheur : tant qu'aucune des deux n'a bougé, on
   * renvoie le payload tel quel. Aucun balayage nulle part — ni ici, ni ailleurs dans
   * le monde : une révision par chunk qui n'a pas changé EST la preuve que ce chunk
   * n'est pas concerné, elle n'a plus besoin d'être revérifiée par un balayage.
   */
  private payloadUpToDate(entry: ChunkEntry): ChunkPayload | null {
    const delta = this.simulation.world.delta;
    const resourceRevision = delta.resourceRevision(entry.key);
    const trailRevision = delta.trailRevision(entry.key);
    if (
      resourceRevision === entry.payloadResourceRevision &&
      trailRevision === entry.payloadTrailRevision
    ) {
      return entry.payload;
    }
    if (entry.data === null) return entry.payload;

    const applied = delta.apply(entry.data);
    entry.payload = this.withResourceStates(
      this.withTrails(toChunkPayload(applied, this.simulation.world.chunkSizeMeters), entry.key),
      applied,
    );
    entry.payloadResourceRevision = resourceRevision;
    entry.payloadTrailRevision = trailRevision;
    return entry.payload;
  }

  /**
   * N'attache `trails` que s'il y a réellement quelque chose à montrer. `trailSparseCells`
   * court-circuite avant toute itération pour un chunk jamais foulé — le cas de
   * l'immense majorité des chunks — donc omettre le champ ici ne coûte rien de plus
   * que ce court-circuit, et évite d'envoyer un octet par cellule pour rien.
   */
  private withTrails(payload: ChunkPayload, key: string): ChunkPayload {
    const cellMeters = this.simulation.config.movement.trailCellMeters;
    const resolution = Math.round(this.simulation.world.chunkSizeMeters / cellMeters);
    const cells = this.simulation.world.delta.trailSparseCells(key, resolution);
    if (cells.length === 0) return payload;
    return { ...payload, trails: { resolution, cells } };
  }

  /**
   * Réinjecte l'état `modified` des ressources survivantes (récolte partielle, voir
   * `World.harvestResource`) dans le payload d'un chunk (re)chargé.
   *
   * Bug corrigé : `WorldDelta.apply()` filtre déjà les ressources `depleted`/`removed`
   * d'un chunk fraîchement généré, mais ne réappliquait jamais les `changedFields` d'une
   * ressource `modified` — un buisson partiellement récolté redevenait visuellement neuf
   * après une éviction de chunk ou une reconnexion, alors même que `WorldDelta` se
   * souvenait correctement qu'il restait moins de portions. `chunk` doit être la vue déjà
   * passée par `WorldDelta.apply` (les deux appelants le garantissent) : ses `resources`
   * sont donc déjà les survivants, et chacun porte son propre `localId`.
   */
  private withResourceStates(payload: ChunkPayload, chunk: ChunkData): ChunkPayload {
    const delta = this.simulation.world.delta;
    const states: NonNullable<ChunkPayload['resourceStates']> = [];
    for (const spawn of chunk.resources) {
      const entry = delta.get(spawn.id);
      if (entry && entry.state === 'modified' && Object.keys(entry.changedFields).length > 0) {
        states.push({ localId: spawn.localId, changedFields: entry.changedFields });
      }
    }
    if (states.length === 0) return payload;
    return { ...payload, resourceStates: states };
  }

  stateOf(key: string): ChunkState {
    return this.entries.get(key)?.state ?? 'Unloaded';
  }

  /**
   * Déclare l'ensemble des chunks utiles maintenant.
   *
   * - Un chunk entrant devient `Active` (émission `ChunkLoaded`) — même s'il était déjà
   *   dans `activeKeys` mais dans un état différent (cas d'une génération arrivée en
   *   retard sur la déclaration d'intérêt).
   * - Un chunk sortant reste `Active` pendant `activeGraceTicks` (hystérésis). Il ne
   *   quitte l'ensemble `activeKeys` du gestionnaire qu'après l'expiration de la grâce,
   *   déclenchée dans `pump()` ou dans le prochain `setActive`.
   */
  setActive(keys: Iterable<string>): void {
    const next = new Set(keys);
    const tick = this.simulation.clock.currentTick;

    // Sortants : on note l'instant de sortie ; la démotion effective est repoussée à
    // l'expiration de la grâce (voir `expireGracePeriods`).
    for (const key of this.activeKeys) {
      if (next.has(key)) continue;
      const entry = this.entries.get(key);
      if (entry) entry.leftActiveAtTick = tick;
    }

    // Entrants : promotion à Active systématique — le simple fait qu'un chunk soit
    // déjà dans `activeKeys` ne garantit pas que son entrée porte l'état correct
    // (cas de la génération retardée corrigé ici).
    for (const key of next) {
      const wasActive = this.activeKeys.has(key);
      const entry = this.entries.get(key);
      if (entry) {
        // Le chunk revient dans la zone active pendant sa grâce : on annule la démotion.
        entry.leftActiveAtTick = null;
        if (entry.state !== 'Active') {
          entry.state = 'Active';
          entry.lastTouchedTick = tick;
          this.simulation.events.emit('ChunkLoaded', { tick, key });
        } else if (!wasActive) {
          // État déjà Active mais on n'était pas dans activeKeys (cas frontalier :
          // grâce en cours, chunk déjà promu mais notre `activeKeys` s'était vidé).
          entry.lastTouchedTick = tick;
        }
      }
      // Si `!entry`, la promotion se fera dans `pump()` à la fin de la génération.
    }

    this.activeKeys.clear();
    for (const key of next) this.activeKeys.add(key);

    this.expireGracePeriods();
  }

  /**
   * Démote effectivement les chunks dont la période de grâce est expirée : passage
   * `Active → Loaded` et émission `ChunkUnloaded`.
   */
  private expireGracePeriods(): void {
    const tick = this.simulation.clock.currentTick;
    for (const entry of this.entries.values()) {
      if (entry.leftActiveAtTick === null) continue;
      if (this.activeKeys.has(entry.key)) {
        // Sécurité : si le chunk est de nouveau actif, on annule.
        entry.leftActiveAtTick = null;
        continue;
      }
      if (tick - entry.leftActiveAtTick < this.activeGraceTicks) continue;
      if (entry.state === 'Active') entry.state = 'Loaded';
      entry.leftActiveAtTick = null;
      this.simulation.events.emit('ChunkUnloaded', { tick, key: entry.key });
    }
  }

  stats(): ChunkManagerStats {
    return {
      cached: this.entries.size,
      active: this.activeKeys.size,
      queued: this.queue.length,
      generatedTotal: this.generatedTotal,
      averageGenerationMs:
        this.generatedTotal === 0
          ? 0
          : Math.round((this.generationMsTotal / this.generatedTotal) * 100) / 100,
      lastGenerationMs: Math.round(this.lastGenerationMs * 100) / 100,
    };
  }

  clear(): void {
    this.entries.clear();
    this.queue.length = 0;
    this.queued.clear();
    this.activeKeys.clear();
  }

  /** Libère les chunks les moins récemment utilisés, jamais les chunks actifs. */
  private evictStaleChunks(): void {
    if (this.entries.size <= this.maxCached) return;

    const candidates = [...this.entries.values()]
      .filter((entry) => entry.state !== 'Active' && entry.state !== 'Generating')
      .sort((a, b) => a.lastTouchedTick - b.lastTouchedTick);

    let excess = this.entries.size - this.maxCached;
    for (const entry of candidates) {
      if (excess <= 0) break;
      this.entries.delete(entry.key);
      excess--;
    }
  }
}
