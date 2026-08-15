import type { EnvironmentSnapshot, WorldDescriptor, WorldId } from '@civ/shared';
import {
  ProceduralGenerator,
  chunkKey,
  type ChunkCoordinate,
  type ChunkData,
  type HydrologyMap,
  type RegionCoordinate,
  type ResourceSpawn,
  type SpawnSite,
  type TerrainSampler,
  type WorldBounds,
  type WorldGenerationOverrides,
} from '@civ/procedural';
import type { SimulationConfig } from '../config/simulationConfig.js';
import type { SimulationClock } from '../core/clock.js';
import { Environment } from './environment.js';
import { RegionAggregator } from './regionAggregator.js';
import { RegionalWeather, type RegionalWeatherSample } from './regionalWeather.js';
import { RegionalEcology } from './regionalEcology.js';
import { WorldChangeJournal, WorldDelta } from './worldDelta.js';

export interface WorldOptions {
  worldId: WorldId;
  seed: string;
  clock: SimulationClock;
  config: SimulationConfig;
  generation?: WorldGenerationOverrides;
  /**
   * Taille du cache de chunks générés. La génération d'un chunk coûte plusieurs
   * millisecondes : la perception (et demain le pathfinding) relisent sans cesse le
   * contenu des chunks, un cache borné les rend relisibles à coût nul.
   */
  chunkCacheCapacity?: number;
}

/**
 * Le monde : l'espace, le terrain et l'ambiance dans lesquels vivent les entités.
 *
 * Le `World` ne possède pas les entités — c'est le rôle de l'`EntityManager`. Il possède ce
 * qui est spatial : le générateur procédural et sa carte hydrologique, l'échantillonneur de
 * terrain, le registre des modifications apportées à la base procédurale, et un cache borné
 * des chunks récemment générés.
 *
 * Le cache ne change rien aux valeurs : la génération reste une fonction déterministe de
 * (seed, coordonnée), et le modèle de persistance reste `seed + version + configuration +
 * modifications`. Un chunk évincé du cache se régénère à l'identique. Les chunks sont
 * stockés **avant** l'application des modifications, qui restent donc toujours appliquées à
 * la lecture, même sur un chunk anciennement mis en cache.
 */
/** Coordonnée du chunk pour la clé `"x:z"` ; `null` si mal formée. */
function parseChunkKey(key: string): ChunkCoordinate | null {
  const parts = key.split(':');
  if (parts.length !== 2) return null;
  const x = Number(parts[0]);
  const z = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x, z };
}

export class World {
  readonly worldId: WorldId;
  readonly seed: string;
  readonly clock: SimulationClock;
  readonly environment: Environment;
  readonly generator: ProceduralGenerator;
  /**
   * Mutations persistantes : source unique de vérité pour les ressources modifiées ou
   * disparues. Survit aux déchargements de chunks et aux sauvegardes.
   */
  readonly delta = new WorldDelta();
  /**
   * Journal des changements récents à diffuser au réseau. Distinct du `delta` : ce
   * dernier est l'état persistant, celui-ci le flux volatile vidé à chaque lecture.
   * (Auparavant, `WorldModifications` mélangeait les deux, avec risque de divergence.)
   */
  readonly journal = new WorldChangeJournal();
  /** Vue macroscopique statique + dynamique, dérivée des sources de vérité. */
  readonly regions: RegionAggregator;
  readonly weather: RegionalWeather;
  readonly ecology: RegionalEcology;

  /** Cache LRU : le générateur est déterministe, la génération ne se fait qu'une fois. */
  private readonly chunkCache = new Map<string, ChunkData>();
  private readonly chunkCacheCapacity: number;
  private readonly config: SimulationConfig;

