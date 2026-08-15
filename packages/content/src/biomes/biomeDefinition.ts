import { rangeMembership, type SuitabilityRange } from '../range.js';

/**
 * Définition d'un biome.
 *
 * Le choix du biome est un **scoring**, pas une cascade de `if`. Chaque axe (température,
 * humidité, altitude…) déclare une plage préférée à bords doux ; le biome dominant est
 * celui dont le score global est le plus élevé.
 *
 * C'est cette formulation continue qui donne des transitions progressives — le rendu peut
 * interpoler les couleurs des biomes les mieux notés — sans renoncer à un biome logique
 * dominant unique par point du monde.
 */
export type BiomeRange = SuitabilityRange;

export interface BiomeDefinition {
  readonly id: string;
  readonly displayName: string;
  /** Couleur de base du sol, en hexadécimal `#rrggbb`. */
  readonly color: string;
  /**
   * Score minimum au-delà duquel ce biome peut être retenu. Évite qu'un biome très
   * spécialisé (zone humide) l'emporte de justesse là où il n'a rien à faire.
   */
  readonly threshold: number;
  /** Départage deux biomes de score identique. Plus haut = plus prioritaire. */
  readonly priority: number;

  readonly temperature?: BiomeRange;
  readonly moisture?: BiomeRange;
  readonly elevation?: BiomeRange;
  readonly slope?: BiomeRange;
  readonly rockiness?: BiomeRange;
  /** Proximité de l'eau, normalisée : 1 = au bord, 0 = très loin. */
  readonly waterProximity?: BiomeRange;
}

export interface BiomeScoreInput {
  temperature: number;
  moisture: number;
  elevation: number;
  slope: number;
  rockiness: number;
  waterProximity: number;
}

/**
 * Score d'un biome pour un point donné, dans [0, 1].
 *
 * Moyenne pondérée plutôt que produit : un produit annulerait le score dès qu'un seul axe
 * sort de sa plage, ce qui recréerait des frontières nettes. La moyenne laisse les biomes
 * se disputer les zones intermédiaires, et c'est exactement ce qui produit un dégradé.
 */
export function scoreBiome(definition: BiomeDefinition, input: BiomeScoreInput): number {
  let total = 0;
  let weightSum = 0;

  const axis = (range: BiomeRange | undefined, value: number): void => {
    if (!range) return;
    const weight = range.weight ?? 1;
    total += rangeMembership(value, range) * weight;
    weightSum += weight;
  };

  axis(definition.temperature, input.temperature);
  axis(definition.moisture, input.moisture);
  axis(definition.elevation, input.elevation);
  axis(definition.slope, input.slope);
  axis(definition.rockiness, input.rockiness);
  axis(definition.waterProximity, input.waterProximity);

  if (weightSum === 0) return 0;
  return total / weightSum;
}
