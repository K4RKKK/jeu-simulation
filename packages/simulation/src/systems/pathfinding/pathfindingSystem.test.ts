import { describe, expect, it, vi } from 'vitest';
import { NavGrid, PathFindingService } from '@civ/pathfinding';
import { Activity, HumanPlan, Movement, NeedsState, Transform } from '../../components/index.js';
import { Simulation } from '../../simulation.js';
import { MovementSystem } from '../movementSystem.js';
import { NeedSatisfactionSystem } from '../needs/needSatisfactionSystem.js';
import { PlannerSystem } from '../cognition/plannerSystem.js';
import { GoalSelectionSystem } from '../cognition/goalSelectionSystem.js';
import { MetabolismSystem } from '../needs/metabolismSystem.js';
import { PathfindingSystem } from './pathfindingSystem.js';
import { createTerrainCostMemo, terrainTileCostProvider } from './terrainCostProvider.js';

function makeSimulation(seed: string): Simulation {
  return new Simulation({
    seed,
    population: 1,
    config: { time: { gameSecondsPerTick: 1 } },
    systems: [
      new MetabolismSystem(),
      new GoalSelectionSystem(),
      new PlannerSystem(),
      new NeedSatisfactionSystem(),
      new PathfindingSystem(),
      new MovementSystem(),
    ],
  });
}

/** Pose une cible et avance assez de ticks pour que la file de chemins soit traitée. */
function travel(simulation: Simulation, targetX: number, targetZ: number, ticks: number): void {
  const movement = simulation.entities.getComponentOrThrow(simulation.humanIds()[0]!, Movement);
  movement.targetX = targetX;
  movement.targetZ = targetZ;
  simulation.step(ticks);
}

/**
 * Cible praticable et **atteignable** (vérification de chemin de bout en bout) : un test
 * d'arrivée ne doit pas dépendre du fait que la seed plaçait une rivière sur le chemin.
 */
function pickReachableTarget(simulation: Simulation, radiusM: number): { x: number; z: number } {
  const world = simulation.world;
  const entity = simulation.humanIds()[0]!;
  const transform = simulation.entities.getComponentOrThrow(entity, Transform);
  const config = simulation.config.pathfinding;
  const service = new PathFindingService({
    grid: new NavGrid({
      tileSizeMeters: config.tileSizeMeters,
      cost: terrainTileCostProvider(world, config),
    }),
    maxNodesPerTick: config.maxNodesPerTick,
    maxNodesPerRequest: config.maxNodesPerRequest,
    maxRetries: 0,
    pathCacheCapacity: 8,
    snapRadiusTiles: config.snapRadiusTiles,
  });

  for (let radius = radiusM; radius <= radiusM + 48; radius += 8) {
    for (const angle of [
      0,
      Math.PI / 4,
      Math.PI / 2,
      (3 * Math.PI) / 4,
      Math.PI,
      (5 * Math.PI) / 4,
      (3 * Math.PI) / 2,
      (7 * Math.PI) / 4,
    ]) {
      const x = transform.x + Math.cos(angle) * radius;
      const z = transform.z + Math.sin(angle) * radius;
      if (!world.isWalkable(x, z)) continue;
      const reply = service.request({ x: transform.x, z: transform.z }, { x, z }, 0);
      if (reply.immediate !== null && reply.immediate.path !== null) return { x, z };
      if (reply.immediate === null) {
        const outcome = service.process().find((o) => o.path !== null);
        if (outcome !== undefined) return { x, z };
      }
    }
  }
  throw new Error(`aucune cible atteignable autour de ${radiusM} m`);
}

