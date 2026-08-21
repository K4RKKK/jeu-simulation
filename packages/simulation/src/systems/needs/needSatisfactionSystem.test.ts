import { describe, expect, it } from 'vitest';
import type { ResourceSpawn } from '@civ/procedural';
import { NavGrid, PathFindingService } from '@civ/pathfinding';
import {
  Activity,
  CognitiveMemory,
  Movement,
  Needs,
  NeedsState,
  Transform,
} from '../../components/index.js';
import type { CognitiveMemoryComponent } from '../../components/index.js';
import { observeResource, observeShore } from '../../cognition/observationBuilder.js';
import { rememberSpatial } from '../../cognition/spatialMemoryModel.js';
import { Simulation } from '../../simulation.js';
import { scanForShorePoint } from '../perception/perceptionModel.js';
import { MovementSystem } from '../movementSystem.js';
import { PathfindingSystem } from '../pathfinding/pathfindingSystem.js';
import { terrainTileCostProvider } from '../pathfinding/terrainCostProvider.js';
import { TemporaryWanderSystem } from '../temporary/temporaryWanderSystem.js';
import { MetabolismSystem } from './metabolismSystem.js';
import { NeedSatisfactionSystem } from './needSatisfactionSystem.js';

/**
 * La satisfaction est la première vraie prise de décision vitale : priorité physiologique
 * (épuisement > soif > faim), déplacements vers l'eau et la nourriture, et des raisons
 * lisibles (CLAUDE.md règle 12). Les décisions ne viennent **jamais** d'une recherche dans
 * le monde : elles viennent de la mémoire individuelle remplie par la perception.
 */
function needsSystems(): Simulation {
  return new Simulation({
    seed: 'needs',
    population: 1,
    config: { time: { gameSecondsPerTick: 1 } },
    systems: [
      new MetabolismSystem(),
      new NeedSatisfactionSystem(),
      new PathfindingSystem(),
      new MovementSystem(),
    ],
  });
}

/** Vrai chemin de bout en bout, comme le calculerait le PathfindingSystem en direct. */
function isReachable(
  simulation: Simulation,
  from: { x: number; z: number },
  to: { x: number; z: number },
): boolean {
  const config = simulation.config.pathfinding;
  const service = new PathFindingService({
    grid: new NavGrid({
      tileSizeMeters: config.tileSizeMeters,
      cost: terrainTileCostProvider(simulation.world, config),
    }),
    maxNodesPerTick: config.maxNodesPerTick,
    maxNodesPerRequest: config.maxNodesPerRequest,
    maxRetries: 0,
    pathCacheCapacity: 8,
    snapRadiusTiles: config.snapRadiusTiles,
  });
  const reply = service.request(from, to, 0);
  if (reply.immediate !== null) return reply.immediate.path !== null;
  return service.process().some((outcome) => outcome.path !== null);
}

function setNeeds(
  simulation: Simulation,
  needs: { hydration?: number; hunger?: number; energy?: number },
): void {
  const entity = simulation.humanIds()[0]!;
  const component = simulation.entities.getComponentOrThrow(entity, Needs);
  if (needs.hydration !== undefined) component.hydration = needs.hydration;
  if (needs.hunger !== undefined) component.hunger = needs.hunger;
  if (needs.energy !== undefined) component.energy = needs.energy;
}

/** Semer la mémoire cognitive d'un humain : c'est le rôle de la perception en vrai. */
function seedCognition(simulation: Simulation): CognitiveMemoryComponent {
  return simulation.entities.getComponentOrThrow(simulation.humanIds()[0]!, CognitiveMemory);
}

/**
 * Trouve une ressource comestible dans le monde (génération directe, comme le ferait la
 * perception) et place l'humain dessus, puis sème le souvenir cognitif correspondant.
 */
function seedFoodUnderHuman(
  simulation: Simulation,
  edible: (spawn: ResourceSpawn) => boolean,
): ResourceSpawn {
  const world = simulation.world;
  const entity = simulation.humanIds()[0]!;
  const transform = simulation.entities.getComponentOrThrow(entity, Transform);

  const chunk = world.generateChunk(world.chunkAt(transform.x, transform.z));
  const spawn = chunk.resources.find(
    (candidate) => edible(candidate) && world.isWalkable(candidate.x, candidate.z),
  );
  expect(spawn).toBeDefined();
  transform.x = spawn!.x;
  transform.z = spawn!.z;

  rememberSpatial(
    seedCognition(simulation),
    observeResource(spawn!, simulation.clock.currentTick),
    simulation.config.cognition,
  );
  return spawn!;
}

