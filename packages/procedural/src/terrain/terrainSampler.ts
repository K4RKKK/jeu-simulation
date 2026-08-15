import type { BiomeRegistry, BiomeSelection } from '@civ/content';
import type { MoistureGenerator } from '../climate/moistureGenerator.js';
import type { TemperatureGenerator } from '../climate/temperatureGenerator.js';
import type { WorldGenerationConfig } from '../config/worldGenerationConfig.js';
import { clamp01 } from '../core/numeric.js';
import type { HydrologyMap, WaterSample } from '../hydrology/hydrologyMap.js';
import type { DerivedFieldGenerator } from './derivedFields.js';
import type { ElevationGenerator } from './elevationGenerator.js';

/** Tout ce que l'on peut savoir d'un point du monde, sans aucun rendu. */
export interface TerrainSample {
  readonly x: number;
  readonly z: number;
  readonly elevation01: number;
  readonly heightM: number;
  readonly slope01: number;
  readonly temperature01: number;
  readonly moisture01: number;
  readonly fertility01: number;
  readonly rockiness01: number;
  readonly vegetation01: number;
  readonly waterProximity01: number;
  readonly distanceToWaterM: number;
  readonly biome: BiomeSelection;
  readonly water: WaterSample | null;
  readonly walkable: boolean;
}

export interface TerrainSamplerParts {
  config: WorldGenerationConfig;
  elevation: ElevationGenerator;
  temperature: TemperatureGenerator;
  moisture: MoistureGenerator;
  derived: DerivedFieldGenerator;
  hydrology: HydrologyMap;
  biomes: BiomeRegistry;
}

/**
 * Point d'entrée unique pour interroger le monde.
 *
 * Tout ce qui a besoin de connaître le terrain — génération de chunk, placement des
 * ressources, choix d'un campement, déplacement d'un humain, outils de debug — passe par
 * ici. Un seul endroit décide donc de ce qu'« est » un point du monde, et il fonctionne
 * sans le moindre maillage : la simulation headless l'utilise exactement comme le serveur.
 *
 * Les méthodes unitaires (`sampleMoisture`…) recalculent leurs dépendances ; pour un
 * balayage dense, `sample()` fait tout le travail en une passe.
 */
export class TerrainSampler {
  constructor(private readonly parts: TerrainSamplerParts) {}

  get config(): WorldGenerationConfig {
    return this.parts.config;
  }

  get hydrology(): HydrologyMap {
    return this.parts.hydrology;
  }

  /* ---- Champs primaires ---------------------------------------------- */

  /** Altitude normalisée, creusement des rivières inclus. */
  sampleElevation(x: number, z: number): number {
    return clamp01(this.parts.elevation.base01(x, z) - this.parts.hydrology.carve01At(x, z));
  }

  /** Altitude du sol en mètres — c'est elle que suivent les humains et le maillage. */
  sampleHeight(x: number, z: number): number {
    return this.parts.elevation.toMeters(this.sampleElevation(x, z));
  }

  elevationToMeters(elevation01: number): number {
    return this.parts.elevation.toMeters(elevation01);
  }

  /**
   * Pente normalisée, dérivée par différences finies sur la hauteur réelle.
   * On dérive la hauteur *après* creusement : les berges d'une rivière sont bien des pentes.
   */
  sampleSlope(x: number, z: number): number {
    const d = this.parts.config.elevation.slopeSampleMeters;
    const hx = (this.sampleHeight(x + d, z) - this.sampleHeight(x - d, z)) / (2 * d);
    const hz = (this.sampleHeight(x, z + d) - this.sampleHeight(x, z - d)) / (2 * d);
    const gradient = Math.hypot(hx, hz);
    return clamp01(gradient / this.parts.config.elevation.slopeNormalizationMeters);
  }

  sampleTemperature(x: number, z: number): number {
    return this.parts.temperature.sample(x, z, this.sampleElevation(x, z));
  }

  sampleMoisture(x: number, z: number): number {
    return this.parts.moisture.sample(
      x,
      z,
      this.sampleElevation(x, z),
      this.sampleWaterProximity(x, z),
    );
  }

