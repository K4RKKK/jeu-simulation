import type { ResourceCategory, ResourceDefinition, ResourceRegistry } from '@civ/content';
import { scoreResourceSuitability } from '@civ/content';
import { chunkKey, type ChunkCoordinate } from '../chunks/chunkCoordinate.js';
import type { ResourceSpawn } from '../chunks/chunkData.js';
import type { WorldGenerationConfig } from '../config/worldGenerationConfig.js';
import type { NoiseProvider, Noise2D } from '../core/noiseProvider.js';
import { HashDomain } from '../core/seedUtils.js';
import { clamp01, lerp } from '../core/numeric.js';
import type { TerrainSample, TerrainSampler } from '../terrain/terrainSampler.js';

interface CategoryPlan {
  readonly category: ResourceCategory;
  readonly cellMeters: number;
  readonly definitions: readonly ResourceDefinition[];
  readonly clusterNoise: readonly Noise2D[];
  readonly domain: HashDomain;
}

/**
 * Placement déterministe des ressources naturelles.
 *
 * Trois exigences se rencontrent ici, et l'algorithme découle d'elles :
 *
 * 1. **Aucun doublon aux frontières.** Les candidats vivent sur une grille en coordonnées
 *    *monde*, indépendante des chunks. Une cellule appartient au chunk qui contient son
 *    centre, et à lui seul : deux chunks voisins ne peuvent donc pas produire deux fois le
 *    même arbre.
 * 2. **Un espacement minimal sans coût quadratique.** Une cellule ne porte qu'un individu
 *    par catégorie. Comparer chaque arbre à tous les autres serait inutilement coûteux ;
 *    la grille suffit à garantir que deux troncs ne se superposent pas.
 * 3. **Une répartition naturelle.** Un bruit de regroupement propre à chaque ressource
 *    crée bosquets et clairières. Sans lui, une forêt ressemblerait à un verger.
 */
export class ResourceSpawner {
  private readonly plans: readonly CategoryPlan[];
  private readonly selectionDomain: HashDomain;

  constructor(
    private readonly config: WorldGenerationConfig,
    private readonly registry: ResourceRegistry,
    private readonly sampler: TerrainSampler,
    noise: NoiseProvider,
  ) {
    const byCategory = new Map<ResourceCategory, ResourceDefinition[]>();
    for (const definition of registry.all()) {
      const list = byCategory.get(definition.category) ?? [];
      list.push(definition);
      byCategory.set(definition.category, list);
    }

    this.plans = [...byCategory.entries()].map(([category, definitions]) => ({
      category,
      // La cellule de la catégorie est dimensionnée par la ressource la plus encombrante :
      // c'est elle qui impose l'espacement.
      cellMeters: Math.max(...definitions.map((definition) => definition.spacingMeters)),
      definitions,
      clusterNoise: definitions.map((definition) => noise.get(`cluster-${definition.id}`)),
      domain: new HashDomain(config.seed, `resources::${config.generationVersion}::${category}`),
    }));

    this.selectionDomain = new HashDomain(
      config.seed,
      `resource-selection::${config.generationVersion}`,
    );
  }

  /**
   * Ressources dont la cellule de candidature a son centre dans ce chunk.
   * `lookup` fournit les champs du terrain déjà échantillonnés par le générateur de chunk.
   */
  spawnForChunk(
    coordinate: ChunkCoordinate,
    lookup: (x: number, z: number) => TerrainSample,
  ): ResourceSpawn[] {
    const chunkSize = this.config.layout.chunkSizeMeters;
    const minX = coordinate.x * chunkSize;
    const minZ = coordinate.z * chunkSize;
    const maxX = minX + chunkSize;
    const maxZ = minZ + chunkSize;
    const ownerKey = chunkKey(coordinate);

    const spawns: ResourceSpawn[] = [];
    const limit = this.config.resources.maxPerChunk;

    for (const plan of this.plans) {
      const firstColumn = Math.floor(minX / plan.cellMeters) - 1;
      const lastColumn = Math.ceil(maxX / plan.cellMeters) + 1;
      const firstRow = Math.floor(minZ / plan.cellMeters) - 1;
      const lastRow = Math.ceil(maxZ / plan.cellMeters) + 1;

      for (let row = firstRow; row <= lastRow; row++) {
        for (let column = firstColumn; column <= lastColumn; column++) {
          const centerX = (column + 0.5) * plan.cellMeters;
          const centerZ = (row + 0.5) * plan.cellMeters;
          // La cellule n'appartient qu'à un seul chunk : celui qui contient son centre.
          if (centerX < minX || centerX >= maxX || centerZ < minZ || centerZ >= maxZ) continue;

          const spawn = this.spawnInCell(plan, column, row, centerX, centerZ, ownerKey, lookup);
          if (spawn) spawns.push(spawn);
          if (spawns.length >= limit) return spawns;
        }
      }
    }

    // Ordre stable indépendant de l'ordre des catégories : deux exécutions produisent
    // exactement la même liste, ce qui rend le hachage d'un chunk comparable.
    spawns.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    // Après le tri, on attribue à chaque spawn son `localId` définitif : c'est l'index
    // dans la liste triée. Il ne bougera jamais : l'adresse `(chunkKey, localId)` reste
    // stable pour un même (seed, generationVersion) et suffit à référencer une
    // ressource dans les messages réseau — inutile de transmettre les chaînes `id`.
    for (let i = 0; i < spawns.length; i++) {
      const spawn = spawns[i]!;
      // Les spawns sont créés `readonly` via littéral d'objet ; on repasse par la
      // création complète pour respecter le contrat sans cast.
      spawns[i] = { ...spawn, localId: i };
    }
    return spawns;
  }

