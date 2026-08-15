import { Registry } from '../registry.js';
import type { ResourceDefinition } from './resourceDefinition.js';

export class ResourceRegistry extends Registry<ResourceDefinition> {
  constructor() {
    super('ResourceRegistry');
  }

  /** Ressources dont la génération dépend d'une taille de cellule donnée. */
  byCategory(category: ResourceDefinition['category']): ResourceDefinition[] {
    return this.all().filter((definition) => definition.category === category);
  }

  /** Ressources susceptibles d'apparaître dans un biome — évite de scorer tout le catalogue. */
  candidatesForBiome(biomeId: string): ResourceDefinition[] {
    return this.all().filter((definition) => (definition.biomeWeights[biomeId] ?? 0) > 0);
  }
}
