import type { WorldGenerationOverrides } from '@civ/procedural';
import type { EntityId, SimulationStats, WorldId } from '@civ/shared';
import { Human, Movement } from './components/index.js';
import {
  createSimulationConfig,
  type SimulationConfig,
  type SimulationConfigOverrides,
} from './config/simulationConfig.js';
import { SimulationClock } from './core/clock.js';
import { EntityManager } from './core/entityManager.js';
import { EventBus } from './core/eventBus.js';
import { EventRecorder } from './core/eventRecorder.js';
import { WorldHistory } from './core/worldHistory.js';
import { SimulationMetrics } from './core/metrics.js';
import { WorldRng } from './core/rng.js';
import { SimulationScheduler } from './core/scheduler.js';
import type { SimulationSystem, SystemUpdateContext } from './core/system.js';
import { HumanFactory } from './humans/humanFactory.js';
import { computeConfigFingerprint } from './persistence/configFingerprint.js';
import {
  SIMULATION_SNAPSHOT_VERSION,
  captureEntities,
  migrateSnapshotV9ToV10,
  migrateSnapshotV10ToV11,
  migrateSnapshotV11ToV12,
  migrateSnapshotV12ToV13,
  migrateSnapshotV13ToV14,
  restoreEntities,
  type SimulationSnapshot,
} from './persistence/simulationSnapshot.js';
import { ForgettingSystem } from './systems/cognition/forgettingSystem.js';
import { LearningSystem } from './systems/cognition/learningSystem.js';
import { MovementSystem } from './systems/movementSystem.js';
import { MetabolismSystem } from './systems/needs/metabolismSystem.js';
import { NeedSatisfactionSystem } from './systems/needs/needSatisfactionSystem.js';
import { PathfindingSystem } from './systems/pathfinding/pathfindingSystem.js';
import { PerceptionSystem } from './systems/perception/perceptionSystem.js';
import { ResourceInteractionSystem } from './systems/resourceInteractionSystem.js';
import { EcologySystem } from './systems/ecologySystem.js';
import { TemporaryWanderSystem } from './systems/temporary/temporaryWanderSystem.js';
import { World } from './world/world.js';

export interface SimulationOptions {
  seed: string;
  worldId?: WorldId;
  config?: SimulationConfigOverrides;
  /** Surcharges de génération du monde (taille, relief, hydrologie, ressources). */
  generation?: WorldGenerationOverrides;
  /** Raccourci pratique : équivaut à `config.humans.initialPopulation`. */
  population?: number;
  /** Permet aux tests de démarrer un monde vide. */
  spawnInitialPopulation?: boolean;
  /** Remplace les systèmes par défaut — utilisé pour tester un système isolément. */
  systems?: SimulationSystem[];
}

/**
 * Racine du moteur.
 *
 * Elle assemble les briques et fait avancer le temps ; elle ne contient aucune règle de
 * jeu. Elle ne possède pas non plus de minuterie : c'est `SimulationLoop` (ou un test, ou
 * le CLI) qui décide quand appeler `tick()`. Ce découplage est ce qui rend la simulation
 * exécutable aussi bien à 20 Hz temps réel qu'à pleine vitesse dans un terminal.
 */
export class Simulation {
  readonly config: SimulationConfig;
  readonly clock: SimulationClock;
  readonly rng: WorldRng;
  readonly world: World;
  readonly entities: EntityManager;
  readonly events: EventBus;
  readonly scheduler: SimulationScheduler;
  readonly metrics: SimulationMetrics;
  readonly recorder: EventRecorder;
  readonly history: WorldHistory;
  readonly humanFactory: HumanFactory;

  private started = false;
  private disposed = false;

