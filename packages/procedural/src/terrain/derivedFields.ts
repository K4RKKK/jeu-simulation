import type {
  FertilityConfig,
  RockinessConfig,
  VegetationConfig,
} from '../config/worldGenerationConfig.js';
import type { Noise2D, NoiseProvider } from '../core/noiseProvider.js';
import { bellAround, clamp01 } from '../core/numeric.js';

/**
 * Champs dérivés : rocaille, fertilité, densité végétale.
 *
 * Ils ne sont pas du bruit indépendant. Chacun est une conséquence des champs primaires —
 * relief, pente, humidité, température — plus une part de bruit qui évite l'aspect
 * mathématique. C'est ce qui produit des cohérences lisibles : les crêtes sont pierreuses,
 * les fonds humides sont fertiles, les pentes rocheuses sont nues.
 *
 * L'ordre de calcul est imposé : rocaille, puis fertilité (qui en dépend), puis végétation
 * (qui dépend de la fertilité).
 */
export class DerivedFieldGenerator {
  private readonly rockinessNoise: Noise2D;
  private readonly fertilityNoise: Noise2D;
  private readonly vegetationNoise: Noise2D;

  constructor(
    private readonly rockinessConfig: RockinessConfig,
    private readonly fertilityConfig: FertilityConfig,
    private readonly vegetationConfig: VegetationConfig,
    private readonly waterLevel01: number,
    noise: NoiseProvider,
  ) {
    this.rockinessNoise = noise.get('rockiness');
    this.fertilityNoise = noise.get('fertility');
    this.vegetationNoise = noise.get('vegetation');
  }

  rockiness(
    x: number,
    z: number,
    elevation01: number,
    slope01: number,
    moisture01: number,
  ): number {
    const config = this.rockinessConfig;
    const noise = this.rockinessNoise.fbm01(x, z, {
      scaleMeters: config.scaleMeters,
      octaves: config.octaves,
    });
    const altitude = clamp01(
      (elevation01 - this.waterLevel01) / Math.max(1e-6, 1 - this.waterLevel01),
    );
    return clamp01(
      slope01 * config.slopeWeight +
        altitude * config.altitudeWeight +
        noise * config.noiseWeight -
        moisture01 * config.moisturePenalty,
    );
  }

  fertility(
    x: number,
    z: number,
    moisture01: number,
    temperature01: number,
    slope01: number,
    rockiness01: number,
  ): number {
    const config = this.fertilityConfig;
    const noise = this.fertilityNoise.fbm01(x, z, {
      scaleMeters: config.scaleMeters,
      octaves: config.octaves,
    });
    const temperatureComfort = bellAround(
      temperature01,
      config.idealTemperature,
      config.temperatureTolerance,
    );
    return clamp01(
      moisture01 * config.moistureWeight +
        temperatureComfort * config.temperatureWeight +
        noise * config.noiseWeight -
        slope01 * config.slopePenalty -
        rockiness01 * config.rockinessPenalty,
    );
  }

  vegetation(
    x: number,
    z: number,
    fertility01: number,
    moisture01: number,
    slope01: number,
    rockiness01: number,
  ): number {
    const config = this.vegetationConfig;
    const noise = this.vegetationNoise.fbm01(x, z, {
      scaleMeters: config.scaleMeters,
      octaves: config.octaves,
    });
    return clamp01(
      fertility01 * config.fertilityWeight +
        moisture01 * config.moistureWeight +
        noise * config.noiseWeight -
        slope01 * config.slopePenalty -
        rockiness01 * config.rockinessPenalty,
    );
  }
}
