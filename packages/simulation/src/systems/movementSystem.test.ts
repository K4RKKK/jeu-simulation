import type { EntityId } from '@civ/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Activity, Movement, Transform } from '../components/index.js';
import { createSimulationConfig, type SimulationConfig } from '../config/simulationConfig.js';
import { SimulationClock } from '../core/clock.js';
import { EntityManager } from '../core/entityManager.js';
import { EventBus } from '../core/eventBus.js';
import { WorldRng } from '../core/rng.js';
import type { SystemUpdateContext } from '../core/system.js';
import { World } from '../world/world.js';
import { MovementSystem } from './movementSystem.js';

/**
 * Ce fichier illustre la règle 8 : un système se teste sans simulation complète, en lui
 * fabriquant un contexte à la main. Le `MovementSystem` consomme des points de passage
 * produits en temps normal par le `PathfindingSystem` : ici ils sont posés à la main.
 */
describe('MovementSystem', () => {
  let config: SimulationConfig;
  let entities: EntityManager;
  let events: EventBus;
  let clock: SimulationClock;
  let world: World;
  let system: MovementSystem;

  beforeEach(() => {
    config = createSimulationConfig({ time: { gameSecondsPerTick: 1 } });
    entities = new EntityManager();
    events = new EventBus();
    clock = new SimulationClock(config.time);
    // Monde minuscule : ce test porte sur le déplacement, pas sur la géographie, et une
    // passe hydrologique complète le ralentirait sans rien vérifier de plus.
    world = new World({
      worldId: 'test',
      seed: 'test',
      clock,
      config,
      generation: { layout: { sizeChunks: 4 } },
    });
    system = new MovementSystem();
  });

  function context(deltaGameSeconds = 1): SystemUpdateContext {
    return {
      world,
      entities,
      events,
      rng: new WorldRng('test'),
      clock,
      config,
      tick: clock.currentTick,
      deltaGameSeconds,
    };
  }

  function makeWalker(waypoints: { x: number; z: number }[], speed = 1): EntityId {
    const entity = entities.createEntity();
    entities.addComponent(entity, Transform, { x: 0, y: world.heightAt(0, 0), z: 0, yaw: 0 });
    entities.addComponent(entity, Movement, {
      walkSpeedMps: speed,
      currentSpeedMps: 0,
      targetX: waypoints.length > 0 ? waypoints[waypoints.length - 1]!.x : null,
      targetZ: waypoints.length > 0 ? waypoints[waypoints.length - 1]!.z : null,
      waypoints: [...waypoints],
      pathPendingFor: null,
      pathRequestId: null,
      lastTrailSampleX: null,
      lastTrailSampleZ: null,
    });
    entities.addComponent(entity, Activity, {
      kind: waypoints.length > 0 ? 'walking' : 'idle',
      reason: 'test',
      startedAtTick: 0,
    });
    return entity;
  }

  it('moves an entity along its waypoints at its own speed', () => {
    const entity = makeWalker([{ x: 0, z: 10 }], 2);

    system.update(context(1));

    const transform = entities.getComponentOrThrow(entity, Transform);
    expect(transform.z).toBeCloseTo(2, 6);
    expect(transform.x).toBeCloseTo(0, 6);
    expect(entities.getComponentOrThrow(entity, Movement).currentSpeedMps).toBeCloseTo(2, 6);
  });

  it('scales the step with the elapsed game time, not with the tick count', () => {
    const entity = makeWalker([{ x: 0, z: 100 }], 1);
    system.update(context(5));
    expect(entities.getComponentOrThrow(entity, Transform).z).toBeCloseTo(5, 6);
  });

  it('snaps to the last waypoint and clears the target on arrival', () => {
    const entity = makeWalker([{ x: 3, z: 4 }], 100);
    const completed = vi.fn();
    events.on('ActionCompleted', completed);

    system.update(context(1));

    const transform = entities.getComponentOrThrow(entity, Transform);
    const movement = entities.getComponentOrThrow(entity, Movement);
    const activity = entities.getComponentOrThrow(entity, Activity);

    expect(transform.x).toBe(3);
    expect(transform.z).toBe(4);
    expect(movement.targetX).toBeNull();
    expect(movement.targetZ).toBeNull();
    expect(movement.waypoints).toHaveLength(0);
    expect(movement.currentSpeedMps).toBe(0);
    expect(activity.kind).toBe('idle');
    expect(completed).toHaveBeenCalledWith({ tick: 0, entity, action: 'Move' });
  });

  it('consumes each waypoint and carries the remaining step to the next one', () => {
    // Trois points alignés, espacés de 10 m : un pas de 25 m doit atteindre le point
    // médian ET entamer le dernier segment dans le même tick.
    const entity = makeWalker(
      [
        { x: 0, z: 10 },
        { x: 0, z: 20 },
        { x: 0, z: 30 },
      ],
      25,
    );
    system.update(context(1));

    const transform = entities.getComponentOrThrow(entity, Transform);
    expect(transform.z).toBeCloseTo(25, 6);
    expect(entities.getComponentOrThrow(entity, Movement).waypoints).toHaveLength(1);
  });

  it('never overshoots its final waypoint', () => {
    const entity = makeWalker([{ x: 0, z: 1 }], 1000);
    system.update(context(1));
    expect(entities.getComponentOrThrow(entity, Transform).z).toBe(1);
  });

  it('leaves entities without waypoints untouched', () => {
    const entity = makeWalker([]);
    system.update(context(1));

    const transform = entities.getComponentOrThrow(entity, Transform);
    expect(transform.x).toBe(0);
    expect(transform.z).toBe(0);
    expect(entities.getComponentOrThrow(entity, Movement).currentSpeedMps).toBe(0);
  });

  it('arrives without a path when the target is already underfoot', () => {
    // Cible posée à 0,3 m (dans le rayon d'arrivée) sans chemin : l'arrivée suffit.
    const entity = makeWalker([], 2);
    const movement = entities.getComponentOrThrow(entity, Movement);
    movement.targetX = 0.3;
    movement.targetZ = 0;

    system.update(context(1));

    const transform = entities.getComponentOrThrow(entity, Transform);
    const activity = entities.getComponentOrThrow(entity, Activity);
    expect(transform.x).toBe(0.3);
    expect(movement.targetX).toBeNull();
    expect(activity.kind).toBe('idle');
  });

  it('waits motionless while a target is set but no path is ready', () => {
    const entity = makeWalker([], 2);
    const movement = entities.getComponentOrThrow(entity, Movement);
    movement.targetX = 40;
    movement.targetZ = 0;

    system.update(context(1));

    const transform = entities.getComponentOrThrow(entity, Transform);
    expect(transform.x).toBe(0);
    expect(movement.currentSpeedMps).toBe(0);
    expect(movement.targetX).toBe(40); // le chemin arrivera plus tard
  });

  it('turns the body progressively rather than instantly', () => {
    const entity = makeWalker([{ x: -10, z: 0 }], 1);
    const transform = entities.getComponentOrThrow(entity, Transform);
    transform.yaw = 0; // regarde vers +Z, la cible est à -X

    system.update(context(0.1));

    const maxTurn = config.movement.turnRateRadPerSecond * 0.1;
    expect(Math.abs(transform.yaw)).toBeLessThanOrEqual(maxTurn + 1e-9);
    expect(Math.abs(transform.yaw)).toBeGreaterThan(0);
  });

  it('does nothing when no game time has elapsed', () => {
    const entity = makeWalker([{ x: 0, z: 10 }], 2);
    system.update(context(0));
    expect(entities.getComponentOrThrow(entity, Transform).z).toBe(0);
  });

  /**
   * Bug de performance corrigé : `recordFootTraffic` était appelé à CHAQUE tick, même
   * pour un déplacement de quelques centimètres — un coût significatif à plusieurs
   * centaines d'humains en mouvement continu. On vérifie ici que de nombreux petits
   * pas sous le seuil de `trailSampleThresholdMeters` ne déclenchent PAS
   * d'échantillonnage à chaque tick : la révision du sentier ne doit avancer que
   * lorsque le déplacement CUMULÉ franchit le seuil, jamais à chaque appel.
   */
  it('throttles trail sampling: many tiny steps do not each trigger a sample', () => {
    // walkSpeedMps × dt = 0.05 m/tick — bien en-dessous du seuil (0,5 m par défaut).
    const entity = makeWalker([{ x: 0, z: 100 }], 0.05);
    const movement = entities.getComponentOrThrow(entity, Movement);

    let sampleUpdates = 0;
    let lastSampleZ: number | null = null;
    for (let i = 0; i < 20; i++) {
      system.update(context(1)); // dt=1s → 0.05 m ce tick
      if (movement.lastTrailSampleZ !== lastSampleZ) sampleUpdates++;
      lastSampleZ = movement.lastTrailSampleZ;
    }

    // 20 pas × 0,05 m = 1 m parcouru : au plus deux échantillons (seuil 0,5 m), jamais 20 —
    // c'est exactement le gaspillage corrigé (un échantillon par tick auparavant).
    expect(sampleUpdates).toBeLessThanOrEqual(3);
    expect(sampleUpdates).toBeGreaterThan(0); // le sentier progresse quand même
  });

  it('samples the trail once real displacement crosses the threshold', () => {
    const entity = makeWalker([{ x: 0, z: 100 }], 1); // 1 m/tick à dt=1s
    const movement = entities.getComponentOrThrow(entity, Movement);
    expect(movement.lastTrailSampleX).toBeNull();

    system.update(context(1)); // avance de 1 m ≥ seuil 0,5 m

    expect(movement.lastTrailSampleX).not.toBeNull();
    expect(movement.lastTrailSampleZ).toBeCloseTo(1, 6);
  });
});
