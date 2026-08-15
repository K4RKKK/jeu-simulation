import { describe, expect, it } from 'vitest';
import { ProceduralGenerator } from '../core/proceduralGenerator.js';

const generator = new ProceduralGenerator({
  seed: 'sampler',
  overrides: { layout: { sizeChunks: 8 } },
});
const sampler = generator.sampler;
const bounds = generator.bounds;

function* scan(step: number): Generator<{ x: number; z: number }> {
  for (let x = -bounds.halfSizeMeters + 3; x < bounds.halfSizeMeters; x += step) {
    for (let z = -bounds.halfSizeMeters + 3; z < bounds.halfSizeMeters; z += step) {
      yield { x, z };
    }
  }
}

describe('TerrainSampler', () => {
  it('rend tous les champs normalisés dans [0, 1]', () => {
    for (const { x, z } of scan(19)) {
      const sample = sampler.sample(x, z);
      for (const [name, value] of Object.entries({
        elevation: sample.elevation01,
        slope: sample.slope01,
        temperature: sample.temperature01,
        moisture: sample.moisture01,
        fertility: sample.fertility01,
        rockiness: sample.rockiness01,
        vegetation: sample.vegetation01,
        waterProximity: sample.waterProximity01,
      })) {
        expect(Number.isFinite(value), `${name} non fini`).toBe(true);
        expect(value, `${name} hors bornes`).toBeGreaterThanOrEqual(0);
        expect(value, `${name} hors bornes`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('garde l’altitude dans la plage configurée', () => {
    const { minMeters, maxMeters } = generator.config.elevation;
    for (const { x, z } of scan(17)) {
      const height = sampler.sampleHeight(x, z);
      expect(height).toBeGreaterThanOrEqual(minMeters - 1e-6);
      expect(height).toBeLessThanOrEqual(maxMeters + 1e-6);
    }
  });

  it('attribue toujours un biome', () => {
    for (const { x, z } of scan(23)) {
      const sample = sampler.sample(x, z);
      expect(sample.biome.definition.id.length).toBeGreaterThan(0);
      expect(sample.biome.blend.length).toBeGreaterThan(0);
      const total = sample.biome.blend.reduce((sum, entry) => sum + entry.weight, 0);
      expect(total).toBeCloseTo(1, 5);
    }
  });

  it('est une fonction pure de la position', () => {
    for (const { x, z } of scan(41)) {
      expect(sampler.sampleHeight(x, z)).toBe(sampler.sampleHeight(x, z));
      expect(sampler.sample(x, z).moisture01).toBe(sampler.sample(x, z).moisture01);
    }
  });

  it('est continu : pas de marche brutale entre deux points voisins', () => {
    for (const { x, z } of scan(13)) {
      const a = sampler.sampleHeight(x, z);
      const b = sampler.sampleHeight(x + 0.25, z);
      // 25 cm de déplacement ne peut pas faire varier l'altitude de plus d'un mètre :
      // au-delà, c'est une falaise verticale, donc une discontinuité.
      expect(Math.abs(a - b)).toBeLessThan(1);
    }
  });

  it('donne les mêmes champs par les accès unitaires et par sample()', () => {
    for (const { x, z } of scan(53)) {
      const full = sampler.sample(x, z);
      expect(sampler.sampleElevation(x, z)).toBeCloseTo(full.elevation01, 10);
      expect(sampler.sampleSlope(x, z)).toBeCloseTo(full.slope01, 10);
      expect(sampler.sampleTemperature(x, z)).toBeCloseTo(full.temperature01, 10);
      expect(sampler.sampleMoisture(x, z)).toBeCloseTo(full.moisture01, 10);
      expect(sampler.sampleFertility(x, z)).toBeCloseTo(full.fertility01, 10);
    }
  });

  it('rend les pentes fortes impraticables', () => {
    let steepChecked = 0;
    for (const { x, z } of scan(7)) {
      const sample = sampler.sample(x, z);
      if (sample.slope01 > generator.config.walkability.maxSlope01) {
        expect(sample.walkable).toBe(false);
        steepChecked++;
      }
    }
    expect(steepChecked).toBeGreaterThan(0);
  });

  it('humidifie les abords de l’eau', () => {
    const near: number[] = [];
    const far: number[] = [];
    for (const { x, z } of scan(9)) {
      const sample = sampler.sample(x, z);
      if (sample.water) continue;
      if (sample.distanceToWaterM < 15) near.push(sample.moisture01);
      else if (sample.distanceToWaterM > 120) far.push(sample.moisture01);
    }
    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);

    const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean(near)).toBeGreaterThan(mean(far));
  });
});

describe('findValidSpawnPosition', () => {
  it('choisit un site praticable', () => {
    const site = generator.findSpawnSite();
    expect(bounds.contains(site.x, site.z)).toBe(true);
    expect(sampler.isTerrainWalkable(site.x, site.z)).toBe(true);
    expect(site.slope01).toBeLessThanOrEqual(generator.config.spawn.maxSlope01 + 1e-9);
  });

  it('choisit toujours le même site pour la même seed', () => {
    const other = new ProceduralGenerator({
      seed: 'sampler',
      overrides: { layout: { sizeChunks: 8 } },
    });
    expect(other.findSpawnSite()).toEqual(generator.findSpawnSite());
  });

  it('choisit un site différent pour une autre seed', () => {
    const other = new ProceduralGenerator({
      seed: 'autre-seed',
      overrides: { layout: { sizeChunks: 8 } },
    });
    const a = generator.findSpawnSite();
    const b = other.findSpawnSite();
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1);
  });
});
