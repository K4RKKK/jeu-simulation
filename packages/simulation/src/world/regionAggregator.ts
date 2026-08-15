import {
  chunkKey,
  regionKey,
  type ChunkCoordinate,
  type ChunkData,
  type RegionCoordinate,
  type WorldBounds,
} from '@civ/procedural';
import { Human, InteractiveResource, Transform } from '../components/index.js';
import type { EntityManager } from '../core/entityManager.js';
import type { WorldDelta } from './worldDelta.js';

export interface RegionStaticStats {
  readonly coordinate: RegionCoordinate;
  readonly key: string;
  readonly chunkKeys: readonly string[];
  readonly chunkCount: number;
  readonly sampleCount: number;
  readonly elevationMinM: number;
  readonly elevationMaxM: number;
  readonly elevationMeanM: number;
  readonly slopeMean01: number;
  readonly temperatureMean01: number;
  readonly moistureMean01: number;
  readonly fertilityMean01: number;
  readonly rockinessMean01: number;
  readonly vegetationMean01: number;
  readonly walkableRatio: number;
  readonly waterCoverage01: number;
  readonly dominantBiomeIndex: number;
  readonly biomeSampleCounts: readonly number[];
  readonly resourceCount: number;
  readonly resourceCounts: Readonly<Record<string, number>>;
  readonly waterBodyIndices: readonly number[];
}

export interface RegionDynamicStats {
  readonly coordinate: RegionCoordinate;
  readonly key: string;
  readonly humanCount: number;
  readonly interactiveResourceCount: number;
  readonly resourceAvailableCount: number;
  /** Nombre de ressources équivalentes encore disponibles, portions incluses. */
  readonly resourceRemainingEquivalent: number;
  readonly resourceModifiedCount: number;
  readonly resourceDepletedCount: number;
  readonly resourceRemovedCount: number;
  readonly trailWornCellCount: number;
  readonly trailMeanWear01: number;
}

export interface RegionStats {
  readonly static: RegionStaticStats;
  readonly dynamic: RegionDynamicStats;
}

export interface RegionAggregatorOptions {
  readonly sizeChunks: number;
  readonly chunkSizeMeters: number;
  readonly bounds: WorldBounds;
  readonly delta: WorldDelta;
  readonly generateBaseChunk: (coordinate: ChunkCoordinate) => ChunkData;
}

/**
 * Agrège la couche macroscopique du monde.
 *
 * Les statistiques statiques sont une fonction pure de la génération et restent en
 * cache. Les statistiques dynamiques sont relues depuis `WorldDelta` et l'ECS à chaque
 * demande : aucune seconde source de vérité, aucune donnée supplémentaire à persister.
 */
export class RegionAggregator {
  private readonly staticCache = new Map<string, RegionStaticStats>();

  constructor(private readonly options: RegionAggregatorOptions) {
    if (!Number.isInteger(options.sizeChunks) || options.sizeChunks <= 0) {
      throw new RangeError('RegionAggregator.sizeChunks must be a positive integer');
    }
  }

  staticStats(coordinate: RegionCoordinate): RegionStaticStats {
    const key = regionKey(coordinate);
    const cached = this.staticCache.get(key);
    if (cached) return cached;
    const computed = this.computeStaticStats(coordinate);
    this.staticCache.set(key, computed);
    return computed;
  }

  dynamicStats(coordinate: RegionCoordinate, entities?: EntityManager): RegionDynamicStats {
    const base = this.staticStats(coordinate);
    const chunkKeys = new Set(base.chunkKeys);
    let humanCount = 0;
    let interactiveResourceCount = 0;

    if (entities) {
      entities.each([Human, Transform], (_entity, _human, transform) => {
        if (sameRegion(this.regionAt(transform.x, transform.z), coordinate)) humanCount++;
      });
      entities.each([InteractiveResource, Transform], (_entity, _resource, transform) => {
        if (sameRegion(this.regionAt(transform.x, transform.z), coordinate)) {
          interactiveResourceCount++;
        }
      });
    }

    let resourceModifiedCount = 0;
    let resourceDepletedCount = 0;
    let resourceRemovedCount = 0;
    let consumedEquivalent = 0;
    for (const [, resource] of this.options.delta.entries()) {
      if (!chunkKeys.has(resource.ownerChunkKey)) continue;
      if (resource.state === 'modified') {
        resourceModifiedCount++;
        const remaining = resource.changedFields.remainingFraction01;
        if (typeof remaining === 'number') consumedEquivalent += 1 - clamp01(remaining);
      } else {
        consumedEquivalent++;
        if (resource.state === 'depleted') resourceDepletedCount++;
        else resourceRemovedCount++;
      }
    }

    let trailWornCellCount = 0;
    let trailWearTotal = 0;
    for (const key of base.chunkKeys) {
      const trail = this.options.delta.trailStats(key);
      trailWornCellCount += trail.wornCellCount;
      trailWearTotal += trail.totalWear01;
    }

    const goneCount = resourceDepletedCount + resourceRemovedCount;
    return {
      coordinate: { ...coordinate },
      key: base.key,
      humanCount,
      interactiveResourceCount,
      resourceAvailableCount: Math.max(0, base.resourceCount - goneCount),
      resourceRemainingEquivalent: Math.max(0, base.resourceCount - consumedEquivalent),
      resourceModifiedCount,
      resourceDepletedCount,
      resourceRemovedCount,
      trailWornCellCount,
      trailMeanWear01: trailWornCellCount === 0 ? 0 : trailWearTotal / trailWornCellCount,
    };
  }