  constructor(options: SimulationOptions) {
    this.config = createSimulationConfig(
      options.population === undefined
        ? options.config
        : {
            ...options.config,
            humans: { ...options.config?.humans, initialPopulation: options.population },
          },
    );

    this.clock = new SimulationClock(this.config.time);
    this.rng = new WorldRng(options.seed);
    this.entities = new EntityManager();
    this.events = new EventBus();
    this.recorder = new EventRecorder(this.events);
    this.history = new WorldHistory(this.events);
    this.metrics = new SimulationMetrics();
    this.scheduler = new SimulationScheduler(this.config.scheduler);

    this.world = new World({
      worldId: options.worldId ?? `world-${options.seed}`,
      seed: options.seed,
      clock: this.clock,
      config: this.config,
      ...(options.generation === undefined ? {} : { generation: options.generation }),
    });

    this.humanFactory = new HumanFactory({
      entities: this.entities,
      events: this.events,
      clock: this.clock,
      world: this.world,
      config: this.config,
      rng: this.rng.humans,
      metabolismRng: this.rng.metabolism,
    });

    for (const system of options.systems ?? defaultSystems()) {
      this.scheduler.register(system);
    }
    this.scheduler.initializeAll((delta) => this.createContext(delta));

    // L'hydrologie est déjà calculée à la construction du monde : on en publie le résultat
    // pour que l'historique et le debug sachent quelles eaux existent, sans avoir à
    // parcourir la carte.
    for (const body of this.world.hydrology.bodies) {
      this.events.emit('WaterBodyCreated', {
        tick: 0,
        id: body.id,
        kind: body.type,
        areaM2: Math.round(body.areaM2),
        meanDepthM: Math.round(body.meanDepthM * 100) / 100,
      });
    }

    if (options.spawnInitialPopulation !== false) {
      this.humanFactory.createInitialPopulation(
        this.config.humans.initialPopulation,
        // Le placement du campement est une décision de monde, pas une caractéristique
        // individuelle : il appartient donc au stream de génération du monde.
        this.rng.worldGeneration,
      );
    }
  }

  /* ---- Cycle de vie -------------------------------------------------- */

  start(): void {
    this.assertNotDisposed();
    if (this.started) return;
    this.started = true;
    this.clock.resume();
    this.events.emit('SimulationStarted', {
      tick: this.clock.currentTick,
      worldId: this.world.worldId,
      seed: this.world.seed,
    });
  }

  pause(): void {
    this.assertNotDisposed();
    if (this.clock.paused) return;
    this.clock.pause();
    this.events.emit('SimulationPaused', { tick: this.clock.currentTick });
  }

  resume(): void {
    this.assertNotDisposed();
    if (!this.clock.paused) return;
    this.clock.resume();
    this.events.emit('SimulationResumed', { tick: this.clock.currentTick });
  }

  get isRunning(): boolean {
    return this.started && !this.clock.paused && !this.disposed;
  }

  /**
   * Avance d'un tick en respectant la pause.
   * Retourne `false` si rien n'a été simulé.
   */
  tick(): boolean {
    this.assertNotDisposed();
    if (this.clock.paused) return false;
    this.runOneTick();
    return true;
  }

  /**
   * Avance de `count` ticks **en ignorant la pause**.
   * Réservé aux tests, au CLI headless et au pas-à-pas du debug.
   */
  step(count = 1): void {
    this.assertNotDisposed();
    for (let i = 0; i < count; i++) this.runOneTick();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scheduler.dispose();
    this.recorder.dispose();
    this.history.dispose();
    this.events.clear();
    this.entities.clear();
  }

  /* ---- Observation --------------------------------------------------- */

  get humanCount(): number {
    return this.entities.query(Human).length;
  }

  humanIds(): EntityId[] {
    return this.entities.query(Human);
  }

  stats(): SimulationStats {
    const metrics = this.metrics.snapshot(this.clock.currentTick);
    const entityStats = this.entities.stats();
    return {
      tick: metrics.tick,
      entityCount: entityStats.entityCount,
      humanCount: this.humanCount,
      chunkCount: this.world.bounds.chunkCount,
      averageTickMs: metrics.averageTickMs,
      lastTickMs: metrics.lastTickMs,
      tickMsP50: metrics.tickMsP50,
      tickMsP95: metrics.tickMsP95,
      tickMsP99: metrics.tickMsP99,
      tickMsMax: metrics.tickMsMax,
      ticksPerSecond: metrics.ticksPerSecond,
      systems: metrics.systems.map((system) => ({
        name: system.name,
        averageMs: system.averageMs,
        runs: system.runs,
      })),
    };
  }

  /* ---- Interne ------------------------------------------------------- */

  private runOneTick(): void {
    this.metrics.beginTick();
    this.clock.advance(1);
    this.scheduler.run(
      this.clock.currentTick,
      this.clock.gameSecondsPerTick,
      (delta) => this.createContext(delta),
      this.metrics,
    );
    this.metrics.endTick();
  }