  private spawnInCell(
    plan: CategoryPlan,
    column: number,
    row: number,
    centerX: number,
    centerZ: number,
    ownerChunkKey: string,
    lookup: (x: number, z: number) => TerrainSample,
  ): ResourceSpawn | null {
    const jitter = this.config.resources.jitterRatio;
    const offsetX = (plan.domain.unitSalted(1, column, row) - 0.5) * plan.cellMeters * jitter;
    const offsetZ = (plan.domain.unitSalted(2, column, row) - 0.5) * plan.cellMeters * jitter;
    const x = centerX + offsetX;
    const z = centerZ + offsetZ;

    const terrain = lookup(x, z);
    // Rien ne pousse dans l'eau : les roseaux poussent *au bord*, ce que traduit leur
    // plage de proximité, pas une exception dans le code.
    if (terrain.water !== null) return null;

    const weights: number[] = [];
    let total = 0;
    for (let i = 0; i < plan.definitions.length; i++) {
      const definition = plan.definitions[i] as ResourceDefinition;
      const suitability = scoreResourceSuitability(definition, {
        elevation: terrain.elevation01,
        moisture: terrain.moisture01,
        temperature: terrain.temperature01,
        fertility: terrain.fertility01,
        slope: terrain.slope01,
        rockiness: terrain.rockiness01,
        vegetation: terrain.vegetation01,
        waterProximity: terrain.waterProximity01,
        biomeId: terrain.biome.definition.id,
      });

      let weight = 0;
      if (suitability > 0) {
        const cluster = this.clusterFactor(plan, i, definition, x, z);
        weight =
          definition.density *
          definition.rarity *
          this.config.resources.globalDensity *
          suitability *
          cluster;
      }
      weights.push(weight);
      total += weight;
    }

    if (total <= 0) return null;
    const probability = total > 1 ? 1 : total;
    if (plan.domain.unit(column, row) >= probability) return null;

    const definition = this.pickDefinition(plan, weights, total, column, row);
    if (!definition) return null;

    // Hauteur exacte, pas interpolée : un tronc à demi enterré se voit immédiatement.
    const y = this.sampler.sampleHeight(x, z);

    // Second contrôle de l'eau, à la position exacte cette fois. Le premier utilisait la
    // grille d'échantillonnage : à quelques décimètres d'une rive, elle peut annoncer du
    // sec là où il y a déjà de l'eau. Ce contrôle n'est fait que sur les candidats retenus,
    // il reste donc marginal.
    if (this.sampler.hydrology.sampleWater(x, z, y) !== null) return null;

    const variance = definition.visual.scaleVariance;
    const scale = 1 + (this.selectionDomain.unitSalted(3, column, row) - 0.5) * 2 * variance;

    return {
      id: `${definition.id}@${column}:${row}`,
      definitionId: definition.id,
      definitionIndex: this.registry.indexOf(definition.id),
      ownerChunkKey,
      // Attribué définitivement dans `spawnForChunk` après tri (0 par défaut ici).
      localId: 0,
      x,
      y,
      z,
      scale: scale < 0.35 ? 0.35 : scale,
      rotationY: this.selectionDomain.unitSalted(4, column, row) * Math.PI * 2,
      foodKcal: definition.food?.nutritionKcal ?? 0,
      foodToxicity01: definition.food?.toxicity01 ?? 0,
      harvestServings: Math.max(1, definition.harvestServings ?? 1),
      renewalMode: definition.renewalMode ?? 'regrowWhenDepleted',
    };
  }

  /**
   * Facteur de regroupement dans [0, 2].
   * `clustering = 0` renvoie 1 partout (réparti) ; `clustering = 1` alterne franchement
   * entre bosquets denses et clairières vides.
   */
  private clusterFactor(
    plan: CategoryPlan,
    definitionIndex: number,
    definition: ResourceDefinition,
    x: number,
    z: number,
  ): number {
    if (definition.clustering <= 0) return 1;
    const noise = plan.clusterNoise[definitionIndex] as Noise2D;
    const value = noise.fbm01(x, z, {
      scaleMeters: definition.clusterScaleMeters,
      octaves: 2,
    });
    return clamp01(lerp(1, value * 2, definition.clustering) / 2) * 2;
  }

  private pickDefinition(
    plan: CategoryPlan,
    weights: readonly number[],
    total: number,
    column: number,
    row: number,
  ): ResourceDefinition | null {
    const roll = this.selectionDomain.unit(column, row) * total;
    let cumulative = 0;
    for (let i = 0; i < plan.definitions.length; i++) {
      cumulative += weights[i] as number;
      if (roll < cumulative) return plan.definitions[i] as ResourceDefinition;
    }
    return plan.definitions[plan.definitions.length - 1] ?? null;
  }
}
