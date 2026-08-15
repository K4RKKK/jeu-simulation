import type { WorldBounds } from '../chunks/worldBounds.js';
import type { WorldGenerationConfig } from '../config/worldGenerationConfig.js';
import { clamp01 } from '../core/numeric.js';
import { HashDomain, HashSequence } from '../core/seedUtils.js';
import type { TerrainSampler } from '../terrain/terrainSampler.js';

export interface SpawnSite {
  readonly x: number;
  readonly z: number;
  readonly score: number;
  readonly slope01: number;
  readonly distanceToWaterM: number;
  readonly biomeId: string;
}

/**
 * Choisit un site viable pour le groupe initial.
 *
 * Ce n'est **pas** une décision d'intelligence artificielle : personne ne « choisit » de
 * s'installer là. C'est un garde-fou de génération, dont le seul rôle est d'éviter qu'une
 * partie commence au milieu d'un lac ou sur une falaise. Le jour où les humains sauront
 * évaluer un lieu, cette fonction ne servira plus qu'à poser le tout premier groupe.
 *
 * Entièrement déterministe : une même seed donne toujours le même site.
 */
export function findValidSpawnPosition(
  config: WorldGenerationConfig,
  bounds: WorldBounds,
  sampler: TerrainSampler,
): SpawnSite {
  const spawnConfig = config.spawn;
  const sequence = new HashSequence(new HashDomain(config.seed, 'spawn-search'));
  const clearanceDomain = new HashDomain(config.seed, 'spawn-clearance');

  // On reste à l'écart des bords : un campement collé à la limite du monde donnerait un
  // groupe qui semble buter contre un mur invisible.
  const reach = bounds.halfSizeMeters * 0.72;

  let best: SpawnSite | null = null;

  for (let candidate = 0; candidate < spawnConfig.candidateCount; candidate++) {
    const x = (sequence.next() * 2 - 1) * reach;
    const z = (sequence.next() * 2 - 1) * reach;

    const terrain = sampler.sample(x, z);
    if (!terrain.walkable) continue;
    if (terrain.slope01 > spawnConfig.maxSlope01) continue;

    const clearance = measureClearance(sampler, clearanceDomain, spawnConfig, candidate, x, z);
    if (clearance < 0.75) continue;

    const score =
      clearance * 0.4 +
      (1 - terrain.slope01) * 0.25 +
      waterComfort(terrain.distanceToWaterM, spawnConfig) * 0.25 +
      terrain.fertility01 * 0.1;

    if (!best || score > best.score) {
      best = {
        x,
        z,
        score,
        slope01: terrain.slope01,
        distanceToWaterM: terrain.distanceToWaterM,
        biomeId: terrain.biome.definition.id,
      };
    }
  }

  if (best) return best;

  // Aucun site n'a satisfait tous les critères : on retombe sur le point praticable le plus
  // plat trouvé par un balayage régulier. Mieux vaut un campement médiocre qu'un monde sans
  // habitants.
  return fallbackSite(bounds, sampler);
}

/** Proximité de l'eau jugée confortable : ni sur la berge, ni à une heure de marche. */
function waterComfort(distanceM: number, config: WorldGenerationConfig['spawn']): number {
  if (
    distanceM >= config.idealWaterDistanceMinMeters &&
    distanceM <= config.idealWaterDistanceMaxMeters
  ) {
    return 1;
  }
  if (distanceM < config.idealWaterDistanceMinMeters) {
    return clamp01(distanceM / Math.max(1e-6, config.idealWaterDistanceMinMeters));
  }
  const excess = distanceM - config.idealWaterDistanceMaxMeters;
  return clamp01(1 - excess / (config.idealWaterDistanceMaxMeters * 2));
}

/** Fraction de points praticables autour du site : un campement doit avoir de la place. */
function measureClearance(
  sampler: TerrainSampler,
  domain: HashDomain,
  config: WorldGenerationConfig['spawn'],
  candidate: number,
  x: number,
  z: number,
): number {
  let walkable = 0;
  for (let i = 0; i < config.clearanceSamples; i++) {
    const angle = domain.unitSalted(i, candidate) * Math.PI * 2;
    const distance = Math.sqrt(domain.unitSalted(i + 64, candidate)) * config.clearanceRadiusMeters;
    if (sampler.isTerrainWalkable(x + Math.cos(angle) * distance, z + Math.sin(angle) * distance)) {
      walkable++;
    }
  }
  return walkable / config.clearanceSamples;
}

function fallbackSite(bounds: WorldBounds, sampler: TerrainSampler): SpawnSite {
  const step = bounds.sizeMeters / 24;
  let best: SpawnSite | null = null;

  for (let z = -bounds.halfSizeMeters + step; z < bounds.halfSizeMeters; z += step) {
    for (let x = -bounds.halfSizeMeters + step; x < bounds.halfSizeMeters; x += step) {
      const terrain = sampler.sample(x, z);
      if (!terrain.walkable) continue;
      const score = 1 - terrain.slope01;
      if (!best || score > best.score) {
        best = {
          x,
          z,
          score,
          slope01: terrain.slope01,
          distanceToWaterM: terrain.distanceToWaterM,
          biomeId: terrain.biome.definition.id,
        };
      }
    }
  }

  if (best) return best;
  throw new Error('World generation produced no walkable terrain at all');
}