  /* ---- Persistance ---------------------------------------------------- */

  /**
   * Capture un instantané suffisant pour reprendre la simulation à l'identique.
   *
   * Ce que la capture NE contient PAS, volontairement :
   * - le monde procédural (il se régénère depuis `seed` + `generationVersion`) ;
   * - le `WorldChangeJournal` (flux réseau volatile, sans valeur après un rechargement) ;
   * - la file interne du `PathfindingSystem` (une requête en vol est perdue ; voir
   *   `restoreSnapshot`, qui efface `pathPendingFor`/`pathRequestId` pour que le
   *   système la redemande proprement au prochain tick plutôt que d'attendre
   *   indéfiniment un résultat qui n'arrivera jamais).
   */
  captureSnapshot(): SimulationSnapshot {
    this.assertNotDisposed();
    return {
      version: SIMULATION_SNAPSHOT_VERSION,
      worldId: this.world.worldId,
      seed: this.world.seed,
      generationVersion: this.world.generationVersion,
      configFingerprint: this.currentConfigFingerprint(),
      clock: this.clock.getState(),
      rng: this.rng.getState(),
      entities: captureEntities(this.entities),
      scheduler: this.scheduler.getState(),
      delta: this.world.delta.toJSON(),
      history: this.history.getState(),
      ecologyVersion: 1,
    };
  }

  /**
   * Restaure un instantané précédemment capturé sur CETTE instance de simulation.
   *
   * Précondition : la simulation doit avoir été construite avec la même `seed`, la
   * même `generationVersion` ET la même configuration — sinon le monde procédural ou
   * les règles de jeu sous-jacentes ne correspondraient plus à ce qu'attendait le
   * snapshot. On lève plutôt que de charger silencieusement un état incohérent (bug
   * corrigé : avant `configFingerprint`, seuls seed et generationVersion étaient
   * vérifiés — une dérive de `SimulationConfig`, comme un `walkSpeedMps` changé entre
   * la sauvegarde et le chargement, passait inaperçue).
   */
  restoreSnapshot(rawSnapshot: SimulationSnapshot): void {
    this.assertNotDisposed();
    // Migrations explicites (pas de rejet aveugle) : voir la doc de
    // `SIMULATION_SNAPSHOT_VERSION` sur pourquoi les migrations en chaîne v9→v10→v11→v12
    // valent mieux qu'un simple bump qui invaliderait des sauvegardes déjà distribuées.
    let snapshot: SimulationSnapshot = rawSnapshot;
    if (snapshot.version === 9) snapshot = migrateSnapshotV9ToV10(snapshot);
    if (snapshot.version === 10) snapshot = migrateSnapshotV10ToV11(snapshot);
    if (snapshot.version === 11) snapshot = migrateSnapshotV11ToV12(snapshot);
    if (snapshot.version === 12) snapshot = migrateSnapshotV12ToV13(snapshot);
    if (snapshot.version === 13) snapshot = migrateSnapshotV13ToV14(snapshot);
    if (snapshot.version !== SIMULATION_SNAPSHOT_VERSION) {
      throw new Error(
        `restoreSnapshot: version ${snapshot.version} incompatible avec ${SIMULATION_SNAPSHOT_VERSION}`,
      );
    }
    if (snapshot.seed !== this.world.seed) {
      throw new Error(
        `restoreSnapshot: seed du snapshot ("${snapshot.seed}") ne correspond pas à celle du monde ("${this.world.seed}")`,
      );
    }
    if (snapshot.generationVersion !== this.world.generationVersion) {
      throw new Error(
        `restoreSnapshot: generationVersion incompatible (snapshot "${snapshot.generationVersion}", monde "${this.world.generationVersion}")`,
      );
    }
    const currentFingerprint = this.currentConfigFingerprint();
    const matchesLegacyFingerprint =
      snapshot.ecologyVersion === undefined &&
      snapshot.configFingerprint === this.legacyConfigFingerprint();
    // Sauvegardes antérieures à la Phase 3 (cognition absent du fingerprint) : on
    // accepte toute origine (v9 ou v10) dont l'empreinte pré-cognition correspond —
    // `rawSnapshot.version` (version D'ORIGINE du fichier) détermine quelle formule
    // a pu la produire ; une sauvegarde v10 créée par le commit 2bff5af avait déjà
    // `ecologyVersion` mais pas `cognition` dans son empreinte.
    const matchesPreCognitionFingerprint =
      snapshot.ecologyVersion !== undefined &&
      snapshot.configFingerprint === this.preCognitionConfigFingerprint() &&
      (rawSnapshot.version === 9 || rawSnapshot.version === 10);
    if (
      snapshot.configFingerprint !== currentFingerprint &&
      !matchesLegacyFingerprint &&
      !matchesPreCognitionFingerprint
    ) {
      throw new Error(
        `restoreSnapshot: configuration incompatible (empreinte snapshot "${snapshot.configFingerprint}", ` +
          `empreinte actuelle "${currentFingerprint}") — la SimulationConfig ou la taille du monde a changé ` +
          `depuis cette sauvegarde`,
      );
    }

    this.clock.setState(snapshot.clock);
    this.rng.setState(snapshot.rng);
    restoreEntities(this.entities, snapshot.entities);
    this.scheduler.setState(snapshot.scheduler);
    this.world.delta.restoreFrom(snapshot.delta);
    // Transition progressive des sauvegardes v9 créées avant `WorldHistory` : ce champ
    // purement narratif peut être absent sans altérer l'état ni le déterminisme.
    this.history.setState(snapshot.history ?? []);

    // Une requête de chemin EN VOL au moment de la sauvegarde n'existe plus dans le
    // `PathFindingService` fraîchement reconstruit : sans ce nettoyage, l'entité
    // resterait bloquée à attendre indéfiniment un résultat qui n'arrivera jamais
    // (movement.pathRequestId ne correspond plus à aucune requête réelle).
    //
    // Bug corrigé : cette purge effaçait `waypoints` pour TOUTE entité, y compris
    // celles dont le chemin était déjà entièrement résolu (`pathRequestId === null`,
    // `waypoints` non vide) — un chemin résolu est une donnée pure, entièrement
    // capturée par le snapshot, qui n'a besoin d'aucun service externe pour rester
    // valide. L'effacer forçait `PathfindingSystem` à recalculer un chemin identique
    // depuis zéro à chaque rechargement, pour RIEN : un tick de marche perdu par
    // entité en cours de trajet, et une divergence immédiate (dès le tick suivant)
    // entre une simulation rechargée et une simulation jamais interrompue — measurée
    // via `hashSnapshot`/`hashWorldState` dans le test « continu vs rechargé ». Seules
    // les entités avec une requête VRAIMENT en vol (`pathRequestId !== null`, donc
    // `waypoints` nécessairement vide — `PathfindingSystem` ne soumet jamais une
    // nouvelle requête tant que `waypoints` n'est pas vide) ont quoi que ce soit à
    // perdre ici.
    this.entities.each([Movement], (_entity, movement) => {
      if (movement.pathRequestId === null) return;
      movement.pathPendingFor = null;
      movement.pathRequestId = null;
      movement.waypoints = [];
    });
  }

