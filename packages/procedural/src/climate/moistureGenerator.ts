import type { MoistureConfig } from '../config/worldGenerationConfig.js';
import type { Noise2D, NoiseProvider } from '../core/noiseProvider.js';
import { clamp01 } from '../core/numeric.js';

/**
 * Champ d'humidité, normalisé dans [0, 1].
 *
 * L'humidité n'est pas qu'un bruit : elle augmente au bord de l'eau et diminue avec
 * l'altitude. C'est ce couplage qui fait apparaître les zones humides *autour* des lacs et
 * des rivières plutôt qu'au hasard, et qui rend les hauteurs sèches et pierreuses.
 */
export class MoistureGenerator {
  private readonly noise: Noise2D;

  constructor(
    private readonly config: MoistureConfig,
    private readonly waterLevel01: number,
    noise: NoiseProvider,
  ) {
    this.noise = noise.get('moisture');
  }

  get waterInfluenceMeters(): number {
    return this.config.waterInfluenceMeters;
  }

  sample(x: number, z: number, elevation01: number, waterProximity01: number): number {
    const regional = this.noise.fbm(x, z, {
      scaleMeters: this.config.scaleMeters,
      octaves: this.config.octaves,
    });
    const altitude = Math.max(0, elevation01 - this.waterLevel01);
    return clamp01(
      this.config.mean +
        regional * this.config.amplitude +
        waterProximity01 * this.config.waterBonus -
        altitude * this.config.altitudeDrying,
    );
  }
}
