import { describe, expect, it } from 'vitest';
import { Activity, Needs, NeedsState, Transform } from '../../components/index.js';
import { Simulation } from '../../simulation.js';
import { MetabolismSystem } from './metabolismSystem.js';

/**
 * Le métabolisme est de la physiologie pure : les mêmes entrées produisent les mêmes
 * sorties, et chaque taux est vérifié contre son ordre de grandeur configuré.
 */
function makeSimulation(seed: string): Simulation {
  return new Simulation({
    seed,
    population: 1,
    config: { time: { gameSecondsPerTick: 1 } },
    systems: [new MetabolismSystem()],
  });
}

function needsOf(simulation: Simulation): {
  hydration: number;
  hunger: number;
  energy: number;
} {
  const entity = simulation.humanIds()[0]!;
  return { ...simulation.entities.getComponentOrThrow(entity, Needs) };
}

describe('MetabolismSystem', () => {
  it('drains hydration, hunger and energy while idle', () => {
    const simulation = makeSimulation('drain');
    simulation.start();
    const before = needsOf(simulation);
    simulation.step(1000); // ~17 minutes de jeu

    const after = needsOf(simulation);
    expect(after.hydration).toBeLessThan(before.hydration);
    expect(after.hunger).toBeLessThan(before.hunger);
    expect(after.energy).toBeLessThan(before.energy);
    simulation.dispose();
  });

  it('drains energy faster while walking than while resting', () => {
    const walking = makeSimulation('walk');
    walking.start();
    walking.entities.getComponentOrThrow(walking.humanIds()[0]!, Activity).kind = 'walking';

    const resting = makeSimulation('rest');
    resting.start();
    resting.entities.getComponentOrThrow(resting.humanIds()[0]!, Activity).kind = 'rest';

    walking.step(600);
    resting.step(600);
    expect(needsOf(walking).energy).toBeLessThan(needsOf(resting).energy);
    walking.dispose();
    resting.dispose();
  });

  it('recharges hydration while drinking, clamped to 1', () => {
    const simulation = makeSimulation('drink');
    simulation.start();
    const entity = simulation.humanIds()[0]!;
    const needs = simulation.entities.getComponentOrThrow(entity, Needs);
    needs.hydration = 0.4;
    simulation.entities.getComponentOrThrow(entity, Activity).kind = 'drink';

    simulation.step(300); // ~5 minutes de jeu à boire
    expect(simulation.entities.getComponentOrThrow(entity, Needs).hydration).toBeGreaterThan(0.9);
    simulation.dispose();
  });

  it('recharges hunger while eating', () => {
    const simulation = makeSimulation('eat');
    simulation.start();
    const entity = simulation.humanIds()[0]!;
    const needs = simulation.entities.getComponentOrThrow(entity, Needs);
    needs.hunger = 0.3;
    simulation.entities.getComponentOrThrow(entity, Activity).kind = 'eat';

    simulation.step(300);
    expect(simulation.entities.getComponentOrThrow(entity, Needs).hunger).toBeGreaterThan(0.8);
    simulation.dispose();
  });

  it('recovers energy while resting and while sleeping at night', () => {
    const simulation = makeSimulation('recover');
    simulation.start();
    const entity = simulation.humanIds()[0]!;
    simulation.entities.getComponentOrThrow(entity, Needs).energy = 0.3;
    simulation.entities.getComponentOrThrow(entity, Activity).kind = 'rest';
    simulation.step(3600); // 1 h de repos : ~25 % d'énergie récupérée

    expect(simulation.entities.getComponentOrThrow(entity, Needs).energy).toBeGreaterThan(0.5);
    simulation.dispose();
  });

  it('keeps needs inside [0, 1] over a full day', () => {
    const simulation = makeSimulation('bounds');
    simulation.start();
    simulation.step(86400);

    const needs = needsOf(simulation);
    expect(needs.hydration).toBeGreaterThanOrEqual(0);
    expect(needs.hydration).toBeLessThanOrEqual(1);
    expect(needs.hunger).toBeGreaterThanOrEqual(0);
    expect(needs.hunger).toBeLessThanOrEqual(1);
    expect(needs.energy).toBeGreaterThanOrEqual(0);
    expect(needs.energy).toBeLessThanOrEqual(1);
    simulation.dispose();
  });

  it('is deterministic: the same seed drains identically', () => {
    const a = makeSimulation('determinism');
    const b = makeSimulation('determinism');
    a.start();
    b.start();
    a.step(5000);
    b.step(5000);
    expect(needsOf(a)).toEqual(needsOf(b));
    a.dispose();
    b.dispose();
  });

  it('suffers dehydration after ingesting toxic food', () => {
    const simulation = makeSimulation('poison');
    simulation.start();
    const entity = simulation.humanIds()[0]!;
    // Pas de NeedSatisfactionSystem ici : le poison est posé à la main, comme le ferait
    // une ingestion réelle (toxicité maximale du catalogue, durée de symptômes complète).
    simulation.entities.addComponent(entity, NeedsState, {
      action: 'none',
      targetX: null,
      targetZ: null,
      resourceId: null,
      resourceOwnerChunkKey: null,
      resourceLocalId: null,
      untilTick: -1,
      mealMaxGain: 1,
      poisoningUntilTick: simulation.clock.currentTick + 7200,
      poisoningToxicity01: 0.95,
      pathFailedAtTick: -1,
    });

    const before = needsOf(simulation);
    simulation.step(7200); // toute la durée des symptômes

    const after = needsOf(simulation);
    // 0.95 / 18000 × 7200 s ≈ 0.38 d'hydratation perdue par le seul poison.
    expect(after.hydration).toBeLessThan(before.hydration - 0.3);
    simulation.dispose();
  });

  it('drains hydration faster in a hot place than in a cold one', () => {
    const simulation = makeSimulation('heat');
    simulation.start();
    const entity = simulation.humanIds()[0]!;
    const transform = simulation.entities.getComponentOrThrow(entity, Transform);
    const sampler = simulation.world.terrain;

    // Deux positions comparables : la plus chaude et la plus froide du voisinage.
    let hot = { x: transform.x, z: transform.z, t: -1 };
    let cold = { x: transform.x, z: transform.z, t: 2 };
    for (let dx = -60; dx <= 60; dx += 12) {
      for (let dz = -60; dz <= 60; dz += 12) {
        const t = sampler.sampleTemperature(transform.x + dx, transform.z + dz);
        if (t > hot.t) hot = { x: transform.x + dx, z: transform.z + dz, t };
        if (t < cold.t) cold = { x: transform.x + dx, z: transform.z + dz, t };
      }
    }
    if (hot.t - cold.t < 0.2) {
      simulation.dispose();
      return; // monde trop uniforme : rien à prouver ici
    }

    const hotSimulation = makeSimulation('heat-hot');
    const coldSimulation = makeSimulation('heat-cold');
    hotSimulation.start();
    coldSimulation.start();
    for (const [simulation, spot] of [
      [hotSimulation, hot],
      [coldSimulation, cold],
    ] as const) {
      const target = simulation.entities.getComponentOrThrow(simulation.humanIds()[0]!, Transform);
      target.x = spot.x;
      target.z = spot.z;
    }
    hotSimulation.step(20000);
    coldSimulation.step(20000);
    expect(needsOf(hotSimulation).hydration).toBeLessThan(needsOf(coldSimulation).hydration);
    hotSimulation.dispose();
    coldSimulation.dispose();
    simulation.dispose();
  });
});