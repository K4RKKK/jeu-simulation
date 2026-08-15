import type { TemperatureConfig } from '../config/worldGenerationConfig.js';
import type { Noise2D, NoiseProvider } from '../core/noiseProvider.js';
import { clamp01 } from '../core/numeric.js';

/**
 * Champ de température, normalisé dans [0, 1].
 *
 * Deux contributions seulement pour la V1 : un bruit climatique à grande échelle et le
 * refroidissement avec l'altitude. La latitude n'entre pas encore en jeu — le monde est trop
 * petit pour qu'elle ait un sens — mais l'ajouter reviendrait à une ligne ici, sans toucher
 * à quoi que ce soit d'autre.
 */
export class TemperatureGenerator {
  private readonly noise: Noise2D;

  constructor(
    private readonly config: TemperatureConfig,
    private readonly waterLevel01: number,
    noise: NoiseProvider,
  ) {
    this.noise = noise.get('temperature');
  }

  sample(x: number, z: number, elevation01: number): number {
    const regional = this.noise.fbm(x, z, {
      scaleMeters: this.config.scaleMeters,
      octaves: this.config.octaves,
    });
    const altitude = Math.max(0, elevation01 - this.waterLevel01);
    return clamp01(
      this.config.mean + regional * this.config.amplitude - altitude * this.config.lapseRate,
    );
  }
}
