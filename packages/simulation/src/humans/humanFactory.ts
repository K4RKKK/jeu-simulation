import type { EntityId, Sex } from '@civ/shared';
import {
  Activity,
  CognitiveKnowledge,
  CognitiveMemory,
  Human,
  HumanCognition,
  Memory,
  Movement,
  Needs,
  Personality,
  Transform,
  createEmptyCognitiveKnowledge,
  createEmptyCognitiveMemory,
  createEmptyHumanCognition,
  type PersonalityComponent,
} from '../components/index.js';
import type { SimulationConfig } from '../config/simulationConfig.js';
import type { SimulationClock } from '../core/clock.js';
import type { EntityManager } from '../core/entityManager.js';
import type { EventBus } from '../core/eventBus.js';
import { TAU, clamp, inverseLerp, lerp } from '../core/math.js';
import type { RandomStream } from '../core/rng.js';
import type { World } from '../world/world.js';
import { generateName } from './names.js';

export interface SpawnPosition {
  x: number;
  z: number;
}

export interface HumanFactoryDeps {
  entities: EntityManager;
  events: EventBus;
  clock: SimulationClock;
  world: World;
  config: SimulationConfig;
  /** Stream `humans` du `WorldRng` : garantit que la population est reproductible. */
  rng: RandomStream;
  /** Stream `metabolism` : variations physiologiques, cloisonnées de la personnalité. */
  metabolismRng: RandomStream;
}

/**
 * Fabrique d'humains.
 *
 * Principe directeur : **rien n'est tiré au hasard qui puisse être dérivé**.
 * L'âge est tiré, la taille dépend du sexe et de l'âge, la masse dépend de la taille et
 * d'un IMC tiré, la vitesse de marche dépend de la taille et de l'âge. Quand le
 * métabolisme arrivera, il consommera ces grandeurs physiques plutôt que d'inventer les
 * siennes.
 */
export class HumanFactory {
  constructor(private readonly deps: HumanFactoryDeps) {}

  /** Crée un humain complet à la position donnée. */
  create(position: SpawnPosition): EntityId {
    const { entities, events, clock, config, rng } = this.deps;
    const humanConfig = config.humans;

    const sex: Sex = rng.bool(0.5) ? 'male' : 'female';
    const ageYears = Math.round(
      rng.clampedGaussian(
        humanConfig.meanAgeYears,
        humanConfig.ageStdDevYears,
        humanConfig.minAgeYears,
        humanConfig.maxAgeYears,
      ),
    );

    const adultHeight =
      sex === 'male' ? humanConfig.adultHeightMaleM : humanConfig.adultHeightFemaleM;
    const heightM = round2(
      rng.clampedGaussian(
        adultHeight,
        humanConfig.heightStdDevM,
        adultHeight - 0.25,
        adultHeight + 0.25,
      ) * growthFactor(ageYears, humanConfig.adultAgeYears),
    );

    const bmi = rng.clampedGaussian(humanConfig.meanBmi, humanConfig.bmiStdDev, 15, 30);
    const massKg = round1(bmi * heightM * heightM);

    const walkSpeedMps = round2(
      humanConfig.baseWalkSpeedMps *
        // Une jambe plus longue avance plus vite : proportionnel à la taille adulte.
        (heightM / adultHeight) *
        ageSpeedFactor(ageYears, humanConfig),
    );

    const entity = entities.createEntity();
    const name = generateName(rng);

    entities.addComponent(entity, Human, {
      name,
      sex,
      ageYears,
      heightM,
      massKg,
      tint: round2(rng.float()),
      bornAtTick: clock.currentTick,
    });

    const x = round2(position.x);
    const z = round2(position.z);
    entities.addComponent(entity, Transform, {
      x,
      z,
      y: round2(this.deps.world.heightAt(x, z)),
      yaw: rng.range(-Math.PI, Math.PI),
    });

    entities.addComponent(entity, Movement, {
      walkSpeedMps,
      currentSpeedMps: 0,
      targetX: null,
      targetZ: null,
      waypoints: [],
      pathPendingFor: null,
      pathRequestId: null,
      lastTrailSampleX: null,
      lastTrailSampleZ: null,
    });

    entities.addComponent(entity, Personality, this.rollPersonality(rng));

    entities.addComponent(entity, Needs, {
      hydration: round2(this.deps.metabolismRng.clampedGaussian(0.85, 0.08, 0.6, 1)),
      hunger: round2(this.deps.metabolismRng.clampedGaussian(0.8, 0.1, 0.5, 1)),
      energy: round2(this.deps.metabolismRng.clampedGaussian(0.9, 0.06, 0.6, 1)),
      // Un taux propre à l'individu, tiré dans son propre stream pour ne pas décaler la
      // personnalité ni le reste de la population (CLAUDE.md règle 4).
      metabolismRate: round2(this.deps.metabolismRng.clampedGaussian(1, 0.05, 0.85, 1.15)),
    });

    entities.addComponent(entity, Activity, {
      kind: 'idle',
      reason: 'vient d’apparaître dans le monde',
      startedAtTick: clock.currentTick,
    });

    // Positions de scan uniquement (Phase 3.5) : les souvenirs eux-mêmes vivent
    // maintenant dans `CognitiveMemory`, alimenté ci-dessous.
    entities.addComponent(entity, Memory, {
      lastFoodScanX: null,
      lastFoodScanZ: null,
      lastWaterScanX: null,
      lastWaterScanZ: null,
    });

    // Squelette cognitif (Phase 3.1) : créé vide, comme `Memory` ci-dessus — rempli par
    // les systèmes de perception/expérience/décision à partir de la sous-phase 3.2.
    entities.addComponent(entity, CognitiveMemory, createEmptyCognitiveMemory());
    entities.addComponent(entity, CognitiveKnowledge, createEmptyCognitiveKnowledge());
    entities.addComponent(entity, HumanCognition, createEmptyHumanCognition());

    events.emit('HumanBorn', { tick: clock.currentTick, entity, name, ageYears });
    return entity;
  }