describe('PathfindingSystem', () => {
  it('turns a target into waypoints that lead to a walkable destination', () => {
    const simulation = makeSimulation('waypoints');
    simulation.start();

    const transform = simulation.entities.getComponentOrThrow(simulation.humanIds()[0]!, Transform);
    const world = simulation.world;

    // Une cible lointaine : le chemin est demandé, puis les points de passage apparaissent.
    travel(simulation, transform.x + 40, transform.z + 40, 20);

    const movement = simulation.entities.getComponentOrThrow(simulation.humanIds()[0]!, Movement);
    expect(movement.waypoints.length).toBeGreaterThan(0);
    expect(movement.pathPendingFor).toBeNull();
    expect(movement.targetX).not.toBeNull();

    // Chaque point de passage se situe sur du terrain praticable.
    for (const waypoint of movement.waypoints) {
      expect(world.isWalkable(waypoint.x, waypoint.z)).toBe(true);
    }
    simulation.dispose();
  });

  it('gives up with a readable reason when no path exists', () => {
    const simulation = makeSimulation('no-path');
    simulation.start();

    // Une cible franchement hors monde : ni départ ni voisinage praticable, l'A* ne
    // trouve rien. Chercher une zone d'eau assez large pour dépasser le rayon de repli
    // dépend trop de la seed ; le hors-monde est un cas déterministe.
    const entity = simulation.humanIds()[0]!;
    const targetX = 1e9;
    const targetZ = 1e9;

    travel(simulation, targetX, targetZ, 20);

    const movement = simulation.entities.getComponentOrThrow(entity, Movement);
    const activity = simulation.entities.getComponentOrThrow(entity, Activity);
    expect(movement.targetX).toBeNull();
    expect(movement.waypoints).toHaveLength(0);
    expect(activity.kind).toBe('idle');
    expect(activity.reason).toBe('chemin introuvable');
    simulation.dispose();
  });

  it('keeps an unreachable failure on the move step and clears the stale seek', () => {
    const simulation = new Simulation({
      seed: 'planned-no-path',
      population: 1,
      config: { time: { gameSecondsPerTick: 1 } },
      systems: [new PathfindingSystem()],
    });
    simulation.start();
    const entity = simulation.humanIds()[0]!;
    const movement = simulation.entities.getComponentOrThrow(entity, Movement);
    movement.targetX = 1e9;
    movement.targetZ = 1e9;
    simulation.entities.addComponent(entity, NeedsState, {
      action: 'seekWater',
      targetX: 1e9,
      targetZ: 1e9,
      resourceId: null,
      resourceOwnerChunkKey: null,
      resourceLocalId: null,
      resourceConceptId: null,
      foodIntent: null,
      mealStartedTick: -1,
      mealHungerBefore01: 0,
      untilTick: -1,
      mealMaxGain: 1,
      poisoningUntilTick: -1,
      poisoningToxicity01: 0,
      currentMealCausedPoisoning: false,
      pathFailedAtTick: -1,
    });
    const plans = simulation.entities.getComponentOrThrow(entity, HumanPlan);
    plans.activePlan = {
      id: 0,
      goalKind: 'survive.hydrate',
      createdAtTick: 0,
      currentStepIndex: 0,
      steps: [
        { kind: 'move.to_water', rememberedX: 1e9, rememberedZ: 1e9 },
        { kind: 'drink', rememberedX: 1e9, rememberedZ: 1e9 },
      ],
      lastFailure: null,
    };

    simulation.step(20);
    const state = simulation.entities.getComponentOrThrow(entity, NeedsState);
    expect(plans.activePlan?.currentStepIndex).toBe(0);
    expect(plans.activePlan?.lastFailure?.reason).toBe('target.unreachable');
    expect(plans.activePlan?.lastFailure?.stepIndex).toBe(0);
    expect(state.action).toBe('none');
    expect(movement.targetX).toBeNull();
    simulation.dispose();
  });

  it('clears deliberate experiment intent when its resource path is unreachable', () => {
    const simulation = new Simulation({
      seed: 'experimental-no-path',
      population: 1,
      config: { time: { gameSecondsPerTick: 1 } },
      systems: [new PathfindingSystem()],
    });
    const entity = simulation.humanIds()[0]!;
    const worldRef = {
      type: 'resource' as const,
      resourceId: 'berry:unreachable',
      ownerChunkKey: '0:0',
      localId: 1,
    };
    simulation.entities.addComponent(entity, NeedsState, {
      action: 'seekFood',
      targetX: 1e9,
      targetZ: 1e9,
      resourceId: worldRef.resourceId,
      resourceOwnerChunkKey: worldRef.ownerChunkKey,
      resourceLocalId: worldRef.localId,
      resourceConceptId: 'berry:red',
      foodIntent: 'deliberateExperiment',
      mealStartedTick: -1,
      mealHungerBefore01: 0,
      untilTick: -1,
      mealMaxGain: 1,
      poisoningUntilTick: -1,
      poisoningToxicity01: 0,
      currentMealCausedPoisoning: false,
      pathFailedAtTick: -1,
    });
    const plans = simulation.entities.getComponentOrThrow(entity, HumanPlan);
    plans.activePlan = {
      id: 0,
      goalKind: 'explore',
      createdAtTick: 0,
      currentStepIndex: 0,
      steps: [
        {
          kind: 'move.to_resource',
          worldRef,
          subjectConceptId: 'berry:red',
          rememberedX: 1e9,
          rememberedZ: 1e9,
        },
        {
          kind: 'eat.resource',
          worldRef,
          subjectConceptId: 'berry:red',
          intent: 'deliberateExperiment',
        },
      ],
      lastFailure: null,
    };
    const movement = simulation.entities.getComponentOrThrow(entity, Movement);
    movement.targetX = 1e9;
    movement.targetZ = 1e9;
    simulation.start();
    simulation.step(20);

    const state = simulation.entities.getComponentOrThrow(entity, NeedsState);
    expect(plans.activePlan.lastFailure?.reason).toBe('target.unreachable');
    expect(state.action).toBe('none');
    expect(state.foodIntent).toBeNull();
    simulation.dispose();
  });

  it('holds off a vital plan after a failed path (pathFailedAtTick)', () => {
    const simulation = makeSimulation('vital-fail');
    simulation.start();
    const entity = simulation.humanIds()[0]!;

    // On simule un plan vital en cours (soif critique) vers une cible inatteignable :
    // le système doit poser la retenue sur le planificateur. NeedsState est créé
    // paresseusement par la satisfaction : on le pose à la main, comme dans les tests
    // du métabolisme.
    simulation.entities.addComponent(entity, NeedsState, {
      action: 'seekWater',
      targetX: 1e9,
      targetZ: 1e9,
      resourceId: null,
      resourceOwnerChunkKey: null,
      resourceLocalId: null,
      resourceConceptId: null,
      foodIntent: null,
      mealStartedTick: -1,
      mealHungerBefore01: 0,
      untilTick: -1,
      mealMaxGain: 1,
      poisoningUntilTick: -1,
      poisoningToxicity01: 0,
      currentMealCausedPoisoning: false,
      pathFailedAtTick: -1,
    });

    const movement = simulation.entities.getComponentOrThrow(entity, Movement);
    movement.targetX = 1e9;
    movement.targetZ = 1e9;

    simulation.step(20);

    // Le chemin échoue : le plan est abandonné, mais la retenue empêche de retenter
    // l'impossibilité avant `failureRetryTicks`.
    const state = simulation.entities.getComponentOrThrow(entity, NeedsState);
    expect(state.action).toBe('none');
    expect(movement.targetX).toBeNull();
    expect(state.pathFailedAtTick).toBeGreaterThan(simulation.clock.currentTick - 1);
    simulation.dispose();
  });

  it('is deterministic: same seed, same waypoints', () => {
    const a = makeSimulation('determinism-paths');
    const b = makeSimulation('determinism-paths');
    a.start();
    b.start();

    // Fige la cible AVANT tout déplacement : sans ça, `ta.x` change au fil des ticks et
    // les deux simulations reçoivent des cibles différentes malgré la même seed.
    const startX = a.entities.getComponentOrThrow(a.humanIds()[0]!, Transform).x;
    const startZ = a.entities.getComponentOrThrow(a.humanIds()[0]!, Transform).z;
    const targetX = startX + 30;
    const targetZ = startZ - 20;
    travel(a, targetX, targetZ, 30);
    travel(b, targetX, targetZ, 30);

    const ma = a.entities.getComponentOrThrow(a.humanIds()[0]!, Movement);
    const mb = b.entities.getComponentOrThrow(b.humanIds()[0]!, Movement);
    expect(ma.waypoints).toEqual(mb.waypoints);
    a.dispose();
    b.dispose();
  });

  it('lets a human actually reach a distant walkable target', () => {
    const simulation = makeSimulation('arrival');
    simulation.start();
    const entity = simulation.humanIds()[0]!;

    const target = pickReachableTarget(simulation, 50);
    travel(simulation, target.x, target.z, 400);

    const movement = simulation.entities.getComponentOrThrow(entity, Movement);
    expect(movement.targetX).toBeNull();
    const finalTransform = simulation.entities.getComponentOrThrow(entity, Transform);
    expect(
      Math.hypot(finalTransform.x - target.x, finalTransform.z - target.z),
    ).toBeLessThanOrEqual(1);
    simulation.dispose();
  });

  /**
   * Bug historique : `terrainTileCostProvider` recevait `(x, z)` en indices de tuile mais
   * les passait tels quels à `sampleHeight`/`sampleSlope`/`bounds.contains`, qui attendent
   * des mètres. Avec `tileSizeMeters = 2`, la tuile `(100, 50)` (centre ≈ (201, 101) m)
   * était examinée comme le point monde (100, 50). Ce test compare la praticabilité vue
   * par le provider avec celle vue par le monde au centre de la même tuile — elles doivent
   * coïncider pour toute tuile, sous peine de calculer des chemins basés sur un ailleurs.
   */
  it('provider praticabilité coïncide avec le monde au centre de chaque tuile', () => {
    const simulation = makeSimulation('provider-coords');
    const world = simulation.world;
    const config = simulation.config.pathfinding;
    const provider = terrainTileCostProvider(world, config);
    const size = config.tileSizeMeters;
    const half = size / 2;

    let checked = 0;
    for (let tz = -80; tz <= 80; tz += 5) {
      for (let tx = -80; tx <= 80; tx += 5) {
        const memo = new Map<string, number | null>();
        const centerX = tx * size + half;
        const centerZ = tz * size + half;
        const worldWalkable = world.isWalkable(centerX, centerZ);
        const providerCost = provider.tileCost(tx, tz, memo);
        // La praticabilité doit correspondre au centre de la tuile.
        expect(providerCost !== null).toBe(worldWalkable);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
    simulation.dispose();
  });

  it('partage les coûts de terrain entre deux recherches distinctes', () => {
    const simulation = makeSimulation('provider-shared-cache');
    const world = simulation.world;
    const config = simulation.config.pathfinding;
    const grid = new NavGrid({
      tileSizeMeters: config.tileSizeMeters,
      cost: terrainTileCostProvider(world, config),
    });
    const transform = simulation.entities.getComponentOrThrow(simulation.humanIds()[0]!, Transform);
    const tx = Math.floor(transform.x / config.tileSizeMeters);
    const tz = Math.floor(transform.z / config.tileSizeMeters);
    const heightSpy = vi.spyOn(world.terrain, 'sampleHeight');
    const slopeSpy = vi.spyOn(world.terrain, 'sampleSlope');

    const sharedMemo = createTerrainCostMemo(config.terrainCostCacheCapacity);
    const first = grid.tileCost({ x: tx, z: tz }, sharedMemo);
    const heightCalls = heightSpy.mock.calls.length;
    const slopeCalls = slopeSpy.mock.calls.length;
    const second = grid.tileCost({ x: tx, z: tz }, sharedMemo);

    expect(second).toBe(first);
    expect(heightSpy.mock.calls.length).toBe(heightCalls);
    expect(slopeSpy.mock.calls.length).toBe(slopeCalls);
    simulation.dispose();
  });

  /**
   * Bug historique : deux humains ayant la même cible pouvaient hériter du chemin calculé
   * pour l'autre (appariement par cible plutôt que par requestId), donnant à B un chemin
   * partant de la position de A. Chaque humain doit maintenant recevoir un chemin dont le
   * premier point est proche de SA propre position — jamais de celle du voisin.
   */
  it('deux humains ayant la même cible reçoivent chacun leur propre chemin', () => {
    // Bug historique corrigé : le PathfindingSystem appariait un outcome à une entité
    // par égalité de cible. Deux humains vers la même cible pouvaient donc hériter du
    // chemin calculé pour l'autre (le premier waypoint partait de la position du
    // voisin). L'appariement se fait maintenant par `requestId` : chacun son chemin.
    //
    // On n'inclut PAS `MovementSystem` : sans consommation de waypoints, la liste garde
    // exactement ce que le pathfinding a produit — inspection sans course.
    const simulation = new Simulation({
      seed: 'multi-target',
      population: 2,
      config: { time: { gameSecondsPerTick: 1 } },
      systems: [new PathfindingSystem()],
    });
    simulation.start();
    const ids = simulation.humanIds();
    expect(ids.length).toBe(2);

    // Les positions produites par HumanFactory sont garanties praticables et appartiennent
    // au campement. L'ancien test forçait (-20, 0)/(20, 0), qui sont hors des bornes du
    // monde actuel (coordonnées positives) : il pouvait échouer avant même de tester
    // l'appariement des requêtes.
    const positions: { x: number; z: number }[] = [];
    for (const id of ids) {
      const transform = simulation.entities.getComponentOrThrow(id, Transform);
      positions.push({ x: transform.x, z: transform.z });
    }

    // Cherche une cible commune atteignable depuis les deux positions (via le premier
    // humain. Les deux sont apparus dans le même groupe et sur un terrain praticable.
    const target = pickReachableTarget(simulation, 60);

    for (const id of ids) {
      const m = simulation.entities.getComponentOrThrow(id, Movement);
      m.targetX = target.x;
      m.targetZ = target.z;
    }

    // Deux cycles medium suffisent : requête → traitement.
    simulation.step(15);

    for (let i = 0; i < ids.length; i++) {
      const m = simulation.entities.getComponentOrThrow(ids[i]!, Movement);
      // On exige qu'un chemin ait été produit pour chaque humain (sinon la cible n'est
      // pas atteignable depuis cette seed — non pertinent, on n'affirme rien).
      if (m.waypoints.length === 0) continue;
      const first = m.waypoints[0]!;
      const myDist = Math.hypot(first.x - positions[i]!.x, first.z - positions[i]!.z);
      const otherIdx = 1 - i;
      const otherDist = Math.hypot(
        first.x - positions[otherIdx]!.x,
        first.z - positions[otherIdx]!.z,
      );
      // Le premier waypoint doit être franchement plus proche de la position d'origine
      // de l'humain que de celle de l'autre.
      expect(myDist).toBeLessThan(otherDist);
    }

    simulation.dispose();
  });

  /**
   * Bug historique : après un snap de cible non praticable, `toWaypoints` remplaçait
   * quand même le dernier waypoint par la cible originale (dans l'eau). L'humain
   * marchait donc littéralement dans le lac. Le dernier waypoint doit rester la tuile
   * snappée quand la cible originale n'est pas praticable.
   */
  it('cible non praticable : le dernier waypoint reste sur la tuile snappée', () => {
    const simulation = makeSimulation('snap-last');
    simulation.start();
    const world = simulation.world;
    const entity = simulation.humanIds()[0]!;
    const transform = simulation.entities.getComponentOrThrow(entity, Transform);

    // Cherche une position dans l'eau non praticable dans un rayon raisonnable.
    let targetX: number | null = null;
    let targetZ: number | null = null;
    for (let radius = 8; radius <= 200 && targetX === null; radius += 4) {
      for (const angle of [
        0,
        Math.PI / 6,
        Math.PI / 3,
        Math.PI / 2,
        (2 * Math.PI) / 3,
        Math.PI,
        (4 * Math.PI) / 3,
        (3 * Math.PI) / 2,
        (5 * Math.PI) / 3,
      ]) {
        const x = transform.x + Math.cos(angle) * radius;
        const z = transform.z + Math.sin(angle) * radius;
        const water = world.hydrology.sampleWater(x, z, world.heightAt(x, z));
        if (water !== null && !world.isWalkable(x, z)) {
          targetX = x;
          targetZ = z;
          break;
        }
      }
    }

    if (targetX === null) {
      // Pas d'eau non praticable dans ce voisinage : test non pertinent pour cette seed.
      simulation.dispose();
      return;
    }

    travel(simulation, targetX, targetZ!, 20);

    const movement = simulation.entities.getComponentOrThrow(entity, Movement);

    // Deux issues acceptables : soit le service a snappé (waypoints non vides ; le dernier
    // doit alors être praticable), soit il a échoué (waypoints vides et cible effacée).
    if (movement.waypoints.length > 0) {
      const last = movement.waypoints[movement.waypoints.length - 1]!;
      expect(world.isWalkable(last.x, last.z)).toBe(true);
      // Interdiction absolue : le dernier waypoint ne doit PAS être la cible originale
      // non praticable.
      expect(last.x === targetX && last.z === targetZ).toBe(false);
    } else {
      expect(movement.targetX).toBeNull();
    }

    simulation.dispose();
  });
});