/**
 * Trouve une rive **atteignable** dans le voisinage (rayons croissants) et sème son
 * souvenir cognitif. Sans vérification d'atteignabilité, le test dépendrait de la
 * géographie de la seed : une rive derrière un lac serait « mémorisée » mais sans
 * chemin, et l'humain resterait au camp — le test échouerait pour la mauvaise raison.
 */
function seedWaterNearHuman(simulation: Simulation, radiusM: number): { x: number; z: number } {
  const world = simulation.world;
  const entity = simulation.humanIds()[0]!;
  const transform = simulation.entities.getComponentOrThrow(entity, Transform);

  for (let radius = 8; radius <= radiusM; radius += 8) {
    const point = scanForShorePoint(
      transform.x,
      transform.z,
      radius,
      8,
      simulation.config.needs.search.drinkShoreDistanceM,
      (x, z) => world.isWalkable(x, z),
      (x, z) => world.hydrology.distanceToWaterMeters(x, z),
    );
    if (point === null) continue;
    if (!isReachable(simulation, { x: transform.x, z: transform.z }, point)) continue;

    rememberSpatial(
      seedCognition(simulation),
      observeShore(point, simulation.clock.currentTick),
      simulation.config.cognition,
    );
    return point;
  }
  throw new Error(`aucune rive atteignable dans ${radiusM} m autour de la position initiale`);
}

