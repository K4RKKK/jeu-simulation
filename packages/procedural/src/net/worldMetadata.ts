import type { WorldGenerationMetadata } from '@civ/shared';
import type { ProceduralGenerator } from '../core/proceduralGenerator.js';

/**
 * Tables de contenu envoyées à la connexion.
 *
 * C'est ce message qui rend le client entièrement data-driven : il y apprend quels biomes
 * et quelles ressources existent, à quoi elles ressemblent, et comment lire les indices
 * contenus dans les grilles de chunk. Aucun identifiant de contenu n'est écrit en dur côté
 * client.
 */
export function buildWorldGenerationMetadata(
  generator: ProceduralGenerator,
): WorldGenerationMetadata {
  const { config, content, hydrology } = generator;

  return {
    generationVersion: config.generationVersion,
    seed: config.seed,
    sizeChunks: config.layout.sizeChunks,
    chunkSizeMeters: config.layout.chunkSizeMeters,
    terrainResolution: config.layout.terrainResolution,
    minChunk: generator.bounds.minChunk,
    maxChunk: generator.bounds.maxChunk,
    waterLevelM: round2(generator.sampler.elevationToMeters(config.hydrology.waterLevel01)),
    regions: { sizeChunks: config.regions.sizeChunks },

    biomes: content.biomes.all().map((biome, index) => ({
      index,
      id: biome.id,
      displayName: biome.displayName,
      color: biome.color,
    })),

    resources: content.resources.all().map((resource, index) => ({
      index,
      id: resource.id,
      displayName: resource.displayName,
      category: resource.category,
      interactive: resource.interactive,
      visual: {
        shape: resource.visual.shape,
        primaryColor: resource.visual.primaryColor,
        ...(resource.visual.secondaryColor === undefined
          ? {}
          : { secondaryColor: resource.visual.secondaryColor }),
        heightM: resource.visual.heightM,
        radiusM: resource.visual.radiusM,
        detailOnly: resource.visual.detailOnly,
        ...(resource.visual.deciduous === undefined
          ? {}
          : { deciduous: resource.visual.deciduous }),
      },
      ...(resource.food === undefined ? {} : { food: resource.food }),
    })),

    waterBodies: hydrology.bodies.map((body) => {
      const profile = content.waterProfiles.getOrThrow(body.type);
      return {
        index: body.index,
        id: body.id,
        type: body.type,
        displayName: profile.displayName,
        color: profile.color,
        centerX: round2(body.centerX),
        centerZ: round2(body.centerZ),
        areaM2: Math.round(body.areaM2),
        volume: Math.round(body.volume),
        meanDepthM: round2(body.meanDepthM),
        maxDepthM: round2(body.maxDepthM),
        surfaceHeightM: round2(body.surfaceHeightM),
        contamination: round3(body.contamination),
        pathogenLoad: round3(body.pathogenLoad),
        turbidity: round3(body.turbidity),
        temperatureC: round2(body.temperatureC),
        flowRenewal: round3(body.flowRenewal),
      };
    }),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
