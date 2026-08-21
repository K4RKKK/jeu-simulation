import type { ResourceSpawn } from '@civ/procedural';
import { CognitiveMemory, Memory, Transform } from '../../components/index.js';
import type {
  CognitiveMemoryComponent,
  MemoryComponent,
  TransformComponent,
} from '../../components/index.js';
import type { SystemFrequency } from '../../config/simulationConfig.js';
import { observeResource, observeShore } from '../../cognition/observationBuilder.js';
import { rememberSpatial } from '../../cognition/spatialMemoryModel.js';
import { distance2D } from '../../core/math.js';
import type { SimulationSystem, SystemUpdateContext } from '../../core/system.js';
import {
  rememberFood,
  rememberWater,
  scanForShorePoint,
  type PerceptionMemoryConfig,
} from './perceptionModel.js';

/**
 * Ce que l'individu voit, il se le rappelle — et rien d'autre (CLAUDE.md « Aucune
 * connaissance globale »). Ce système est la seule porte d'entrée du savoir spatial :
 * il remplace les recherches omniscientes par des souvenirs individuels.
 *
 * Deux sens, deux coûts :
 *
 * - **La rive** se voit de loin : une spirale déterministe autour de la position, relancée
 *   seulement après un déplacement suffisant (rester debout ne révèle rien de nouveau).
 * - **Les ressources** se repèrent de près : les chunks couverts par le rayon de vision sont
 *   relus — via le cache du monde, seule une entrée de chunk nouvellement découverte paie
 *   la génération — et TOUT individu praticable y est perçu, alimentaire ou non (voir
 *   Phase 3.2 ci-dessous). Toxicité et kcal exacts n'entrent jamais en mémoire : ils se
 *   découvrent en mangeant.
 *
 * Rien n'est tiré au hasard ici : les scans sont des fonctions déterministes de la
 * position et du tick. Le travail est réparti en cohortes stables sur l'ancien intervalle
 * `medium` : chaque individu conserve la même cadence maximale de perception, mais le
 * serveur n'examine plus toute la population dans le même tick.
 *
 * Depuis la Phase 3.2, chaque scan produit AUSSI une `Observation` (voir
 * `cognition/observationBuilder.ts`) écrite dans `CognitiveMemory.spatial` — même scan,
 * deux représentations en parallèle. Bug corrigé après relecture (Phase 3.2, correction
 * immédiate) : la première version ne mémorisait dans `CognitiveMemory` que les
 * ressources dont `foodKcal > 0`, et utilisait `definitionId` (une vérité moteur) comme
 * concept perçu — de l'omniscience déguisée en mémoire cognitive. Une pierre, du silex
 * ou une branche visibles doivent entrer dans `CognitiveMemory` au même titre qu'un
 * buisson à baies ; seul l'ancien `Memory.food` (ci-dessous) reste filtré sur le
 * comestible, car c'est tout ce que `NeedSatisfactionSystem` sait consommer aujourd'hui.
 * `subjectConceptId` vient de `ResourceSpawn.perceptualConceptId` (apparence projetée
 * depuis `content`), jamais de `definitionId` directement. `NeedSatisfactionSystem`
 * continue de décider depuis `Memory`, pas encore de `CognitiveMemory` : migration
 * progressive délibérée (P3.21), la bascule attend l'Utility AI (3.4+).
 */
export class PerceptionSystem implements SimulationSystem {
  readonly name = 'PerceptionSystem';
  readonly frequency: SystemFrequency = 'fast';

  update(ctx: SystemUpdateContext): void {
    const cfg = ctx.config.perception;
    const memoryConfig: PerceptionMemoryConfig = {
      foodMemoryTtlTicks: Math.ceil(cfg.foodMemoryTtlSeconds / ctx.clock.gameSecondsPerTick),
      waterMemoryTtlTicks: Math.ceil(cfg.waterMemoryTtlSeconds / ctx.clock.gameSecondsPerTick),
      maxFoodEntries: cfg.maxFoodEntries,
      maxWaterEntries: cfg.maxWaterEntries,
    };

    // On conserve le débit historique (chaque humain tous les N ticks), mais on lisse la
    // charge en affectant chaque id à une phase stable. Les trous laissés par les morts ne
    // décalent donc jamais les autres humains, et une sauvegarde reprend le même planning.
    const cadenceTicks = Math.max(1, ctx.config.scheduler.intervals.medium);
    const activePhase = positiveModulo(ctx.tick - 1, cadenceTicks);

    // Deux caches qui ne vivent que pendant l'update (jamais de masquage de mutations
    // d'un tick à l'autre) :
    // - `memorableByChunk` : toutes les ressources mémorables d'un chunk (rememberable =
    //   interactive), sans filtre de praticabilité — un humain peut voir une baie sur une
    //   pente inaccessible et en garder un souvenir cognitif. Alimente `CognitiveMemory`.
    // - `walkableByChunk` : sous-ensemble praticable (`isWalkable`). Alimente `Memory.food`
    //   pour que `NeedSatisfactionSystem` ne planifie pas d'aller manger un objet hors d'atteinte.
    const memorableByChunk = new Map<string, readonly ResourceSpawn[]>();
    const walkableByChunk = new Map<string, readonly ResourceSpawn[]>();

    ctx.entities.each(
      [Transform, Memory, CognitiveMemory],
      (entity, transform, memory, cognitiveMemory) => {
        if (positiveModulo(entity - 1, cadenceTicks) !== activePhase) return;
        this.perceiveWater(ctx, transform, memory, memoryConfig, cognitiveMemory);
        this.perceiveResources(
          ctx,
          transform,
          memory,
          memoryConfig,
          memorableByChunk,
          walkableByChunk,
          cognitiveMemory,
        );
      },
    );
  }

