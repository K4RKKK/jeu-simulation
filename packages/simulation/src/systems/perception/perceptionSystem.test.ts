import { describe, expect, it } from 'vitest';
import { CognitiveMemory, Memory, Transform } from '../../components/index.js';
import type {
  CognitiveMemoryComponent,
  MemoryComponent,
  TransformComponent,
} from '../../components/index.js';
import { Simulation } from '../../simulation.js';
import { scanForShorePoint } from './perceptionModel.js';
import { PerceptionSystem } from './perceptionSystem.js';

/**
 * La perception est le seul chemin du savoir spatial : ce que l'humain n'a pas vu de ses
 * yeux ne figure jamais dans sa mémoire. Le système est déterministe — aucun tirage.
 */
function perceptionSimulation(
  seed: string,
  population = 1,
  extraConfig?: ConstructorParameters<typeof Simulation>[0]['config'],
): Simulation {
  return new Simulation({
    seed,
    population,
    config: { time: { gameSecondsPerTick: 1 }, ...extraConfig },
    systems: [new PerceptionSystem()],
  });
}

function memoryOf(simulation: Simulation): MemoryComponent {
  return simulation.entities.getComponentOrThrow(simulation.humanIds()[0]!, Memory);
}

function cognitiveMemoryOf(simulation: Simulation): CognitiveMemoryComponent {
  return simulation.entities.getComponentOrThrow(simulation.humanIds()[0]!, CognitiveMemory);
}

function transformOf(simulation: Simulation): TransformComponent {
  return simulation.entities.getComponentOrThrow(simulation.humanIds()[0]!, Transform);
}

/** Pose l'humain sur la première ressource du chunk répondant au prédicat. */
function standOnResource(
  simulation: Simulation,
  matches: (spawn: { foodKcal: number; foodToxicity01: number; rememberable: boolean }) => boolean,
): {
  id: string;
  ownerChunkKey: string;
  localId: number;
  x: number;
  z: number;
  foodKcal: number;
  foodToxicity01: number;
} {
  const world = simulation.world;
  const transform = transformOf(simulation);
  const chunk = world.generateChunk(world.chunkAt(transform.x, transform.z));
  const spawn = chunk.resources.find((candidate) => matches(candidate));
  expect(spawn).toBeDefined();
  transform.x = spawn!.x;
  transform.z = spawn!.z;
  return spawn!;
}