  sampleWaterProximity(x: number, z: number): number {
    return this.parts.hydrology.waterProximity01(x, z, this.parts.moisture.waterInfluenceMeters);
  }

  sampleRockiness(x: number, z: number): number {
    return this.parts.derived.rockiness(
      x,
      z,
      this.sampleElevation(x, z),
      this.sampleSlope(x, z),
      this.sampleMoisture(x, z),
    );
  }

  sampleFertility(x: number, z: number): number {
    return this.parts.derived.fertility(
      x,
      z,
      this.sampleMoisture(x, z),
      this.sampleTemperature(x, z),
      this.sampleSlope(x, z),
      this.sampleRockiness(x, z),
    );
  }

  sampleVegetation(x: number, z: number): number {
    return this.parts.derived.vegetation(
      x,
      z,
      this.sampleFertility(x, z),
      this.sampleMoisture(x, z),
      this.sampleSlope(x, z),
      this.sampleRockiness(x, z),
    );
  }

  /* ---- Échantillon complet ------------------------------------------- */

  sample(x: number, z: number): TerrainSample {
    const elevation01 = this.sampleElevation(x, z);
    return this.sampleWithSlope(x, z, elevation01, this.sampleSlope(x, z));
  }

  /**
   * Échantillon complet à partir d'une altitude et d'une pente déjà connues.
   *
   * La pente coûte quatre évaluations de hauteur supplémentaires — de loin le poste le plus
   * cher d'un échantillon. Quand on balaie une grille régulière (génération d'un chunk), la
   * pente se déduit des voisins déjà calculés ; ce point d'entrée évite alors de refaire
   * quatre fois le travail. C'est ce qui divise par trois le coût d'un chunk.
   */
  sampleWithSlope(x: number, z: number, elevation01: number, slope01: number): TerrainSample {
    const heightM = this.parts.elevation.toMeters(elevation01);

    const distanceToWaterM = this.parts.hydrology.distanceToWaterMeters(x, z);
    const waterProximity01 = clamp01(
      1 - distanceToWaterM / Math.max(1e-6, this.parts.moisture.waterInfluenceMeters),
    );

    const temperature01 = this.parts.temperature.sample(x, z, elevation01);
    const moisture01 = this.parts.moisture.sample(x, z, elevation01, waterProximity01);
    const rockiness01 = this.parts.derived.rockiness(x, z, elevation01, slope01, moisture01);
    const fertility01 = this.parts.derived.fertility(
      x,
      z,
      moisture01,
      temperature01,
      slope01,
      rockiness01,
    );
    const vegetation01 = this.parts.derived.vegetation(
      x,
      z,
      fertility01,
      moisture01,
      slope01,
      rockiness01,
    );

    const water = this.parts.hydrology.sampleWater(x, z, heightM);
    const biome = this.parts.biomes.select({
      temperature: temperature01,
      moisture: moisture01,
      elevation: elevation01,
      slope: slope01,
      rockiness: rockiness01,
      waterProximity: waterProximity01,
    });

    return {
      x,
      z,
      elevation01,
      heightM,
      slope01,
      temperature01,
      moisture01,
      fertility01,
      rockiness01,
      vegetation01,
      waterProximity01,
      distanceToWaterM,
      biome,
      water,
      walkable: this.isWalkableFrom(slope01, water),
    };
  }

  /* ---- Praticabilité --------------------------------------------------- */

  /**
   * Un point est praticable si la pente reste franchissable et si l'eau y est assez basse
   * pour être traversée à gué. Le pathfinding n'existe pas encore, mais cette information
   * est déjà la seule vérité sur laquelle il s'appuiera.
   */
  isTerrainWalkable(x: number, z: number): boolean {
    const heightM = this.sampleHeight(x, z);
    return this.isWalkableFrom(
      this.sampleSlope(x, z),
      this.parts.hydrology.sampleWater(x, z, heightM),
    );
  }

  private isWalkableFrom(slope01: number, water: WaterSample | null): boolean {
    if (slope01 > this.parts.config.walkability.maxSlope01) return false;
    if (water === null) return true;
    const limit = Math.min(
      this.parts.config.walkability.maxWaterDepthMeters,
      water.body.wadeableDepthM,
    );
    return water.depthM <= limit;
  }
}
