import { BiomeRegistry } from './biomes/biomeRegistry.js';
import { DEFAULT_BIOMES } from './biomes/defaultBiomes.js';
import { DEFAULT_RESOURCES } from './resources/defaultResources.js';
import { ResourceRegistry } from './resources/resourceRegistry.js';
import { DEFAULT_WATER_PROFILES, WaterProfileRegistry } from './water/waterProfile.js';

export * from './range.js';
export * from './registry.js';
export * from './biomes/biomeDefinition.js';
export * from './biomes/biomeRegistry.js';
export * from './biomes/defaultBiomes.js';
export * from './resources/resourceDefinition.js';
export * from './resources/resourceRegistry.js';
export * from './resources/defaultResources.js';
export * from './water/waterProfile.js';

/**
 * Catalogue complet du contenu.
 *
 * Construit à la demande plutôt qu'exposé en singleton : un test doit pouvoir instancier un
 * catalogue réduit (deux biomes, une ressource) pour vérifier un générateur sans dépendre
 * de l'équilibrage réel du jeu.
 */
export interface ContentCatalog {
  readonly biomes: BiomeRegistry;
  readonly resources: ResourceRegistry;
  readonly waterProfiles: WaterProfileRegistry;
}

export function createContentCatalog(): ContentCatalog {
  const biomes = new BiomeRegistry();
  biomes.registerAll(DEFAULT_BIOMES);

  const resources = new ResourceRegistry();
  resources.registerAll(DEFAULT_RESOURCES);

  const waterProfiles = new WaterProfileRegistry();
  waterProfiles.registerAll(DEFAULT_WATER_PROFILES);

  return { biomes, resources, waterProfiles };
}