  constructor(options: WorldOptions) {
    this.worldId = options.worldId;
    this.seed = options.seed;
    this.clock = options.clock;
    this.config = options.config;
    this.chunkCacheCapacity = Math.max(1, options.chunkCacheCapacity ?? 512);
    this.generator = new ProceduralGenerator({
      seed: options.seed,
      ...(options.generation === undefined ? {} : { overrides: options.generation }),
    });
    // La température ressentie d'un lieu intègre le climat procédural (altitude comprise
    // via le lapse rate) : le monde branche son échantillonneur sur l'environnement.
    this.environment = new Environment(options.config.environment, (x, z) =>
      this.generator.sampler.sampleTemperature(x, z),
    );
    this.regions = new RegionAggregator({
      sizeChunks: this.generator.config.regions.sizeChunks,
      chunkSizeMeters: this.generator.config.layout.chunkSizeMeters,
      bounds: this.generator.bounds,
      delta: this.delta,
      generateBaseChunk: (coordinate) => this.generator.generateChunk(coordinate),
    });
    this.weather = new RegionalWeather(this.seed, this.config.weather, this.regions);
    this.ecology = new RegionalEcology(this);
  }

  get bounds(): WorldBounds {
    return this.generator.bounds;
  }

  get terrain(): TerrainSampler {
    return this.generator.sampler;
  }

  get hydrology(): HydrologyMap {
    return this.generator.hydrology;
  }

  get sizeMeters(): number {
    return this.generator.bounds.sizeMeters;
  }

  get chunkSizeMeters(): number {
    return this.generator.bounds.chunkSizeMeters;
  }

  get generationVersion(): string {
    return this.generator.generationVersion;
  }

  /**
   * Génère un chunk et lui applique les modifications enregistrées.
   *
   * La génération elle-même est mise en cache (LRU borné) : elle est déterministe, et
   * plusieurs systèmes (perception, recherche de ressources) ont besoin de relire le même
   * chunk sans en payer le coût à chaque fois. Les modifications, elles, sont toujours
   * appliquées à la lecture, même sur un chunk sorti puis rentré du cache.
   */
  generateChunk(coordinate: ChunkCoordinate): ChunkData {
    const key = chunkKey(coordinate);
    let chunk = this.chunkCache.get(key);
    if (chunk === undefined) {
      chunk = this.generator.generateChunk(coordinate);
      this.chunkCache.set(key, chunk);
      if (this.chunkCache.size > this.chunkCacheCapacity) {
        const oldest = this.chunkCache.keys().next().value;
        if (oldest !== undefined) this.chunkCache.delete(oldest);
      }
    } else {
      // La Map itère dans l'ordre d'insertion : la ré-insertion rafraîchit la fraîcheur LRU.
      this.chunkCache.delete(key);
      this.chunkCache.set(key, chunk);
    }
    return this.delta.apply(chunk);
  }

  /**
   * Enregistre le retrait complet d'une ressource : mutation persistante dans le delta +
   * événement dans le journal réseau. Point d'entrée unique pour toute cueillette /
   * ramassage / consommation destructive.
   */
  recordResourceRemoval(
    resourceId: string,
    ownerChunkKey: string,
    localId: number,
    x: number | null,
    z: number | null,
    tick: number,
  ): void {
    this.delta.markDepleted(resourceId, ownerChunkKey, localId, tick);
    this.journal.pushRemoval({ resourceId, ownerChunkKey, localId, x, z, tick });
  }

