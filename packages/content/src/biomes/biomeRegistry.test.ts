import { describe, expect, it } from 'vitest';
import { BiomeRegistry } from './biomeRegistry.js';
import { DEFAULT_BIOMES } from './defaultBiomes.js';
import type { BiomeScoreInput } from './biomeDefinition.js';
import { rangeMembership } from '../range.js';

function registry(): BiomeRegistry {
  const instance = new BiomeRegistry();
  instance.registerAll(DEFAULT_BIOMES);
  return instance;
}

const NEUTRAL: BiomeScoreInput = {
  temperature: 0.5,
  moisture: 0.4,
  elevation: 0.45,
  slope: 0.1,
  rockiness: 0.2,
  waterProximity: 0.1,
};

describe('rangeMembership', () => {
  it('vaut 1 dans la plage et 0 au-delà de la tolérance', () => {
    const range = { min: 0.4, max: 0.6, tolerance: 0.2 };
    expect(rangeMembership(0.5, range)).toBe(1);
    expect(rangeMembership(0.4, range)).toBe(1);
    expect(rangeMembership(0.7, range)).toBeCloseTo(0.5, 6);
    expect(rangeMembership(0.85, range)).toBe(0);
    expect(rangeMembership(0.1, range)).toBe(0);
  });

  it('décroît continûment : c’est ce qui évite les frontières nettes', () => {
    const range = { min: 0.5, max: 0.5, tolerance: 0.25 };
    let previous = 1;
    for (let value = 0.5; value <= 0.8; value += 0.02) {
      const membership = rangeMembership(value, range);
      expect(membership).toBeLessThanOrEqual(previous + 1e-9);
      previous = membership;
    }
  });
});

describe('BiomeRegistry', () => {
  it('attribue toujours un biome, même à des conditions extrêmes', () => {
    const instance = registry();
    for (const value of [0, 0.5, 1]) {
      const selection = instance.select({
        temperature: value,
        moisture: value,
        elevation: value,
        slope: value,
        rockiness: value,
        waterProximity: value,
      });
      expect(selection.definition).toBeDefined();
      expect(selection.index).toBeGreaterThanOrEqual(0);
    }
  });

  it('normalise les poids du mélange', () => {
    const selection = registry().select(NEUTRAL);
    const total = selection.blend.reduce((sum, entry) => sum + entry.weight, 0);
    expect(total).toBeCloseTo(1, 8);
    expect(selection.blend.length).toBeGreaterThan(0);
    expect(selection.blend.length).toBeLessThanOrEqual(3);
  });

  it('classe le dominant en tête du mélange', () => {
    const selection = registry().select(NEUTRAL);
    const best = selection.blend[0];
    expect(best).toBeDefined();
    for (const entry of selection.blend) {
      expect(entry.score).toBeLessThanOrEqual(best!.score + 1e-12);
    }
  });

  it('choisit la zone rocheuse sur une pente forte et sèche', () => {
    const selection = registry().select({
      temperature: 0.4,
      moisture: 0.2,
      elevation: 0.8,
      slope: 0.7,
      rockiness: 0.85,
      waterProximity: 0,
    });
    expect(selection.definition.id).toBe('rocky');
  });

  it('choisit la forêt en terrain humide, plat et tempéré', () => {
    const selection = registry().select({
      temperature: 0.55,
      moisture: 0.8,
      elevation: 0.45,
      slope: 0.08,
      rockiness: 0.1,
      waterProximity: 0.2,
    });
    expect(selection.definition.id).toBe('forest');
  });

  it('choisit la berge au ras de l’eau', () => {
    const selection = registry().select({
      temperature: 0.55,
      moisture: 0.7,
      elevation: 0.35,
      slope: 0.05,
      rockiness: 0.1,
      waterProximity: 0.97,
    });
    expect(selection.definition.id).toBe('riverbank');
  });

  it('varie de façon continue le long d’un gradient d’humidité', () => {
    // Le mélange doit évoluer progressivement : c'est la garantie visuelle contre les
    // frontières en escalier.
    const instance = registry();
    let previousWeights: number[] | null = null;
    for (let moisture = 0.2; moisture <= 0.95; moisture += 0.05) {
      const selection = instance.select({ ...NEUTRAL, moisture });
      const weights = instance
        .all()
        .map(
          (biome) => selection.blend.find((entry) => entry.definition.id === biome.id)?.weight ?? 0,
        );
      if (previousWeights) {
        const jump = Math.max(...weights.map((w, i) => Math.abs(w - (previousWeights?.[i] ?? 0))));
        expect(jump).toBeLessThan(0.75);
      }
      previousWeights = weights;
    }
  });

  it('refuse deux définitions de même identifiant', () => {
    const instance = registry();
    expect(() => instance.register(DEFAULT_BIOMES[0]!)).toThrow(/duplicate/);
  });

  it('expose un index stable par identifiant', () => {
    const instance = registry();
    for (let index = 0; index < instance.size; index++) {
      const biome = instance.at(index);
      expect(biome).toBeDefined();
      expect(instance.indexOf(biome!.id)).toBe(index);
    }
    expect(instance.indexOf('inconnu')).toBe(-1);
  });
});