  stats(coordinate: RegionCoordinate, entities?: EntityManager): RegionStats {
    return {
      static: this.staticStats(coordinate),
      dynamic: this.dynamicStats(coordinate, entities),
    };
  }

  chunkCoordinates(coordinate: RegionCoordinate): ChunkCoordinate[] {
    const result: ChunkCoordinate[] = [];
    const minX = coordinate.x * this.options.sizeChunks;
    const minZ = coordinate.z * this.options.sizeChunks;
    for (let z = minZ; z < minZ + this.options.sizeChunks; z++) {
      for (let x = minX; x < minX + this.options.sizeChunks; x++) {
        const chunk = { x, z };
        if (this.options.bounds.containsChunk(chunk)) result.push(chunk);
      }
    }
    return result;
  }

  regionAt(worldX: number, worldZ: number): RegionCoordinate {
    const sizeMeters = this.options.sizeChunks * this.options.chunkSizeMeters;
    return { x: Math.floor(worldX / sizeMeters), z: Math.floor(worldZ / sizeMeters) };
  }

  private computeStaticStats(coordinate: RegionCoordinate): RegionStaticStats {
    const chunks = this.chunkCoordinates(coordinate).map(this.options.generateBaseChunk);
    if (chunks.length === 0) {
      throw new RangeError(`Region ${regionKey(coordinate)} is outside world bounds`);
    }

    let sampleCount = 0;
    let elevationMinM = Number.POSITIVE_INFINITY;
    let elevationMaxM = Number.NEGATIVE_INFINITY;
    let elevationTotal = 0;
    let slopeTotal = 0;
    let temperatureTotal = 0;
    let moistureTotal = 0;
    let fertilityTotal = 0;
    let rockinessTotal = 0;
    let vegetationTotal = 0;
    let walkableCount = 0;
    let waterCount = 0;
    const biomeSampleCounts: number[] = [];
    const resourceCounts: Record<string, number> = {};
    const waterBodyIndices = new Set<number>();

    for (const chunk of chunks) {
      const terrain = chunk.terrain;
      const side = terrain.resolution + 1;
      // Le dernier rang et la dernière colonne sont partagés avec le chunk voisin.
      // Les exclure donne à chaque cellule du monde exactement le même poids.
      for (let z = 0; z < terrain.resolution; z++) {
        for (let x = 0; x < terrain.resolution; x++) {
          const index = z * side + x;
          const elevation = terrain.heights[index] as number;
          sampleCount++;
          elevationTotal += elevation;
          elevationMinM = Math.min(elevationMinM, elevation);
          elevationMaxM = Math.max(elevationMaxM, elevation);
          slopeTotal += (terrain.fields.slope[index] as number) / 255;
          temperatureTotal += (terrain.fields.temperature[index] as number) / 255;
          moistureTotal += (terrain.fields.moisture[index] as number) / 255;
          fertilityTotal += (terrain.fields.fertility[index] as number) / 255;
          rockinessTotal += (terrain.fields.rockiness[index] as number) / 255;
          vegetationTotal += (terrain.fields.vegetation[index] as number) / 255;
          if ((terrain.fields.walkable[index] as number) > 0) walkableCount++;
          if (Number.isFinite(terrain.waterHeights[index] as number)) waterCount++;
          const biome = terrain.fields.biome[index] as number;
          biomeSampleCounts[biome] = (biomeSampleCounts[biome] ?? 0) + 1;
        }
      }
      for (const resource of chunk.resources) {
        resourceCounts[resource.definitionId] = (resourceCounts[resource.definitionId] ?? 0) + 1;
      }
      for (const waterBodyIndex of chunk.waterBodyIndices) waterBodyIndices.add(waterBodyIndex);
    }

    let dominantBiomeIndex = 0;
    for (let index = 1; index < biomeSampleCounts.length; index++) {
      if ((biomeSampleCounts[index] ?? 0) > (biomeSampleCounts[dominantBiomeIndex] ?? 0)) {
        dominantBiomeIndex = index;
      }
    }
    const resourceCount = Object.values(resourceCounts).reduce((sum, count) => sum + count, 0);
    return {
      coordinate: { ...coordinate },
      key: regionKey(coordinate),
      chunkKeys: chunks.map((chunk) => chunkKey(chunk.coordinate)),
      chunkCount: chunks.length,
      sampleCount,
      elevationMinM,
      elevationMaxM,
      elevationMeanM: elevationTotal / sampleCount,
      slopeMean01: slopeTotal / sampleCount,
      temperatureMean01: temperatureTotal / sampleCount,
      moistureMean01: moistureTotal / sampleCount,
      fertilityMean01: fertilityTotal / sampleCount,
      rockinessMean01: rockinessTotal / sampleCount,
      vegetationMean01: vegetationTotal / sampleCount,
      walkableRatio: walkableCount / sampleCount,
      waterCoverage01: waterCount / sampleCount,
      dominantBiomeIndex,
      biomeSampleCounts,
      resourceCount,
      resourceCounts,
      waterBodyIndices: [...waterBodyIndices].sort((a, b) => a - b),
    };
  }
}

function sameRegion(a: RegionCoordinate, b: RegionCoordinate): boolean {
  return a.x === b.x && a.z === b.z;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