  /**
   * Consomme une portion d'une ressource récoltable en plusieurs fois (voir
   * `ResourceDefinition.harvestServings`). Décrémente son compte de portions
   * restantes ; à la dernière, la ressource est intégralement retirée
   * (`recordResourceRemoval`, comportement inchangé pour une ressource à une seule
   * portion). Retourne les portions restantes après ce passage — `0` signifie que la
   * ressource vient de disparaître.
   *
   * Le cas où deux humains visent la même ressource au même tick se résout sans code
   * supplémentaire : `entities.each` est séquentiel dans cet ECS mono-thread, le second
   * appel lit déjà la décrémentation du premier.
   */
  harvestResource(
    resourceId: string,
    ownerChunkKey: string,
    localId: number,
    maxServings: number,
    x: number | null,
    z: number | null,
    tick: number,
  ): number {
    // La fraction restante EST le seul état persisté (`remainingFraction01`) — pas un
    // compte de portions séparé : c'est aussi exactement ce que `resource:updated`
    // diffuse au réseau, et ce que `ChunkManager` réinjecte dans `ChunkPayload.resourceStates`
    // pour un chunk rechargé (voir sa doc). Une seule forme pour l'état persisté, l'état
    // réseau ET l'état rejoué évite qu'une ressource partiellement récoltée redevienne
    // visuellement neuve après une éviction de chunk ou une reconnexion.
    const previousFraction = this.delta.get(resourceId)?.changedFields.remainingFraction01;
    const remainingBefore =
      typeof previousFraction === 'number'
        ? Math.round(previousFraction * maxServings)
        : maxServings;
    const remaining = remainingBefore - 1;
    if (remaining <= 0) {
      this.recordResourceRemoval(resourceId, ownerChunkKey, localId, x, z, tick);
      return 0;
    }
    const remainingFraction01 = remaining / maxServings;
    this.delta.patch(resourceId, ownerChunkKey, localId, { remainingFraction01 }, tick);
    this.journal.pushResourceUpdate({
      resourceId,
      ownerChunkKey,
      localId,
      changedFields: { remainingFraction01 },
      tick,
    });
    return remaining;
  }

