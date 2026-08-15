import type { BiomeRegistry } from '@civ/content';
import type { WorldGenerationConfig } from '../config/worldGenerationConfig.js';
import { assertFinite } from '../core/numeric.js';
import { HashDomain } from '../core/seedUtils.js';
import { regionAt, regionColorByte } from '../regions/regionGrid.js';
import type { ResourceSpawner } from '../resources/resourceSpawner.js';
import type { TerrainSample, TerrainSampler } from '../terrain/terrainSampler.js';
import { chunkKey, type ChunkCoordinate } from './chunkCoordinate.js';
import { quantize01, type ChunkData, type TerrainChunkData } from './chunkData.js';

export interface ChunkGeneratorParts {
  config: WorldGenerationConfig;
  sampler: TerrainSampler;
  spawner: ResourceSpawner;
  biomes: BiomeRegistry;
}

/**
 * Fabrique un chunk complet.
 *
 * `generate(coordinate)` est une **fonction pure de (seed, config, coordonnée)**. Aucun
 * chunk voisin n'a besoin d'exister, aucun ordre n'est imposé, et deux appels produisent
 * exactement le même résultat. C'est cette propriété qui autorisera, sans rien réécrire, la
 * génération à la demande, en tâche de fond ou dans un worker.
 *
 * Les champs du terrain sont évalués **une seule fois** sur une grille fine, puis partagés
 * entre le maillage, les statistiques de biome et le placement des ressources.
 */
export class ChunkGenerator {
  private readonly latticeSize: number;
  private readonly latticeStep: number;
  private readonly meshStride: number;
  private readonly regionSizeMeters: number;
  /** Hash de coloration des régions — voir `regionColorByte` (`regions/regionGrid.ts`). */
  private readonly regionHash: HashDomain;

  constructor(private readonly parts: ChunkGeneratorParts) {
    const layout = parts.config.layout;
    if (layout.chunkSizeMeters % layout.sampleLatticeMeters !== 0) {
      throw new Error('sampleLatticeMeters must divide chunkSizeMeters');
    }
    const meshStepMeters = layout.chunkSizeMeters / layout.terrainResolution;
    if (meshStepMeters % layout.sampleLatticeMeters !== 0) {
      throw new Error('sampleLatticeMeters must divide the terrain mesh step');
    }

    this.latticeStep = layout.sampleLatticeMeters;
    this.latticeSize = layout.chunkSizeMeters / layout.sampleLatticeMeters + 1;
    this.meshStride = meshStepMeters / layout.sampleLatticeMeters;
    this.regionSizeMeters = parts.config.regions.sizeChunks * layout.chunkSizeMeters;
    this.regionHash = new HashDomain(parts.config.seed, 'region');
  }

  generate(coordinate: ChunkCoordinate): ChunkData {
    const startedAt = performance.now();
    const layout = this.parts.config.layout;
    const originX = coordinate.x * layout.chunkSizeMeters;
    const originZ = coordinate.z * layout.chunkSizeMeters;

    const lattice = this.sampleLattice(originX, originZ);
    const lookup = (x: number, z: number): TerrainSample => {
      const column = clampIndex(Math.round((x - originX) / this.latticeStep), this.latticeSize);
      const row = clampIndex(Math.round((z - originZ) / this.latticeStep), this.latticeSize);
      return lattice[row * this.latticeSize + column] as TerrainSample;
    };

    const terrain = this.buildTerrain(lattice);
    const resources = this.parts.spawner.spawnForChunk(coordinate, lookup);

    const counts = new Uint16Array(this.parts.biomes.size);
    const waterBodies = new Set<number>();
    let walkable = 0;
    for (const sample of lattice) {
      counts[sample.biome.index] = (counts[sample.biome.index] ?? 0) + 1;
      if (sample.walkable) walkable++;
      if (sample.water) waterBodies.add(sample.water.body.index);
    }

    let dominantIndex = 0;
    for (let i = 1; i < counts.length; i++) {
      if ((counts[i] as number) > (counts[dominantIndex] as number)) dominantIndex = i;
    }

    return {
      coordinate,
      key: chunkKey(coordinate),
      generationVersion: this.parts.config.generationVersion,
      terrain,
      resources,
      waterBodyIndices: [...waterBodies].sort((a, b) => a - b),
      biomeStats: {
        counts,
        dominantIndex,
        walkableRatio: walkable / lattice.length,
      },
      generationMs: performance.now() - startedAt,
    };
  }