describe('NeedSatisfactionSystem', () => {
  it('sends a thirsty human towards a remembered shore', () => {
    const simulation = needsSystems();
    simulation.start();
    const shore = seedWaterNearHuman(simulation, 64);
    setNeeds(simulation, { hydration: 0.05 });
    simulation.step(10);

    const entity = simulation.humanIds()[0]!;
    const activity = simulation.entities.getComponentOrThrow(entity, Activity);
    const state = simulation.entities.getComponentOrThrow(entity, NeedsState);

    // La décision vient du souvenir, et la raison le dit (règle 12).
    expect(activity.reason).toContain("se souvient d'une rive");
    if (state.action === 'seekWater') {
      expect(activity.kind).toBe('walking');
      expect(activity.reason).toContain('part boire');
      const movement = simulation.entities.getComponentOrThrow(entity, Movement);
      expect(movement.targetX).not.toBeNull();
      expect(movement.targetZ).not.toBeNull();
      expect(
        simulation.world.hydrology.distanceToWaterMeters(movement.targetX!, movement.targetZ!),
      ).toBeLessThanOrEqual(simulation.config.needs.search.drinkShoreDistanceM);
      expect(movement.targetX).toBe(shore.x);
      expect(movement.targetZ).toBe(shore.z);
    } else {
      // Le souvenir était déjà sous les pieds : le repas d'eau a commencé directement.
      expect(state.action).toBe('drink');
      expect(activity.kind).toBe('drink');
    }
    simulation.dispose();
  });

  it('sends a hungry human towards a remembered resource', () => {
    const simulation = needsSystems();
    simulation.start();
    seedFoodUnderHuman(simulation, (candidate) => candidate.foodKcal > 0);
    setNeeds(simulation, { hydration: 1, hunger: 0.05 });
    simulation.step(10);

    const entity = simulation.humanIds()[0]!;
    const activity = simulation.entities.getComponentOrThrow(entity, Activity);
    const movement = simulation.entities.getComponentOrThrow(entity, Movement);
    const state = simulation.entities.getComponentOrThrow(entity, NeedsState);

    // La décision de se nourrir est prise, avec une raison lisible (règle 12). Selon le
    // monde, la ressource la plus proche est à portée de main (repas immédiat) ou plus
    // loin (déplacement) : les deux sont la même décision, vérifiée sans omniscience.
    if (state.action === 'seekFood') {
      expect(activity.kind).toBe('walking');
      expect(activity.reason).toContain('chercher de la nourriture');
      expect(movement.targetX).not.toBeNull();
      expect(movement.targetZ).not.toBeNull();
    } else {
      expect(state.action).toBe('eat');
      expect(activity.kind).toBe('eat');
      expect(activity.reason).toContain('mange pour apaiser sa faim');
    }
    expect(state.resourceId).not.toBeNull();
    simulation.dispose();
  });

  it('makes an exhausted human rest before seeking water', () => {
    const simulation = needsSystems();
    simulation.start();
    setNeeds(simulation, { hydration: 0.05, energy: 0.05 });
    simulation.step(10);

    const entity = simulation.humanIds()[0]!;
    const activity = simulation.entities.getComponentOrThrow(entity, Activity);
    const state = simulation.entities.getComponentOrThrow(entity, NeedsState);

    expect(activity.kind).toBe('rest');
    expect(activity.reason).toContain('épuisé');
    expect(state.action).toBe('rest');
    simulation.dispose();
  });

  it('drinks until the target or the maximum duration is reached, then stops', () => {
    const simulation = needsSystems();
    simulation.start();
    seedWaterNearHuman(simulation, 64);
    setNeeds(simulation, { hydration: 0.05 });

    // Laisser le temps d'aller à l'eau et de boire : une soif extrême peut demander
    // plusieurs pauses avant d'atteindre le niveau visé (la durée d'une boisson est
    // bornée par la configuration).
    let sawDrink = false;
    let stopped = false;
    for (let i = 0; i < 400; i++) {
      simulation.step(1);
      const activity = simulation.entities.getComponentOrThrow(simulation.humanIds()[0]!, Activity);
      if (activity.kind === 'drink') sawDrink = true;
      if (sawDrink && activity.kind === 'idle' && activity.reason.includes('soif')) {
        stopped = true;
        break;
      }
    }

    const entity = simulation.humanIds()[0]!;
    const needs = simulation.entities.getComponentOrThrow(entity, Needs);
    const state = simulation.entities.getComponentOrThrow(entity, NeedsState);
    expect(sawDrink).toBe(true);
    expect(stopped).toBe(true);
    expect(needs.hydration).toBeGreaterThan(0.6);
    expect(state.action).toBe('none');
    simulation.dispose();
  });

  /**
   * Bug corrigé par la récolte progressive : la seule ressource assez calorique pour ce
   * test (`hazel_bush`, `harvestServings: 4`) ne disparaît plus après une seule bouchée
   * — elle reste dans le monde, entamée, jusqu'à sa dernière portion. Ce test vérifie
   * les deux bouts : une visite n'épuise pas une ressource à plusieurs portions, et sa
   * DERNIÈRE portion la retire exactement comme avant (même journalisation réseau).
   */
  it('removes the eaten resource from the world once all its portions are gone', () => {
    const simulation = needsSystems();
    simulation.start();

    // Ressource copieuse (≥ moitié d'un repas complet) : ce test vérifie le retrait du
    // monde, pas la proportionnalité aux calories (couverte séparément par « caps the
    // hunger gain to what the food's kcal allows »).
    const kcalFloor = simulation.config.needs.hunger.kcalPerFullMeal * 0.5;
    const spawn = seedFoodUnderHuman(simulation, (candidate) => candidate.foodKcal >= kcalFloor);
    const entity = simulation.humanIds()[0]!;
    setNeeds(simulation, { hydration: 1, hunger: 0.05 });

    simulation.step(260); // ~4 minutes : le repas doit se terminer
    expect(simulation.world.delta.isDepleted(spawn.id)).toBe(false);
    expect(simulation.entities.getComponentOrThrow(entity, Needs).hunger).toBeGreaterThan(0.05);

    // Épuise directement les portions restantes (une déjà prise par la simulation
    // ci-dessus) : prouve que la DERNIÈRE portion retire bien la ressource.
    for (let i = 1; i < spawn.harvestServings; i++) {
      simulation.world.harvestResource(
        spawn.id,
        spawn.ownerChunkKey,
        spawn.localId,
        spawn.harvestServings,
        spawn.x,
        spawn.z,
        simulation.clock.currentTick,
      );
    }
    expect(simulation.world.delta.isDepleted(spawn.id)).toBe(true);

    // Le retrait est journalisé avec sa position pour la diffusion réseau temps réel.
    const removals = simulation.world.journal.consumeRemovals();
    expect(removals).toHaveLength(1);
    expect(removals[0]!.resourceId).toBe(spawn.id);
    expect(removals[0]!.x).toBe(spawn.x);
    expect(removals[0]!.z).toBe(spawn.z);
    expect(removals[0]!.ownerChunkKey).toBe(spawn.ownerChunkKey);
    expect(simulation.world.journal.consumeRemovals()).toEqual([]);
    simulation.dispose();
  });

  /**
   * Bug corrigé : le gain de faim ne dépendait que de `eatRatePerSecond` × durée —
   * une petite baie et un repas complet rassasiaient presque pareil. Ce test compare
   * directement les deux cas sur la MÊME simulation (même métabolisme, même durée
   * d'observation) pour prouver que la ressource la plus calorique nourrit
   * significativement plus.
   */
  it('caps the hunger gain to what the food’s kcal actually allows', () => {
    const kcalPerFullMeal = 600;
    const lowKcalSim = needsSystems();
    lowKcalSim.start();
    const lowSpawn = seedFoodUnderHuman(
      lowKcalSim,
      (candidate) => candidate.foodKcal > 0 && candidate.foodKcal < kcalPerFullMeal * 0.2,
    );
    setNeeds(lowKcalSim, { hydration: 1, hunger: 0.05 });
    lowKcalSim.step(260);
    const lowGain =
      lowKcalSim.entities.getComponentOrThrow(lowKcalSim.humanIds()[0]!, Needs).hunger - 0.05;

    const highKcalSim = needsSystems();
    highKcalSim.start();
    const highSpawn = seedFoodUnderHuman(
      highKcalSim,
      (candidate) => candidate.foodKcal >= kcalPerFullMeal * 0.5,
    );
    setNeeds(highKcalSim, { hydration: 1, hunger: 0.05 });
    highKcalSim.step(260);
    const highGain =
      highKcalSim.entities.getComponentOrThrow(highKcalSim.humanIds()[0]!, Needs).hunger - 0.05;

    expect(lowSpawn.foodKcal).toBeLessThan(highSpawn.foodKcal);
    expect(lowGain).toBeGreaterThan(0); // mange quand même, un peu
    expect(highGain).toBeGreaterThan(lowGain * 2); // nettement plus rassasié
    // Le gain d'un petit aliment reste borné par sa propre valeur calorique — jamais
    // par la seule durée de l'activité (c'était exactement le bug).
    expect(lowGain).toBeLessThanOrEqual(lowSpawn.foodKcal / kcalPerFullMeal + 1e-6);

    lowKcalSim.dispose();
    highKcalSim.dispose();
  });

  it('picks a toxic food when it is the closest: the toxicity is discovered by eating', () => {
    const simulation = needsSystems();
    simulation.start();

    const toxic = seedFoodUnderHuman(simulation, (candidate) => candidate.foodToxicity01 > 0);
    const entity = simulation.humanIds()[0]!;
    setNeeds(simulation, { hydration: 1, hunger: 0.05 });

    simulation.step(100); // ~100 s : le repas est engagé mais pas terminé (borné à 180 s)

    const state = simulation.entities.getComponentOrThrow(entity, NeedsState);
    // L'humain visait bien la ressource toxique, et les symptômes commencent au moment
    // de manger, pas avant : la toxicité n'est jamais une connaissance préalable.
    expect(state.poisoningToxicity01).toBe(toxic.foodToxicity01);
    expect(state.poisoningUntilTick).toBeGreaterThanOrEqual(simulation.clock.currentTick);
    simulation.dispose();
  });

  it('leaves a drinking human alone: the wander does not interfere', () => {
    const simulation = new Simulation({
      seed: 'wander-respect',
      population: 1,
      config: { time: { gameSecondsPerTick: 1 } },
      systems: [
        new MetabolismSystem(),
        new NeedSatisfactionSystem(),
        new TemporaryWanderSystem(),
        new PathfindingSystem(),
        new MovementSystem(),
      ],
    });
    simulation.start();
    seedWaterNearHuman(simulation, 48);
    setNeeds(simulation, { hydration: 0.05 });

    let drank = false;
    for (let i = 0; i < 300; i++) {
      simulation.step(1);
      const activity = simulation.entities.getComponentOrThrow(simulation.humanIds()[0]!, Activity);
      if (activity.kind === 'drink') drank = true;
      if (drank && activity.reason.includes('soif') && activity.kind !== 'drink') break;
    }
    expect(drank).toBe(true);
    // Pendant l'action vitale, le wander n'a jamais imposé sa propre errance.
    let wanderInterfered = false;
    const entity = simulation.humanIds()[0]!;
    for (let i = 0; i < 50; i++) {
      simulation.step(1);
      const activity = simulation.entities.getComponentOrThrow(entity, Activity);
      if (activity.kind === 'walking' && activity.reason.includes('sans but')) {
        wanderInterfered = true;
      }
    }
    expect(wanderInterfered).toBe(false);
    simulation.dispose();
  });
});