  /** Inscrit le passage d'un humain dans le sol sans influencer sa vitesse ou ses choix. */
  recordFootTraffic(fromX: number, fromZ: number, toX: number, toZ: number): void {
    const distance = Math.hypot(toX - fromX, toZ - fromZ);
    if (distance <= 0) return;
    const cellMeters = this.config.movement.trailCellMeters;
    const resolution = Math.round(this.chunkSizeMeters / cellMeters);
    const steps = Math.max(1, Math.ceil(distance / (cellMeters * 0.5)));
    const wearPerSample = (distance * this.config.movement.trailWearPerMeter) / (steps + 1);

    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const x = fromX + (toX - fromX) * t;
      const z = fromZ + (toZ - fromZ) * t;
      const coordinate = this.chunkAt(x, z);
      const key = chunkKey(coordinate);
      const localX = x - coordinate.x * this.chunkSizeMeters;
      const localZ = z - coordinate.z * this.chunkSizeMeters;
      const column = Math.max(0, Math.min(resolution - 1, Math.floor(localX / cellMeters)));
      const row = Math.max(0, Math.min(resolution - 1, Math.floor(localZ / cellMeters)));
      const cellIndex = row * resolution + column;
      const wear01 = this.delta.addTrailWear(key, resolution, cellIndex, wearPerSample);
      if (wear01 !== null) {
        this.journal.pushTrailChange({ chunkKey: key, resolution, cellIndex, wear01 });
      }
    }
  }

  /** Coordonnée du chunk contenant le point du monde. */
  chunkAt(x: number, z: number): ChunkCoordinate {
    return this.generator.bounds.chunkAt(x, z);
  }

  /**
   * Région macroscopique contenant le point du monde (voir `RegionCoordinate`). Point
   * d'ancrage pour une future météo régionale ; aucun système de simulation ne l'appelle
   * encore aujourd'hui.
   */
  regionAt(x: number, z: number): RegionCoordinate {
    return this.generator.regionAt(x, z);
  }

  /** Ambiance locale complète : cycles astronomiques + météo de la région. */
  environmentAt(x: number, z: number): EnvironmentSnapshot & { weather: RegionalWeatherSample } {
    const base = this.environment.sample(this.clock, x, z);
    const weather = this.weather.sample(this.clock, this.regionAt(x, z), base.ambientTemperatureC);
    return {
      ...base,
      ambientTemperatureC:
        Math.round((base.ambientTemperatureC + weather.temperatureDeltaC) * 100) / 100,
      weather,
    };
  }

  /** Vue réseau du centre du monde ; les systèmes peuvent appeler `environmentAt` localement. */
  environmentSnapshot(): EnvironmentSnapshot {
    return this.environmentAt(0, 0);
  }

  /**
   * Ressource précise du monde, cherchée dans son chunk propriétaire.
   *
   * Ce n'est pas une recherche omnisciente : l'appelant sait déjà *où* la ressource est
   * (il s'en souvient) et *laquelle* (son identifiant). La fonction ne fait que relire le
   * chunk correspondant — généralement mis en cache — pour retrouver la chose elle-même,
   * par exemple sa toxicité au moment de la manger. `null` si elle a disparu entre-temps.
   *
   * Bug corrigé : lorsque `ownerChunkKey` était déduit de la position physique, une
   * ressource poussée par le jitter au-delà de la frontière de son chunk propriétaire
   * était cherchée dans le mauvais chunk et restait introuvable. Le chunk propriétaire
   * est maintenant transmis explicitement (mémorisé au moment de la perception).
   */
  findResourceById(resourceId: string, ownerChunkKey: string): ResourceSpawn | null {
    const parsed = parseChunkKey(ownerChunkKey);
    if (parsed === null) return null;
    const chunk = this.generateChunk(parsed);
    for (const spawn of chunk.resources) {
      if (spawn.id === resourceId) return spawn;
    }
    return null;
  }

  /** Retrouve le spawn procédural même si `WorldDelta` le masque actuellement. */
  findBaseResourceById(resourceId: string, ownerChunkKey: string): ResourceSpawn | null {
    const parsed = parseChunkKey(ownerChunkKey);
    if (parsed === null) return null;
    const chunk = this.generator.generateChunk(parsed);
    return chunk.resources.find((spawn) => spawn.id === resourceId) ?? null;
  }

  /**
   * Rend sa capacité complète à une ressource épuisée ou partiellement récoltée.
   * Une ressource `removed` ne peut jamais repousser par cette voie.
   */
  regrowResource(resourceId: string, tick: number): boolean {
    const delta = this.delta.get(resourceId);
    if (!delta || delta.state === 'removed') return false;
    if (!this.findBaseResourceById(resourceId, delta.ownerChunkKey)) return false;
    const wasDepleted = delta.state === 'depleted';
    this.delta.restore(resourceId);
    if (wasDepleted) {
      this.journal.pushResourceAddition({
        resourceId,
        ownerChunkKey: delta.ownerChunkKey,
        localId: delta.localId,
        changedFields: { remainingFraction01: 1 },
        tick,
      });
    } else {
      this.journal.pushResourceUpdate({
        resourceId,
        ownerChunkKey: delta.ownerChunkKey,
        localId: delta.localId,
        changedFields: { remainingFraction01: 1 },
        tick,
      });
    }
    return true;
  }

  findSpawnSite(): SpawnSite {
    return this.generator.findSpawnSite();
  }

  /** Altitude du sol : la seule vérité pour poser une entité au sol. */
  heightAt(x: number, z: number): number {
    return this.generator.sampler.sampleHeight(x, z);
  }

  /** Pente normalisée du terrain en un point, dans [0, 1]. */
  slopeAt(x: number, z: number): number {
    return this.generator.sampler.sampleSlope(x, z);
  }

  isWalkable(x: number, z: number): boolean {
    return this.generator.bounds.contains(x, z) && this.generator.sampler.isTerrainWalkable(x, z);
  }

  toDescriptor(): WorldDescriptor {
    return {
      worldId: this.worldId,
      seed: this.seed,
      sizeMeters: this.sizeMeters,
      chunkSizeMeters: this.chunkSizeMeters,
    };
  }
}