  /**
   * Crée la population initiale sous forme de groupe.
   *
   * Les individus n'apparaissent pas éparpillés sur tout le monde : un groupe humain a un
   * campement. Ce détail conditionne toute la suite (relations, transmission, langage),
   * d'où le choix d'un point commun plutôt que d'un semis uniforme.
   */
  createInitialPopulation(count: number, placementRng: RandomStream): EntityId[] {
    const { world, config } = this.deps;
    const humanConfig = config.humans;

    // Le site du campement est choisi par la génération procédurale, sur des critères de
    // viabilité (terrain plat, praticable, eau à distance raisonnable). Ce n'est pas une
    // décision des humains : c'est un garde-fou pour ne pas démarrer dans un lac.
    const camp = world.findSpawnSite();

    const created: EntityId[] = [];
    for (let i = 0; i < count; i++) {
      created.push(
        this.create(
          this.findNearbyGround(camp, humanConfig.spawnClusterRadiusMeters, placementRng),
        ),
      );
    }
    return created;
  }

  /**
   * Position praticable autour du campement.
   * Après plusieurs essais infructueux on accepte le centre du camp : mieux vaut deux
   * individus proches qu'un individu dans l'eau.
   */
  private findNearbyGround(
    camp: SpawnPosition,
    radiusMeters: number,
    rng: RandomStream,
  ): SpawnPosition {
    const { world } = this.deps;
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = rng.range(0, TAU);
      // sqrt() pour une densité uniforme dans le disque plutôt qu'un amas au centre.
      const distance = Math.sqrt(rng.float()) * radiusMeters;
      const x = world.bounds.clampX(camp.x + Math.cos(angle) * distance);
      const z = world.bounds.clampZ(camp.z + Math.sin(angle) * distance);
      if (world.isWalkable(x, z)) return { x, z };
    }
    return { x: camp.x, z: camp.z };
  }

  private rollPersonality(rng: RandomStream): PersonalityComponent {
    const trait = (): number => round2(rng.clampedGaussian(0.5, 0.18, 0.02, 0.98));
    return {
      curiosity: trait(),
      caution: trait(),
      sociability: trait(),
      aggression: trait(),
      patience: trait(),
      altruism: trait(),
      courage: trait(),
      perseverance: trait(),
    };
  }
}

/** Proportion de la taille adulte atteinte à un âge donné. */
function growthFactor(ageYears: number, adultAgeYears: number): number {
  if (ageYears >= adultAgeYears) return 1;
  return lerp(0.42, 1, inverseLerp(0, adultAgeYears, ageYears));
}

/** Les enfants et les personnes âgées marchent moins vite. */
function ageSpeedFactor(
  ageYears: number,
  config: {
    adultAgeYears: number;
    elderAgeYears: number;
    youngSpeedFactor: number;
    elderSpeedFactor: number;
    maxAgeYears: number;
  },
): number {
  if (ageYears < config.adultAgeYears) {
    return lerp(config.youngSpeedFactor, 1, inverseLerp(0, config.adultAgeYears, ageYears));
  }
  if (ageYears > config.elderAgeYears) {
    return lerp(
      1,
      config.elderSpeedFactor,
      inverseLerp(config.elderAgeYears, config.maxAgeYears, ageYears),
    );
  }
  return 1;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return clamp(Math.round(value * 100) / 100, -1e9, 1e9);
}
