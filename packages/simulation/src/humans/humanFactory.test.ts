import { describe, expect, it } from 'vitest';
import { Human, HumanSkills, Movement, Personality, Transform } from '../components/index.js';
import { Simulation } from '../simulation.js';

function population(seed: string, count: number): Simulation {
  return new Simulation({ seed, population: count });
}

describe('HumanFactory', () => {
  it('creates individual empty procedural skills without blocking novice actions', () => {
    const simulation = population('empty-skills', 3);
    for (const entity of simulation.humanIds()) {
      expect(simulation.entities.getComponentOrThrow(entity, HumanSkills).skills).toEqual([]);
    }
    simulation.dispose();
  });

  it('produces physically coherent individuals', () => {
    const simulation = population('coherence', 40);
    const config = simulation.config.humans;

    for (const entity of simulation.humanIds()) {
      const human = simulation.entities.getComponentOrThrow(entity, Human);
      const movement = simulation.entities.getComponentOrThrow(entity, Movement);

      expect(human.ageYears).toBeGreaterThanOrEqual(config.minAgeYears);
      expect(human.ageYears).toBeLessThanOrEqual(config.maxAgeYears);
      expect(human.heightM).toBeGreaterThan(0.6);
      expect(human.heightM).toBeLessThan(2.1);
      expect(human.massKg).toBeGreaterThan(10);
      expect(human.massKg).toBeLessThan(140);
      expect(movement.walkSpeedMps).toBeGreaterThan(0.3);
      expect(movement.walkSpeedMps).toBeLessThan(2.5);
    }
    simulation.dispose();
  });

  it('derives mass from height rather than drawing it independently', () => {
    const simulation = population('bmi', 40);
    for (const entity of simulation.humanIds()) {
      const human = simulation.entities.getComponentOrThrow(entity, Human);
      const bmi = human.massKg / (human.heightM * human.heightM);
      expect(bmi).toBeGreaterThanOrEqual(14.5);
      expect(bmi).toBeLessThanOrEqual(30.5);
    }
    simulation.dispose();
  });

  it('makes children shorter and slower than adults', () => {
    const simulation = population('growth', 120);
    const byAge = simulation.humanIds().map((entity) => ({
      human: simulation.entities.getComponentOrThrow(entity, Human),
      movement: simulation.entities.getComponentOrThrow(entity, Movement),
    }));

    const children = byAge.filter((individual) => individual.human.ageYears < 12);
    const adults = byAge.filter((individual) => individual.human.ageYears >= 25);
    expect(children.length).toBeGreaterThan(0);
    expect(adults.length).toBeGreaterThan(0);

    const average = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
    expect(average(children.map((c) => c.human.heightM))).toBeLessThan(
      average(adults.map((a) => a.human.heightM)),
    );
    expect(average(children.map((c) => c.movement.walkSpeedMps))).toBeLessThan(
      average(adults.map((a) => a.movement.walkSpeedMps)),
    );
    simulation.dispose();
  });

  it('gives every trait a value inside [0, 1]', () => {
    const simulation = population('personality', 40);
    for (const entity of simulation.humanIds()) {
      const personality = simulation.entities.getComponentOrThrow(entity, Personality);
      for (const value of Object.values(personality)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    simulation.dispose();
  });

  it('varies personalities between individuals', () => {
    const simulation = population('variety', 30);
    const curiosities = simulation
      .humanIds()
      .map((entity) => simulation.entities.getComponentOrThrow(entity, Personality).curiosity);

    expect(new Set(curiosities).size).toBeGreaterThan(5);
    simulation.dispose();
  });

  it('spawns the group as a camp rather than scattering it over the world', () => {
    const simulation = population('camp', 15);
    const positions = simulation
      .humanIds()
      .map((entity) => simulation.entities.getComponentOrThrow(entity, Transform));

    const centerX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
    const centerZ = positions.reduce((sum, p) => sum + p.z, 0) / positions.length;
    const radius = simulation.config.humans.spawnClusterRadiusMeters;

    for (const position of positions) {
      expect(Math.hypot(position.x - centerX, position.z - centerZ)).toBeLessThanOrEqual(
        radius * 2,
      );
    }
    simulation.dispose();
  });

  it('generates the same population for the same seed', () => {
    const describe_ = (simulation: Simulation): unknown[] =>
      simulation.humanIds().map((entity) => simulation.entities.getComponentOrThrow(entity, Human));

    const a = population('same-seed', 15);
    const b = population('same-seed', 15);
    expect(describe_(a)).toEqual(describe_(b));

    const c = population('other-seed', 15);
    expect(describe_(c)).not.toEqual(describe_(a));

    a.dispose();
    b.dispose();
    c.dispose();
  });

  it('gives individuals readable and mostly distinct names', () => {
    const simulation = population('names', 20);
    const names = simulation
      .humanIds()
      .map((entity) => simulation.entities.getComponentOrThrow(entity, Human).name);

    for (const name of names) {
      expect(name).toMatch(/^[A-Z][a-z]+$/);
    }
    expect(new Set(names).size).toBeGreaterThanOrEqual(names.length - 2);
    simulation.dispose();
  });
});