  /**
   * Échantillonne la grille fine en deux passes.
   *
   * La première ne calcule que l'altitude, sur une grille élargie d'une cellule de chaque
   * côté. La seconde en déduit la pente par différences centrées — les voisins sont déjà
   * là — puis complète l'échantillon. Calculer la pente point par point exigerait quatre
   * évaluations d'altitude supplémentaires chacune, soit l'essentiel du coût d'un chunk.
   */
  private sampleLattice(originX: number, originZ: number): TerrainSample[] {
    const sampler = this.parts.sampler;
    const padded = this.latticeSize + 2;
    const elevation01 = new Float64Array(padded * padded);
    const heights = new Float64Array(padded * padded);

    for (let row = 0; row < padded; row++) {
      const z = originZ + (row - 1) * this.latticeStep;
      for (let column = 0; column < padded; column++) {
        const x = originX + (column - 1) * this.latticeStep;
        const value = sampler.sampleElevation(x, z);
        elevation01[row * padded + column] = value;
        heights[row * padded + column] = sampler.elevationToMeters(value);
      }
    }

    const normalization = this.parts.config.elevation.slopeNormalizationMeters;
    const lattice: TerrainSample[] = new Array<TerrainSample>(this.latticeSize * this.latticeSize);

    for (let row = 0; row < this.latticeSize; row++) {
      const z = originZ + row * this.latticeStep;
      const paddedRow = row + 1;
      for (let column = 0; column < this.latticeSize; column++) {
        const x = originX + column * this.latticeStep;
        const paddedColumn = column + 1;
        const center = paddedRow * padded + paddedColumn;

        const dx =
          ((heights[center + 1] as number) - (heights[center - 1] as number)) /
          (2 * this.latticeStep);
        const dz =
          ((heights[center + padded] as number) - (heights[center - padded] as number)) /
          (2 * this.latticeStep);
        const slope01 = Math.min(1, Math.hypot(dx, dz) / normalization);

        lattice[row * this.latticeSize + column] = sampler.sampleWithSlope(
          x,
          z,
          elevation01[center] as number,
          slope01,
        );
      }
    }
    return lattice;
  }

  /**
   * Extrait le maillage de la grille fine.
   *
   * Les sommets de bord sont calculés aux coordonnées monde partagées avec le chunk voisin.
   * Comme le bruit est échantillonné en coordonnées monde, les deux chunks obtiennent
   * exactement la même valeur : il ne peut pas y avoir de fissure entre eux.
   */
  private buildTerrain(lattice: readonly TerrainSample[]): TerrainChunkData {
    const resolution = this.parts.config.layout.terrainResolution;
    const side = resolution + 1;
    const count = side * side;

    const heights = new Float32Array(count);
    const waterHeights = new Float32Array(count);
    const colors = new Uint8Array(count * 3);
    const fields = {
      elevation: new Uint8Array(count),
      slope: new Uint8Array(count),
      temperature: new Uint8Array(count),
      moisture: new Uint8Array(count),
      fertility: new Uint8Array(count),
      rockiness: new Uint8Array(count),
      vegetation: new Uint8Array(count),
      biome: new Uint8Array(count),
      region: new Uint8Array(count),
      walkable: new Uint8Array(count),
    };

    let minHeightM = Number.POSITIVE_INFINITY;
    let maxHeightM = Number.NEGATIVE_INFINITY;
    let hasWater = false;

    for (let row = 0; row < side; row++) {
      for (let column = 0; column < side; column++) {
        const sample = lattice[
          row * this.meshStride * this.latticeSize + column * this.meshStride
        ] as TerrainSample;
        const index = row * side + column;

        const height = assertFinite(sample.heightM, 'terrain height');
        heights[index] = height;
        if (height < minHeightM) minHeightM = height;
        if (height > maxHeightM) maxHeightM = height;

        if (sample.water) {
          waterHeights[index] = sample.water.surfaceHeightM;
          hasWater = true;
        } else {
          waterHeights[index] = Number.NaN;
        }

        fields.elevation[index] = quantize01(sample.elevation01);
        fields.slope[index] = quantize01(sample.slope01);
        fields.temperature[index] = quantize01(sample.temperature01);
        fields.moisture[index] = quantize01(sample.moisture01);
        fields.fertility[index] = quantize01(sample.fertility01);
        fields.rockiness[index] = quantize01(sample.rockiness01);
        fields.vegetation[index] = quantize01(sample.vegetation01);
        fields.biome[index] = sample.biome.index;
        fields.region[index] = regionColorByte(
          regionAt(sample.x, sample.z, this.regionSizeMeters),
          this.regionHash,
        );
        fields.walkable[index] = sample.walkable ? 1 : 0;

        writeColor(colors, index * 3, sample);
      }
    }

    return {
      resolution,
      heights,
      waterHeights,
      colors,
      fields,
      minHeightM,
      maxHeightM,
      hasWater,
    };
  }
}