  /**
   * Empreinte actuelle de la config + géométrie du monde — voir `configFingerprint.ts`.
   *
   * Couvre trois sources, toutes automatiques (aucune ne demande à un humain de se
   * souvenir de bumper quoi que ce soit) :
   * - les sections de `SimulationConfig` qui régissent le comportement d'entités déjà
   *   vivantes : `time`, `environment`, `movement`, `wander`, `needs`, `perception`,
   *   `pathfinding`, `scheduler`, et depuis le snapshot v10, `cognition`. Exclus
   *   délibérément :
   *   - `humans` (génération de la population initiale) : sans systèmes de naissance,
   *     cette config ne sert qu'à créer les humains jetables remplacés par
   *     `restoreEntities` — une population de secours à 15 vs 5 ne rend pas une
   *     sauvegarde incompatible, elle n'a simplement plus d'effet après le chargement.
   *     (Bug corrigé : la première version hashait toute `SimulationConfig`, y compris
   *     `humans`, ce qui refusait à tort un chargement légitime dont seule la
   *     population par défaut différait.)
   *   - `network` (cadence de diffusion réseau) : purement côté hébergement, sans effet
   *     sur l'état simulé.
   * - `generator.fingerprintSource` (v6) : les paramètres numériques de génération
   *   (`WorldGenerationConfig` — relief, hydrologie, ressources…) ET le contenu
   *   déclaratif qui les accompagne (biomes, ressources, profils d'eau). Avant cela,
   *   seul `generationVersion` — une chaîne bumpée à la main — protégeait contre une
   *   dérive de ces paramètres ; un ajustement de `hydrology.waterLevel01` ou de la
   *   toxicité d'une baie oublié dans `generationVersion` passait inaperçu. Exposé par
   *   `@civ/procedural` en `unknown` sérialisable justement pour que ce module n'ait
   *   jamais besoin d'importer `@civ/content` (CLAUDE.md règle 2) pour le hacher.
   * - la géométrie du monde (taille, taille de chunk).
   *
   * Trois formules coexistent pour couvrir trois ères historiques distinctes (un
   * snapshot ne peut être comparé qu'à la formule utilisée au moment où il a été
   * produit — bug visé par ce fix : `cognition` avait été ajoutée à `SimulationConfig`
   * sans jamais entrer dans l'empreinte, une dérive de sa configuration entre deux
   * chargements passait inaperçue) :
   * - `currentConfigFingerprint()` : tout, y compris `cognition` (v10+).
   * - `preCognitionConfigFingerprint()` : `weather`/`ecology` inclus, `cognition` non —
   *   sauvegardes v9 postérieures à l'écologie mais antérieures à la Phase 3.
   * - `legacyConfigFingerprint()` : ni l'un ni l'autre — sauvegardes v9 antérieures à
   *   l'écologie (`ecologyVersion` absent).
   */
  private currentConfigFingerprint(): string {
    return this.computeBehaviorFingerprint({ includeEcology: true, includeCognition: true });
  }

