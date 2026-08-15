import type { ChunkData } from '../chunks/chunkData.js';
import type { ProceduralGenerator } from '../core/proceduralGenerator.js';

/** Empreinte stable d'un chunk, base des tests de déterminisme. */
export function hashChunk(chunk: ChunkData): string {
  let hash = 0x811c9dc5;
  const write = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  };

  write(`${chunk.key}|${chunk.generationVersion}`);
  const heights = chunk.terrain.heights;
  for (let i = 0; i < heights.length; i++) {
    // Millimètre : au-delà, on testerait la reproductibilité binaire de Math.sin plutôt
    // que celle de la génération.
    write(`${Math.round((heights[i] as number) * 1000)}`);
  }
  for (const spawn of chunk.resources) {
    write(`${spawn.id}|${Math.round(spawn.x * 100)}|${Math.round(spawn.z * 100)}`);
  }
  write(`${chunk.biomeStats.dominantIndex}`);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface WorldGenerationReport {
  seed: string;
  generationVersion: string;
  chunksAnalyzed: number;
  hydrologyMs: number;
  averageChunkMs: number;
  maxChunkMs: number;
  /** Part de chaque biome, indexée par identifiant. */
  biomeShare: Record<string, number>;
  resourceCounts: Record<string, number>;
  water: {
    lakes: number;
    ponds: number;
    rivers: number;
    springs: number;
    coverage: number;
    coverageByType: Record<string, number>;
  };
  walkableRatio: number;
  minHeightM: number;
  maxHeightM: number;
  spawn: { x: number; z: number; biomeId: string; distanceToWaterM: number };
}

/**
 * Statistiques sur un monde généré.
 *
 * Sert autant à l'équilibrage manuel qu'aux tests automatiques : c'est ce rapport qui
 * permet de dire « ce monde est 92 % rocheux » avant de le découvrir à l'écran.
 */
export function analyzeWorld(
  generator: ProceduralGenerator,
  options: { maxChunks?: number } = {},
): WorldGenerationReport {
  const allChunks = generator.bounds.allChunks();
  const limit = options.maxChunks ?? allChunks.length;
  // Échantillonnage régulier plutôt que les N premiers chunks : analyser uniquement un coin
  // du monde donnerait une image fausse de sa composition.
  const stride = Math.max(1, Math.floor(allChunks.length / limit));
  const selected = allChunks.filter((_, index) => index % stride === 0).slice(0, limit);

  const biomeCounts = new Map<string, number>();
  const resourceCounts = new Map<string, number>();
  let vertexTotal = 0;
  let walkableSum = 0;
  let totalMs = 0;
  let maxMs = 0;
  let minHeightM = Number.POSITIVE_INFINITY;
  let maxHeightM = Number.NEGATIVE_INFINITY;

  for (const coordinate of selected) {
    const chunk = generator.generateChunk(coordinate);
    totalMs += chunk.generationMs;
    if (chunk.generationMs > maxMs) maxMs = chunk.generationMs;
    walkableSum += chunk.biomeStats.walkableRatio;
    if (chunk.terrain.minHeightM < minHeightM) minHeightM = chunk.terrain.minHeightM;
    if (chunk.terrain.maxHeightM > maxHeightM) maxHeightM = chunk.terrain.maxHeightM;

    for (let index = 0; index < chunk.biomeStats.counts.length; index++) {
      const count = chunk.biomeStats.counts[index] as number;
      if (count === 0) continue;
      const biome = generator.content.biomes.at(index);
      if (!biome) continue;
      biomeCounts.set(biome.id, (biomeCounts.get(biome.id) ?? 0) + count);
      vertexTotal += count;
    }
    for (const spawn of chunk.resources) {
      resourceCounts.set(spawn.definitionId, (resourceCounts.get(spawn.definitionId) ?? 0) + 1);
    }
  }

  const biomeShare: Record<string, number> = {};
  for (const biome of generator.content.biomes.all()) {
    biomeShare[biome.id] = vertexTotal === 0 ? 0 : (biomeCounts.get(biome.id) ?? 0) / vertexTotal;
  }

  const resources: Record<string, number> = {};
  for (const definition of generator.content.resources.all()) {
    resources[definition.id] = resourceCounts.get(definition.id) ?? 0;
  }

  const spawn = generator.findSpawnSite();

  return {
    seed: generator.seed,
    generationVersion: generator.generationVersion,
    chunksAnalyzed: selected.length,
    hydrologyMs: generator.hydrologyMs,
    averageChunkMs: selected.length === 0 ? 0 : totalMs / selected.length,
    maxChunkMs: maxMs,
    biomeShare,
    resourceCounts: resources,
    water: {
      lakes: generator.hydrology.stats.lakes,
      ponds: generator.hydrology.stats.ponds,
      rivers: generator.hydrology.stats.rivers,
      springs: generator.hydrology.stats.springs,
      coverage: generator.hydrology.stats.waterCellRatio,
      coverageByType: { ...generator.hydrology.stats.coverageByType },
    },
    walkableRatio: selected.length === 0 ? 0 : walkableSum / selected.length,
    minHeightM,
    maxHeightM,
    spawn: {
      x: spawn.x,
      z: spawn.z,
      biomeId: spawn.biomeId,
      distanceToWaterM: spawn.distanceToWaterM,
    },
  };
}
