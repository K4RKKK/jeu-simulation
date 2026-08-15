import type { ElevationConfig } from '../config/worldGenerationConfig.js';
import type { NoiseProvider } from '../core/noiseProvider.js';
import { clamp01 } from '../core/numeric.js';

/**
 * Relief de base, avant toute intervention de l'hydrologie.
 *
 * Quatre échelles se superposent — continentale, régionale, locale, détail — car une seule
 * octave de bruit produit un paysage uniformément bosselé, sans grandes régions ni petites
 * variations. On y ajoute :
 *
 * - une **déformation du domaine** (domain warping) légère, qui casse l'aspect « bruit
 *   filtré » sans rendre le terrain illisible ;
 * - un **plafond de plaine** : sous une certaine altitude le relief reste doux, ce qui donne
 *   de vraies plaines habitables plutôt qu'un chaos permanent ;
 * - des **crêtes** en altitude, source des zones rocheuses.
 *
 * Cette classe ignore volontairement les rivières et les lacs : c'est l'hydrologie qui les
 * creuse ensuite, à partir de ce relief.
 */
export class ElevationGenerator {
  private readonly warpX;
  private readonly warpZ;
  private readonly continental;
  private readonly regional;
  private readonly local;
  private readonly detail;
  private readonly ridge;
  private readonly weightSum: number;

  constructor(
    private readonly config: ElevationConfig,
    noise: NoiseProvider,
  ) {
    this.warpX = noise.get('elevation-warp-x');
    this.warpZ = noise.get('elevation-warp-z');
    this.continental = noise.get('elevation-continental');
    this.regional = noise.get('elevation-regional');
    this.local = noise.get('elevation-local');
    this.detail = noise.get('elevation-detail');
    this.ridge = noise.get('elevation-ridge');

    this.weightSum =
      config.continental.weight +
      config.regional.weight +
      config.local.weight +
      config.detail.weight;
    if (this.weightSum <= 0) throw new RangeError('Elevation layer weights must sum above zero');
  }

  /** Altitude normalisée dans [0, 1], hors creusement hydrologique. */
  base01(x: number, z: number): number {
    const config = this.config;

    const warpOptions = { scaleMeters: config.warpScaleMeters, octaves: 2 };
    const wx = x + this.warpX.fbm(x, z, warpOptions) * config.warpStrengthMeters;
    const wz = z + this.warpZ.fbm(x, z, warpOptions) * config.warpStrengthMeters;

    const layered =
      (this.continental.fbm01(wx, wz, config.continental) * config.continental.weight +
        this.regional.fbm01(wx, wz, config.regional) * config.regional.weight +
        this.local.fbm01(wx, wz, config.local) * config.local.weight +
        this.detail.fbm01(wx, wz, config.detail) * config.detail.weight) /
      this.weightSum;

    const contrasted = clamp01((layered - 0.5) * config.contrast + 0.5);
    const shaped = applyRelief(contrasted, config.lowlandCeiling01, config.reliefExponent);

    if (shaped <= config.ridgeStart01) return shaped;

    // Les crêtes n'apparaissent qu'en altitude et montent progressivement : appliquées
    // partout, elles transformeraient les plaines en tôle ondulée.
    const ridgeAmount = (shaped - config.ridgeStart01) / Math.max(1e-6, 1 - config.ridgeStart01);
    // Quatre octaves plutôt que trois : une crête ridgée à trop peu d'octaves laisse
    // transparaître l'anisotropie du bruit simplex sous-jacent — des crêtes visiblement
    // parallèles vues de loin plutôt qu'un relief accidenté. Les basses terres (sous
    // `ridgeStart01`, où vivent les plans d'eau) ne voient jamais cette valeur : ce
    // changement ne peut pas perturber l'hydrologie.
    const ridgeNoise = this.ridge.fbm01(wx, wz, {
      scaleMeters: config.ridgeScaleMeters,
      octaves: 4,
      ridged: true,
    });
    return clamp01(shaped + ridgeAmount * config.ridgeStrength * (ridgeNoise - 0.35));
  }

  toMeters(elevation01: number): number {
    return this.config.minMeters + elevation01 * (this.config.maxMeters - this.config.minMeters);
  }

  to01(meters: number): number {
    const span = this.config.maxMeters - this.config.minMeters;
    return span === 0 ? 0 : (meters - this.config.minMeters) / span;
  }

  get metersPerUnit(): number {
    return this.config.maxMeters - this.config.minMeters;
  }
}

/** Aplatit les basses terres et accentue les hauteurs, sans créer de palier visible. */
function applyRelief(value: number, lowlandCeiling: number, exponent: number): number {
  if (value <= lowlandCeiling) return value;
  const span = 1 - lowlandCeiling;
  if (span <= 0) return value;
  const above = (value - lowlandCeiling) / span;
  return lowlandCeiling + Math.pow(above, exponent) * span;
}
