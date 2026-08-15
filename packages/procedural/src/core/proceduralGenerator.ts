import { createContentCatalog, type ContentCatalog } from '@civ/content';
import { ChunkGenerator } from '../chunks/chunkGenerator.js';
import type { ChunkCoordinate } from '../chunks/chunkCoordinate.js';
import type { ChunkData } from '../chunks/chunkData.js';
import { WorldBounds } from '../chunks/worldBounds.js';
import { MoistureGenerator } from '../climate/moistureGenerator.js';
import { TemperatureGenerator } from '../climate/temperatureGenerator.js';
import {
  createWorldGenerationConfig,
  type WorldGenerationConfig,
  type WorldGenerationOverrides,
} from '../config/worldGenerationConfig.js';
import { generateHydrology } from '../hydrology/hydrologyGenerator.js';
import type { HydrologyMap } from '../hydrology/hydrologyMap.js';
import { regionAt, type RegionCoordinate } from '../regions/regionGrid.js';
import { ResourceSpawner } from '../resources/resourceSpawner.js';
import { findValidSpawnPosition, type SpawnSite } from '../spawn/spawnFinder.js';
import { DerivedFieldGenerator } from '../terrain/derivedFields.js';
import { ElevationGenerator } from '../terrain/elevationGenerator.js';
import { TerrainSampler } from '../terrain/terrainSampler.js';
import { NoiseProvider } from './noiseProvider.js';

export interface ProceduralGeneratorOptions {
  seed?: string;
  overrides?: WorldGenerationOverrides;
  content?: ContentCatalog;
}

/**
 * Assemble la génération d'un monde.
 *
 * L'ordre de construction n'est pas arbitraire, il suit les dépendances physiques :
 * le relief existe d'abord, le climat en découle, l'hydrologie a besoin des deux, et tous
 * les champs dérivés dépendent de l'eau. Une seule passe globale est nécessaire —
 * l'hydrologie — après quoi tout redevient local et interrogeable point par point.
 */
export class ProceduralGenerator {
  readonly config: WorldGenerationConfig;
  readonly content: ContentCatalog;
  readonly bounds: WorldBounds;
  readonly hydrology: HydrologyMap;
  readonly sampler: TerrainSampler;
  readonly chunks: ChunkGenerator;
  /** Durée de la passe globale d'hydrologie, en millisecondes. */
  readonly hydrologyMs: number;
  private readonly regionSizeMeters: number;

  constructor(options: ProceduralGeneratorOptions = {}) {
    this.config = createWorldGenerationConfig({
      ...options.overrides,
      ...(options.seed === undefined ? {} : { seed: options.seed }),
    });
    this.content = options.content ?? createContentCatalog();
    this.bounds = new WorldBounds(this.config.layout);
    this.regionSizeMeters = this.config.regions.sizeChunks * this.config.layout.chunkSizeMeters;

    const noise = new NoiseProvider(this.config.seed);
    const elevation = new ElevationGenerator(this.config.elevation, noise);
    const temperature = new TemperatureGenerator(
      this.config.temperature,
      this.config.hydrology.waterLevel01,
      noise,
    );

    const hydrologyStartedAt = performance.now();
    this.hydrology = generateHydrology({
      config: this.config,
      bounds: this.bounds,
      elevation,
      waterProfiles: this.content.waterProfiles,
      // L'hydrologie n'a besoin de la température que pour qualifier l'eau : on
      // l'échantillonne sur le relief brut, avant tout creusement.
      sampleTemperature01: (x, z) => temperature.sample(x, z, elevation.base01(x, z)),
    });
    this.hydrologyMs = performance.now() - hydrologyStartedAt;

    const moisture = new MoistureGenerator(
      this.config.moisture,
      this.config.hydrology.waterLevel01,
      noise,
    );
    const derived = new DerivedFieldGenerator(
      this.config.rockiness,
      this.config.fertility,
      this.config.vegetation,
      this.config.hydrology.waterLevel01,
      noise,
    );

    this.sampler = new TerrainSampler({
      config: this.config,
      elevation,
      temperature,
      moisture,
      derived,
      hydrology: this.hydrology,
      biomes: this.content.biomes,
    });

    this.chunks = new ChunkGenerator({
      config: this.config,
      sampler: this.sampler,
      spawner: new ResourceSpawner(this.config, this.content.resources, this.sampler, noise),
      biomes: this.content.biomes,
    });
  }

  get seed(): string {
    return this.config.seed;
  }

  get generationVersion(): string {
    return this.config.generationVersion;
  }

  /**
   * Tout ce qui détermine la génération de ce monde, sous forme sérialisable : les
   * paramètres numériques (`config`) et le contenu déclaratif qui les accompagne
   * (biomes, ressources, profils d'eau — via `Registry.all()`, déjà de simples données).
   *
   * Typé `unknown` délibérément : le seul consommateur (`@civ/simulation`, pour son
   * empreinte de sauvegarde) n'a pas le droit d'importer `@civ/content` (CLAUDE.md
   * règle 2) et n'a besoin de connaître ni la forme de ces définitions ni leur package
   * d'origine — seulement qu'elles existent et qu'un changement doit invalider une
   * sauvegarde faite avec un contenu différent.
   */
  get fingerprintSource(): unknown {
    return {
      generation: this.config,
      biomes: this.content.biomes.all(),
      resources: this.content.resources.all(),
      waterProfiles: this.content.waterProfiles.all(),
    };
  }

  generateChunk(coordinate: ChunkCoordinate): ChunkData {
    return this.chunks.generate(coordinate);
  }

  /**
   * Région macroscopique contenant cette position — identité canonique (voir
   * `RegionCoordinate`), pas l'octet de coloration transmis au réseau. Point d'ancrage
   * pour une future météo régionale ; aucun système ne l'appelle encore aujourd'hui.
   */
  regionAt(x: number, z: number): RegionCoordinate {
    return regionAt(x, z, this.regionSizeMeters);
  }

  findSpawnSite(): SpawnSite {
    return findValidSpawnPosition(this.config, this.bounds, this.sampler);
  }
}
