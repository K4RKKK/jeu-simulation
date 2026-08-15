import { Registry } from '../registry.js';
import { scoreBiome, type BiomeDefinition, type BiomeScoreInput } from './biomeDefinition.js';

export interface BiomeBlendEntry {
  definition: BiomeDefinition;
  index: number;
  score: number;
  /** Poids normalisé pour le mélange visuel. */
  weight: number;
}

export interface BiomeSelection {
  /** Biome logique dominant : celui que la simulation considère comme « le » biome. */
  definition: BiomeDefinition;
  index: number;
  score: number;
  /** Biomes voisins retenus pour l'interpolation de couleur. */
  blend: BiomeBlendEntry[];
}

const BLEND_COUNT = 3;

export class BiomeRegistry extends Registry<BiomeDefinition> {
  constructor() {
    super('BiomeRegistry');
  }

  /**
   * Choisit le biome dominant et calcule le mélange visuel.
   *
   * Si aucun biome n'atteint son seuil, on retient malgré tout le mieux noté : un point du
   * monde a toujours un biome. Un `undefined` ici deviendrait un trou dans le rendu et une
   * exception dans la simulation.
   */
  select(input: BiomeScoreInput): BiomeSelection {
    const definitions = this.all();
    if (definitions.length === 0) throw new Error('BiomeRegistry: no biome registered');

    // Sélection en une passe, sans tableau intermédiaire ni tri : `select()` est appelée
    // plus d'un millier de fois par chunk, et les allocations y coûtaient plus cher que
    // l'ensemble des évaluations de bruit.
    let bestIndex = 0;
    let bestScore = -1;
    let qualifiedIndex = -1;
    let qualifiedScore = -1;

    const topIndex = this.scratchIndex;
    const topScore = this.scratchScore;
    topIndex[0] = -1;
    topIndex[1] = -1;
    topIndex[2] = -1;
    topScore[0] = 0;
    topScore[1] = 0;
    topScore[2] = 0;

    for (let index = 0; index < definitions.length; index++) {
      const definition = definitions[index] as BiomeDefinition;
      const score = scoreBiome(definition, input);

      if (
        score > bestScore ||
        (score === bestScore &&
          definition.priority > (definitions[bestIndex] as BiomeDefinition).priority)
      ) {
        bestScore = score;
        bestIndex = index;
      }
      if (score >= definition.threshold) {
        const currentPriority =
          qualifiedIndex === -1
            ? -Infinity
            : (definitions[qualifiedIndex] as BiomeDefinition).priority;
        if (
          score > qualifiedScore ||
          (score === qualifiedScore && definition.priority > currentPriority)
        ) {
          qualifiedScore = score;
          qualifiedIndex = index;
        }
      }

      for (let slot = 0; slot < BLEND_COUNT; slot++) {
        if (score > (topScore[slot] as number)) {
          for (let shift = BLEND_COUNT - 1; shift > slot; shift--) {
            topScore[shift] = topScore[shift - 1] as number;
            topIndex[shift] = topIndex[shift - 1] as number;
          }
          topScore[slot] = score;
          topIndex[slot] = index;
          break;
        }
      }
    }

    const dominantIndex = qualifiedIndex === -1 ? bestIndex : qualifiedIndex;
    const dominant = definitions[dominantIndex] as BiomeDefinition;

    const blend: BiomeBlendEntry[] = [];
    let total = 0;
    for (let slot = 0; slot < BLEND_COUNT; slot++) {
      const index = topIndex[slot] as number;
      const score = topScore[slot] as number;
      if (index < 0 || score <= 0) continue;
      // Puissance 3 : accentue le dominant, sinon toutes les zones tendent vers une même
      // couleur moyenne.
      const weight = score ** 3;
      total += weight;
      blend.push({ definition: definitions[index] as BiomeDefinition, index, score, weight });
    }
    if (total > 0) {
      for (const entry of blend) entry.weight /= total;
    }

    return {
      definition: dominant,
      index: dominantIndex,
      score: dominantIndex === qualifiedIndex ? qualifiedScore : bestScore,
      blend,
    };
  }

  private readonly scratchIndex = new Int32Array(BLEND_COUNT);
  private readonly scratchScore = new Float64Array(BLEND_COUNT);
}
