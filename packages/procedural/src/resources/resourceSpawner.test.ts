import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BIOMES,
  DEFAULT_WATER_PROFILES,
  BiomeRegistry,
  ResourceRegistry,
  WaterProfileRegistry,
  type ContentCatalog,
  type ResourceDefinition,
} from '@civ/content';
import { ProceduralGenerator } from '../core/proceduralGenerator.js';

/** Deux définitions distinctes, même apparence perçue — le cas visé par `perceptualConceptId`. */
function twinMushrooms(): readonly ResourceDefinition[] {
  const shared: Omit<ResourceDefinition, 'id' | 'food'> = {
    displayName: 'Champignon test',
    category: 'ground_cover',
    visual: {
      shape: 'mushroom',
      primaryColor: '#8a6a4b',
      heightM: 0.2,
      radiusM: 0.15,
      scaleVariance: 0.3,
      detailOnly: true,
    },
    density: 1,
    rarity: 1,
    spacingMeters: 1.5,
    clustering: 0.5,
    clusterScaleMeters: 20,
    biomeWeights: { grassland: 1 },
    interactive: true,
    perceptualConceptId: 'mushroom:test:twin',
  };
  return [
    {
      ...shared,
      id: 'mushroom_test_safe',
      food: { nutritionKcal: 20, waterContent01: 0.9, toxicity01: 0 },
    },
    {
      ...shared,
      id: 'mushroom_test_toxic',
      food: { nutritionKcal: 20, waterContent01: 0.9, toxicity01: 0.9 },
    },
  ];
}

function catalogWith(resources: readonly ResourceDefinition[]): ContentCatalog {
  const biomes = new BiomeRegistry();
  biomes.registerAll(DEFAULT_BIOMES);
  const resourceRegistry = new ResourceRegistry();
  resourceRegistry.registerAll(resources);
  const waterProfiles = new WaterProfileRegistry();
  waterProfiles.registerAll(DEFAULT_WATER_PROFILES);
  return { biomes, resources: resourceRegistry, waterProfiles };
}

describe('ResourceSpawner — perceptualConceptId', () => {
  it('projette definitionId par défaut, quand aucune apparence explicite n’est déclarée', () => {
    const generator = new ProceduralGenerator({
      seed: 'perceptual-concept-default',
      overrides: { layout: { sizeChunks: 4 } },
    });
    const spawns = generator.chunks.generate({ x: 0, z: 0 }).resources;
    expect(spawns.length).toBeGreaterThan(0);
    for (const spawn of spawns) {
      expect(spawn.perceptualConceptId).toBe(spawn.definitionId);
    }
  });

  it('deux définitions distinctes déclarant le même perceptualConceptId projettent le même concept', () => {
    const generator = new ProceduralGenerator({
      seed: 'perceptual-concept-shared',
      overrides: { layout: { sizeChunks: 4 } },
      content: catalogWith(twinMushrooms()),
    });

    const spawns = generator.chunks.generate({ x: 0, z: 0 }).resources;
    expect(spawns.length).toBeGreaterThan(0);

    const definitionIds = new Set(spawns.map((spawn) => spawn.definitionId));
    const conceptIds = new Set(spawns.map((spawn) => spawn.perceptualConceptId));

    // Vérité moteur : deux définitions distinctes ont bien été générées (sinon le test
    // ne prouverait rien).
    expect(definitionIds.size).toBeGreaterThan(1);
    // Apparence perçue : un seul concept pour les deux, malgré des toxicités différentes.
    expect(conceptIds).toEqual(new Set(['mushroom:test:twin']));
  });
});