  private perceiveWater(
    ctx: SystemUpdateContext,
    transform: TransformComponent,
    memory: MemoryComponent,
    config: PerceptionMemoryConfig,
    cognitiveMemory: CognitiveMemoryComponent,
  ): void {
    const movedEnough =
      memory.lastWaterScanX === null ||
      memory.lastWaterScanZ === null ||
      distance2D(transform.x, transform.z, memory.lastWaterScanX, memory.lastWaterScanZ) >=
        ctx.config.perception.waterRescanMoveThresholdM;
    if (!movedEnough) return;

    memory.lastWaterScanX = transform.x;
    memory.lastWaterScanZ = transform.z;

    const perception = ctx.config.perception;
    const point = scanForShorePoint(
      transform.x,
      transform.z,
      perception.visionRangeM,
      perception.waterScanStepM,
      ctx.config.needs.search.drinkShoreDistanceM,
      (x, z) => ctx.world.isWalkable(x, z),
      (x, z) => ctx.world.hydrology.distanceToWaterMeters(x, z),
    );
    if (point) {
      rememberWater(memory, point, ctx.tick, config);
      // Écrit EN PLUS dans la mémoire cognitive générique (Phase 3.2) — même scan, pas
      // de travail dupliqué. `Memory` (ci-dessus) reste la seule source consultée par
      // `NeedSatisfactionSystem` jusqu'à ce que l'Utility AI (3.4+) bascule sur celle-ci ;
      // coexistence délibérée, voir la doc de `CognitiveMemoryComponent`.
      rememberSpatial(cognitiveMemory, observeShore(point, ctx.tick), ctx.config.cognition);
    }
  }

  private perceiveResources(
    ctx: SystemUpdateContext,
    transform: TransformComponent,
    memory: MemoryComponent,
    config: PerceptionMemoryConfig,
    memorableByChunk: Map<string, readonly ResourceSpawn[]>,
    walkableByChunk: Map<string, readonly ResourceSpawn[]>,
    cognitiveMemory: CognitiveMemoryComponent,
  ): void {
    // Bug corrigé : rescanner au changement de CHUNK plutôt qu'à la distance parcourue
    // laissait un individu « aveugle » à toute ressource entrée dans son rayon de
    // vision tant qu'il n'avait pas franchi une frontière de chunk — jusqu'à la
    // diagonale entière d'un chunk (~90 m avec les valeurs par défaut) pour un rayon de
    // vision de 32 m. Même gate que `perceiveWater`, par cohérence et correction.
    const movedEnough =
      memory.lastFoodScanX === null ||
      memory.lastFoodScanZ === null ||
      distance2D(transform.x, transform.z, memory.lastFoodScanX, memory.lastFoodScanZ) >=
        ctx.config.perception.foodRescanMoveThresholdM;
    if (!movedEnough) return;

    memory.lastFoodScanX = transform.x;
    memory.lastFoodScanZ = transform.z;

    const radiusM = ctx.config.perception.visionRangeM;
    const chunkSize = ctx.world.chunkSizeMeters;
    const minX = Math.floor((transform.x - radiusM) / chunkSize);
    const maxX = Math.floor((transform.x + radiusM) / chunkSize);
    const minZ = Math.floor((transform.z - radiusM) / chunkSize);
    const maxZ = Math.floor((transform.z + radiusM) / chunkSize);
    const radiusSquared = radiusM * radiusM;

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        if (!ctx.world.bounds.containsChunk({ x: cx, z: cz })) continue;
        const key = `${cx}:${cz}`;

        // Cache mémorable : ressources `rememberable` (= interactive), sans filtre de
        // praticabilité — la vue n'exige pas que le chemin existe.
        let memorable = memorableByChunk.get(key);
        if (memorable === undefined) {
          memorable = ctx.world
            .generateChunk({ x: cx, z: cz })
            .resources.filter((s) => s.rememberable);
          memorableByChunk.set(key, memorable);
        }

        // Cache praticable : sous-ensemble pour `Memory.food` seulement, afin que
        // `NeedSatisfactionSystem` ne planifie pas un trajet vers un objet hors d'atteinte.
        let walkable = walkableByChunk.get(key);
        if (walkable === undefined) {
          walkable = memorable.filter((s) => ctx.world.isWalkable(s.x, s.z));
          walkableByChunk.set(key, walkable);
        }

        for (const spawn of memorable) {
          const dx = spawn.x - transform.x;
          const dz = spawn.z - transform.z;
          if (dx * dx + dz * dz > radiusSquared) continue;

          rememberSpatial(cognitiveMemory, observeResource(spawn, ctx.tick), ctx.config.cognition);
        }

        for (const spawn of walkable) {
          const dx = spawn.x - transform.x;
          const dz = spawn.z - transform.z;
          if (dx * dx + dz * dz > radiusSquared) continue;

          // Ancienne mémoire nourriture (`NeedSatisfactionSystem`) : filtrée sur le
          // comestible et la praticabilité, inchangée.
          if (spawn.foodKcal > 0) {
            rememberFood(
              memory,
              {
                resourceId: spawn.id,
                definitionId: spawn.definitionId,
                ownerChunkKey: spawn.ownerChunkKey,
                localId: spawn.localId,
                x: spawn.x,
                z: spawn.z,
                foodKcal: spawn.foodKcal,
              },
              ctx.tick,
              config,
            );
          }
        }
      }
    }
  }
}

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}