describe('PerceptionSystem', () => {
  it('répartit la population sur plusieurs ticks sans retarder le dernier individu', () => {
    const simulation = perceptionSimulation('perception-cohorts', 10);
    simulation.start();

    simulation.step(1);
    const scannedAfterOneTick = simulation
      .humanIds()
      .filter((id) => simulation.entities.getComponentOrThrow(id, Memory).lastFoodScanX !== null);
    expect(scannedAfterOneTick.length).toBeGreaterThan(0);
    expect(scannedAfterOneTick.length).toBeLessThan(simulation.humanCount);

    simulation.step(simulation.config.scheduler.intervals.medium - 1);
    for (const id of simulation.humanIds()) {
      const memory = simulation.entities.getComponentOrThrow(id, Memory);
      expect(memory.lastFoodScanX).not.toBeNull();
      expect(memory.lastWaterScanX).not.toBeNull();
    }
    simulation.dispose();
  });

  it('se souvient des ressources comestibles du chunk dès le premier scan', () => {
    const simulation = perceptionSimulation('perception-food');
    simulation.start();
    standOnResource(simulation, (candidate) => candidate.foodKcal > 0);

    simulation.step(6); // la cohorte de l'humain a eu le temps d'être scannée

    const food = memoryOf(simulation).food;
    expect(food.length).toBeGreaterThan(0);
    for (const entry of food) {
      expect(entry.foodKcal).toBeGreaterThan(0);
      // La toxicité n'est jamais un souvenir : elle se découvre en mangeant.
      expect(entry).not.toHaveProperty('foodToxicity01');
    }
    simulation.dispose();
  });

  /**
   * Phase 3.2 : le même scan écrit AUSSI dans la mémoire cognitive générique, en
   * parallèle de l'ancien `Memory` ci-dessus — coexistence délibérée (P3.21), pas un
   * remplacement.
   */
  it('écrit aussi un souvenir spatial générique pour une ressource comestible vue', () => {
    const simulation = perceptionSimulation('perception-cognitive-food');
    simulation.start();
    const spawn = standOnResource(simulation, (candidate) => candidate.foodKcal > 0);

    simulation.step(6);

    const spatial = cognitiveMemoryOf(simulation).spatial;
    const entry = spatial.find((candidate) => candidate.worldRef?.resourceId === spawn.id);
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe('resource');
    expect(entry?.subjectConceptId).toBeDefined();
    expect(entry?.confidence01).toBe(simulation.config.cognition.freshSpatialConfidence01);
    simulation.dispose();
  });

  it('écrit aussi un souvenir spatial générique pour une rive vue', () => {
    // Même seed que « se souvient de la rive » : garantit un rivage visible dans le rayon
    // système (visionRangeM), ce qui rend le test robuste quelle que soit la config.
    // maxSpatialEntries élevé : la rive est ajoutée avant les ressources ; sans cette
    // limite haute, la 81ème ressource l'évincerait (même confiance → FIFO).
    const simulation = perceptionSimulation('perception-water', 1, {
      cognition: { maxSpatialEntries: 500 },
    });
    simulation.start();
    const world = simulation.world;
    const transform = transformOf(simulation);
    const shore = scanForShorePoint(
      transform.x,
      transform.z,
      simulation.config.perception.visionRangeM,
      simulation.config.perception.waterScanStepM,
      simulation.config.needs.search.drinkShoreDistanceM,
      (x, z) => world.isWalkable(x, z),
      (x, z) => world.hydrology.distanceToWaterMeters(x, z),
    );
    expect(shore).not.toBeNull();
    transform.x = shore!.x;
    transform.z = shore!.z;

    simulation.step(6);

    const spatial = cognitiveMemoryOf(simulation).spatial;
    expect(spatial.some((entry) => entry.kind === 'water')).toBe(true);
    simulation.dispose();
  });

  it('ne retient pas ce qui n’a pas l’apparence de nourriture', () => {
    const simulation = perceptionSimulation('perception-stone');
    simulation.start();
    const stone = standOnResource(simulation, (candidate) => candidate.foodKcal === 0);

    simulation.step(6);

    const ids = memoryOf(simulation).food.map((entry) => entry.resourceId);
    expect(ids).not.toContain(stone.id);
    simulation.dispose();
  });

  /**
   * Bug corrigé (Phase 3.2, correction immédiate après relecture) : la mémoire
   * cognitive ne recevait initialement que les ressources comestibles
   * (`foodKcal > 0`) — de l'omniscience déguisée (une pierre visible n'existait
   * simplement pas pour la cognition). Une ressource non alimentaire visible doit
   * entrer dans `CognitiveMemory`, même si elle n'entre jamais dans l'ancien
   * `Memory.food`.
   */
  it('une ressource non alimentaire visible entre dans CognitiveMemory mais jamais Memory.food', () => {
    // maxSpatialEntries élevé : évite l'éviction quand le chunk contient plus d'entrées
    // que la limite par défaut (80), ce qui ferait sortir la pierre cible du tableau.
    const simulation = perceptionSimulation('perception-cognitive-stone', 1, {
      cognition: { maxSpatialEntries: 500 },
    });
    simulation.start();
    // `rememberable` = interactive : exclut les ressources décoratives (non mémorisables).
    const stone = standOnResource(
      simulation,
      (candidate) => candidate.foodKcal === 0 && candidate.rememberable,
    );

    simulation.step(6);

    expect(memoryOf(simulation).food.map((entry) => entry.resourceId)).not.toContain(stone.id);

    const entry = cognitiveMemoryOf(simulation).spatial.find(
      (candidate) => candidate.worldRef?.resourceId === stone.id,
    );
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe('resource');
    simulation.dispose();
  });

  /** kcal/toxicité sont une vérité moteur cachée : elles ne doivent jamais fuiter dans la cognition. */
  it('ne copie jamais kcal/toxicité dans la mémoire cognitive', () => {
    const simulation = perceptionSimulation('perception-cognitive-no-leak');
    simulation.start();
    standOnResource(simulation, (candidate) => candidate.foodKcal > 0);

    simulation.step(6);

    for (const entry of cognitiveMemoryOf(simulation).spatial) {
      expect(entry).not.toHaveProperty('foodKcal');
      expect(entry).not.toHaveProperty('foodToxicity01');
    }
    simulation.dispose();
  });

  it('se souvient de la rive quand elle est dans le champ de vision', () => {
    const simulation = perceptionSimulation('perception-water');
    simulation.start();

    const world = simulation.world;
    const transform = transformOf(simulation);
    const shore = scanForShorePoint(
      transform.x,
      transform.z,
      200,
      8,
      simulation.config.needs.search.drinkShoreDistanceM,
      (x, z) => world.isWalkable(x, z),
      (x, z) => world.hydrology.distanceToWaterMeters(x, z),
    );
    expect(shore).not.toBeNull();
    transform.x = shore!.x;
    transform.z = shore!.z;

    simulation.step(6);

    const water = memoryOf(simulation).water;
    expect(water.length).toBeGreaterThan(0);
    expect(world.hydrology.distanceToWaterMeters(water[0]!.x, water[0]!.z)).toBeLessThanOrEqual(
      simulation.config.needs.search.drinkShoreDistanceM,
    );
    simulation.dispose();
  });

  it('ne rescanner l’eau qu’après un déplacement suffisant', () => {
    const simulation = perceptionSimulation('perception-gate');
    simulation.start();

    const world = simulation.world;
    const transform = transformOf(simulation);
    const shore = scanForShorePoint(
      transform.x,
      transform.z,
      200,
      8,
      simulation.config.needs.search.drinkShoreDistanceM,
      (x, z) => world.isWalkable(x, z),
      (x, z) => world.hydrology.distanceToWaterMeters(x, z),
    );
    expect(shore).not.toBeNull();
    transform.x = shore!.x;
    transform.z = shore!.z;

    simulation.step(6);
    const memory = memoryOf(simulation);
    expect(memory.water.length).toBeGreaterThan(0);
    const scanX = memory.lastWaterScanX;
    const scanZ = memory.lastWaterScanZ;
    const lastSeen = memory.water[0]!.lastSeenTick;

    // Immobile, on ne revoit rien de nouveau : ni re-scan, ni souvenir rafraîchi.
    simulation.step(30);
    expect(memoryOf(simulation).lastWaterScanX).toBe(scanX);
    expect(memoryOf(simulation).lastWaterScanZ).toBe(scanZ);
    expect(memoryOf(simulation).water[0]!.lastSeenTick).toBe(lastSeen);
    simulation.dispose();
  });

  /**
   * Bug corrigé : le scan de nourriture ne se relançait qu'au changement de CHUNK,
   * jamais à la distance parcourue — incohérent avec l'eau, et concrètement aveuglant :
   * `chunkSizeMeters` (64 m par défaut) vaut le double de `visionRangeM` (32 m), donc un
   * individu entré dans un chunk par un coin pouvait en traverser toute la diagonale
   * (~90 m) sans jamais rescanner, ratant toute nourriture entrée entre-temps dans son
   * champ de vision. Le scan suit maintenant la même règle que l'eau : il se relance dès
   * qu'on s'est assez déplacé, qu'on ait changé de chunk ou non.
   */
  it('rescanne la nourriture après un déplacement suffisant, même à l’intérieur du même chunk', () => {
    const simulation = perceptionSimulation('perception-food-gate');
    simulation.start();
    const world = simulation.world;
    const transform = transformOf(simulation);

    // Près du bord ouest du chunk courant, avec de la marge pour avancer vers l'est
    // SANS jamais franchir de frontière de chunk.
    const chunkSize = world.chunkSizeMeters;
    const chunk = world.chunkAt(transform.x, transform.z);
    transform.x = chunk.x * chunkSize + 4;
    transform.z = chunk.z * chunkSize + chunkSize / 2;

    simulation.step(6); // premier scan
    const scanX = memoryOf(simulation).lastFoodScanX;
    expect(scanX).not.toBeNull();

    const threshold = simulation.config.perception.foodRescanMoveThresholdM;
    transform.x += threshold + 5; // franchit le seuil, reste dans le même chunk
    expect(world.chunkAt(transform.x, transform.z)).toEqual(chunk);

    simulation.step(6);
    expect(memoryOf(simulation).lastFoodScanX).not.toBe(scanX); // a bien rescanné
    simulation.dispose();
  });

  it('ne rescanne pas la nourriture tant que le déplacement reste sous le seuil', () => {
    const simulation = perceptionSimulation('perception-food-gate-immobile');
    simulation.start();
    standOnResource(simulation, (candidate) => candidate.foodKcal > 0);

    simulation.step(6);
    const scanX = memoryOf(simulation).lastFoodScanX;
    const scanZ = memoryOf(simulation).lastFoodScanZ;

    simulation.step(30); // immobile : rien de nouveau à voir
    expect(memoryOf(simulation).lastFoodScanX).toBe(scanX);
    expect(memoryOf(simulation).lastFoodScanZ).toBe(scanZ);
    simulation.dispose();
  });

  it('n’est pas perturbé par une ressource déjà cueillie dans le chunk', () => {
    const simulation = perceptionSimulation('perception-removed');
    simulation.start();
    const spawn = standOnResource(simulation, (candidate) => candidate.foodKcal > 0);
    simulation.world.delta.markDepleted(
      spawn.id,
      spawn.ownerChunkKey,
      spawn.localId,
      simulation.clock.currentTick,
    );

    simulation.step(6);

    const ids = memoryOf(simulation).food.map((entry) => entry.resourceId);
    expect(ids).not.toContain(spawn.id);
    simulation.dispose();
  });

  it('est déterministe : même seed, mêmes souvenirs', () => {
    const a = perceptionSimulation('perception-det');
    const b = perceptionSimulation('perception-det');
    a.start();
    b.start();

    a.step(6);
    b.step(6);

    const foodA = memoryOf(a)
      .food.map((entry) => entry.resourceId)
      .sort();
    const foodB = memoryOf(b)
      .food.map((entry) => entry.resourceId)
      .sort();
    expect(foodA).toEqual(foodB);
    a.dispose();
    b.dispose();
  });
});