/**
 * Couleur du sol : mélange pondéré des biomes les mieux notés, puis légère modulation.
 *
 * Le mélange est ce qui supprime les frontières nettes entre biomes. La modulation par la
 * fertilité et la rocaille évite qu'une grande prairie soit une nappe d'une seule teinte.
 */
function writeColor(target: Uint8Array, offset: number, sample: TerrainSample): void {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const entry of sample.biome.blend) {
    const color = parseHexColor(entry.definition.color);
    r += color[0] * entry.weight;
    g += color[1] * entry.weight;
    b += color[2] * entry.weight;
  }

  const richness = 0.86 + sample.fertility01 * 0.24 - sample.rockiness01 * 0.1;
  const dryness = 1 - sample.moisture01 * 0.12;
  r *= richness * (dryness + 0.06);
  g *= richness * dryness;
  b *= richness * (dryness - 0.03);

  // Ombre de canopée : une zone à forte densité de végétation (déjà naturellement faible
  // sur la roche et les fortes pentes, `vegetation01` en tient compte) se lit un peu plus
  // sombre et verte que le sol nu voisin — un indice visible même de loin, là où les arbres
  // individuels ne sont plus rendus, sans dépendre du placement effectif des ressources.
  [r, g, b] = blendRgb([r, g, b], [58, 84, 46], sample.vegetation01 * 0.3);

  // La roche affleure progressivement avec la pente. Cela rend les crêtes lisibles et
  // évite l'impression d'une montagne uniformément engazonnée.
  const exposedRock = smoothstep(0.28, 0.78, sample.slope01) * (0.45 + sample.rockiness01 * 0.55);
  [r, g, b] = blendRgb([r, g, b], [126, 121, 111], exposedRock * 0.82);

  // Rive en bandes progressives : fond humide, boue/sable, puis herbe humide. La distance
  // vient de la même hydrologie que la simulation ; la couleur ne peut donc pas contredire
  // la présence réelle d'eau ou la praticabilité.
  if (sample.water) {
    [r, g, b] = blendRgb([r, g, b], [86, 91, 72], 0.78);
  } else {
    const wetGrass = 1 - smoothstep(2.2, 6, sample.distanceToWaterM);
    [r, g, b] = blendRgb([r, g, b], [103, 119, 76], wetGrass * 0.42);
    const wetSoil = 1 - smoothstep(0.7, 3.1, sample.distanceToWaterM);
    [r, g, b] = blendRgb([r, g, b], [132, 119, 84], wetSoil * 0.72);
  }

  // Un bruit chromatique discret et stable en coordonnees monde casse les grands aplats
  // sans transformer le style low-poly en texture mouchetee.
  const variation = 0.97 + coordinateNoise01(sample.x, sample.z) * 0.06;
  target[offset] = clampByte(r * variation);
  target[offset + 1] = clampByte(g * variation);
  target[offset + 2] = clampByte(b * variation);
}

function blendRgb(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  amount: number,
): [number, number, number] {
  const t = amount < 0 ? 0 : amount > 1 ? 1 : amount;
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function coordinateNoise01(x: number, z: number): number {
  let hash = Math.imul(Math.round(x * 10), 0x1f123bb5) ^ Math.imul(Math.round(z * 10), 0x5f356495);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0xffffffff;
}

const colorCache = new Map<string, readonly [number, number, number]>();

function parseHexColor(hex: string): readonly [number, number, number] {
  const cached = colorCache.get(hex);
  if (cached) return cached;
  const value = Number.parseInt(hex.replace('#', ''), 16);
  const parsed: readonly [number, number, number] = [
    (value >> 16) & 255,
    (value >> 8) & 255,
    value & 255,
  ];
  colorCache.set(hex, parsed);
  return parsed;
}

function clampByte(value: number): number {
  const rounded = Math.round(value);
  return rounded < 0 ? 0 : rounded > 255 ? 255 : rounded;
}

function clampIndex(value: number, size: number): number {
  return value < 0 ? 0 : value >= size ? size - 1 : value;
}