  /** Formule exacte utilisée par les sauvegardes v9 postérieures à l'écologie mais antérieures à la Phase 3 (cognition). */
  private preCognitionConfigFingerprint(): string {
    return this.computeBehaviorFingerprint({ includeEcology: true, includeCognition: false });
  }

  /** Formule exacte utilisée par les sauvegardes v9 antérieures à l'écologie. */
  private legacyConfigFingerprint(): string {
    return this.computeBehaviorFingerprint({ includeEcology: false, includeCognition: false });
  }

  private computeBehaviorFingerprint(options: {
    includeEcology: boolean;
    includeCognition: boolean;
  }): string {
    const {
      time,
      environment,
      weather,
      ecology,
      cognition,
      movement,
      wander,
      needs,
      perception,
      pathfinding,
      scheduler,
    } = this.config;
    const behavior = {
      time,
      environment,
      movement,
      wander,
      needs,
      perception,
      pathfinding,
      scheduler,
    };
    const simulation = {
      ...behavior,
      ...(options.includeEcology ? { weather, ecology } : {}),
      ...(options.includeCognition ? { cognition } : {}),
    };
    return computeConfigFingerprint(
      { simulation, generation: this.world.generator.fingerprintSource },
      { sizeMeters: this.world.sizeMeters, chunkSizeMeters: this.world.chunkSizeMeters },
    );
  }

  private createContext(deltaGameSeconds: number): SystemUpdateContext {
    return {
      world: this.world,
      entities: this.entities,
      events: this.events,
      rng: this.rng,
      clock: this.clock,
      config: this.config,
      tick: this.clock.currentTick,
      deltaGameSeconds,
    };
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('Simulation has been disposed');
  }
}

/**
 * Systèmes actifs : métabolisme, perception, satisfaction des besoins, errance,
 * pathfinding, mouvement. L'ordre d'enregistrement est l'ordre d'exécution : le
 * métabolisme met à jour les besoins, la perception remplit la mémoire de ce qui a été
 * vu, la satisfaction décide depuis cette mémoire, le wander erre quand rien ne presse,
 * le pathfinding rend la cible atteignable, puis on se déplace. `ForgettingSystem`
 * (Phase 3.2) fait vieillir la mémoire cognitive générique en fin de liste, en parallèle
 * — elle ne pilote encore aucune décision.
 */
export function defaultSystems(): SimulationSystem[] {
  return [
    new MetabolismSystem(),
    new PerceptionSystem(),
    new NeedSatisfactionSystem(),
    new LearningSystem(),
    new TemporaryWanderSystem(),
    new PathfindingSystem(),
    new MovementSystem(),
    new ResourceInteractionSystem(),
    new EcologySystem(),
    new ForgettingSystem(),
  ];
}
