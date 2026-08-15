import type { RegionCoordinate } from '@civ/procedural';
import type { EntityManager } from '../core/entityManager.js';
import type { World } from './world.js';

export type EcologyStatus = 'thriving' | 'stable' | 'stressed' | 'degraded';

export interface RegionalEcologySample {
  readonly region: RegionCoordinate;
  readonly status: EcologyStatus;
  readonly resourceRemainingRatio01: number;
  readonly disturbance01: number;
  readonly waterAvailability01: number;
  readonly temperatureSuitability01: number;
  readonly growthPotential01: number;
  readonly resilience01: number;
}

/** Vue écologique légère dérivée du monde réel, sans compteur parallèle. */
export class RegionalEcology {
  constructor(private readonly world: World) {}

  sample(coordinate: RegionCoordinate, entities?: EntityManager): RegionalEcologySample {
    const region = this.world.regions.stats(coordinate, entities);
    const center = this.regionCenter(coordinate);
    const environment = this.world.environmentAt(center.x, center.z);
    const resourceRemainingRatio01 =
      region.static.resourceCount === 0
        ? 1
        : clamp01(region.dynamic.resourceRemainingEquivalent / region.static.resourceCount);
    const harvestPressure01 = 1 - resourceRemainingRatio01;
    const trailPressure01 = clamp01(
      (region.dynamic.trailWornCellCount / Math.max(1, region.static.sampleCount)) * 10,
    );
    const disturbance01 = clamp01(harvestPressure01 * 0.7 + trailPressure01 * 0.3);
    const waterAvailability01 = clamp01(
      region.static.moistureMean01 * 0.55 +
        environment.weather.humidity01 * 0.25 +
        environment.weather.precipitation01 * 0.2,
    );
    const temperatureSuitability01 = clamp01(
      1 - Math.abs(environment.ambientTemperatureC - 15) / 30,
    );
    const resilience01 = clamp01(
      region.static.fertilityMean01 * 0.45 +
        region.static.vegetationMean01 * 0.35 +
        region.static.walkableRatio * 0.2,
    );
    const climaticPotential =
      region.static.fertilityMean01 * 0.28 +
      region.static.vegetationMean01 * 0.2 +
      waterAvailability01 * 0.32 +
      temperatureSuitability01 * 0.2;
    const growthPotential01 = clamp01(climaticPotential * (1 - disturbance01 * 0.65));

    return {
      region: { ...coordinate },
      status: ecologyStatus(growthPotential01, disturbance01),
      resourceRemainingRatio01: round3(resourceRemainingRatio01),
      disturbance01: round3(disturbance01),
      waterAvailability01: round3(waterAvailability01),
      temperatureSuitability01: round3(temperatureSuitability01),
      growthPotential01: round3(growthPotential01),
      resilience01: round3(resilience01),
    };
  }

  private regionCenter(coordinate: RegionCoordinate): { x: number; z: number } {
    const size =
      this.world.generator.config.regions.sizeChunks *
      this.world.generator.config.layout.chunkSizeMeters;
    return { x: (coordinate.x + 0.5) * size, z: (coordinate.z + 0.5) * size };
  }
}

function ecologyStatus(growth: number, disturbance: number): EcologyStatus {
  if (growth >= 0.7 && disturbance < 0.25) return 'thriving';
  if (growth >= 0.48 && disturbance < 0.55) return 'stable';
  if (growth >= 0.25) return 'stressed';
  return 'degraded';
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
