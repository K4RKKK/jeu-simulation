import type { ResourceSpawn } from '@civ/procedural';
import { CognitiveMemory, Memory, Transform } from '../../components/index.js';
import type {
  CognitiveMemoryComponent,
  MemoryComponent,
  TransformComponent,
} from '../../components/index.js';
import type { SystemFrequency } from '../../config/simulationConfig.js';
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
 * - **La nourriture** se repère de près : les chunks couverts par le rayon de vision sont
 *   relus — via le cache du monde, seule une entrée de chunk nouvellement découverte paie
 *   la génération — et leurs ressources comestibles sont mémorisées. Leur toxicité, elle,
 *   n'entre jamais en mémoire : elle se découvre en mangeant.
 *
 * Rien n'est tiré au hasard ici : les scans sont des fonctions déterministes de la
 * position et du tick. Le travail est réparti en cohortes stables sur l'ancien intervalle
 * `medium` : chaque individu conserve la même cadence maximale de perception, mais le
 * serveur n'examine plus toute la population dans le même tick.
 *
 * Depuis la Phase 3.2, chaque scan écrit AUSSI dans `CognitiveMemory.spatial` (mémoire
 * générique, voir `cognition/spatialMemoryModel.ts`) — même donnée perçue, deux
 * représentations en parallèle. `NeedSatisfactionSystem` continue de décider depuis
 * `Memory` (ci-dessus), pas encore de `CognitiveMemory` : migration progressive
 * délibérée (P3.21), la bascule attend l'Utility AI (3.4+).
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

    // Plusieurs humains proches relisent souvent les mêmes chunks pendant ce tick. Le
    // monde cache déjà la génération, mais filtrer les ressources et tester leur terrain
    // restait refait pour chacun. Ce cache ne vit que pendant l'update : il ne peut donc
    // jamais masquer une mutation effectuée par un autre système au tick suivant.
    const edibleByChunk = new Map<string, readonly ResourceSpawn[]>();

    ctx.entities.each(
      [Transform, Memory, CognitiveMemory],
      (entity, transform, memory, cognitiveMemory) => {
        if (positiveModulo(entity - 1, cadenceTicks) !== activePhase) return;
        this.perceiveWater(ctx, transform, memory, memoryConfig, cognitiveMemory);
        this.perceiveFood(ctx, transform, memory, memoryConfig, edibleByChunk, cognitiveMemory);
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
      rememberSpatial(
        cognitiveMemory,
        { kind: 'water', x: point.x, z: point.z, source: 'selfExperience' },
        ctx.tick,
        ctx.config.cognition,
      );
    }
  }

  private perceiveFood(
    ctx: SystemUpdateContext,
    transform: TransformComponent,
    memory: MemoryComponent,
    config: PerceptionMemoryConfig,
    edibleByChunk: Map<string, readonly ResourceSpawn[]>,
    cognitiveMemory: CognitiveMemoryComponent,
  ): void {
    // Bug corrigé : rescanner au changement de CHUNK plutôt qu'à la distance parcourue
    // laissait un individu « aveugle » à toute nourriture entrée dans son rayon de
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
        let edible = edibleByChunk.get(key);
        if (edible === undefined) {
          edible = ctx.world
            .generateChunk({ x: cx, z: cz })
            .resources.filter(
              (spawn) => spawn.foodKcal > 0 && ctx.world.isWalkable(spawn.x, spawn.z),
            );
          edibleByChunk.set(key, edible);
        }
        for (const spawn of edible) {
          const dx = spawn.x - transform.x;
          const dz = spawn.z - transform.z;
          if (dx * dx + dz * dz > radiusSquared) continue;
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
          // `subjectConceptId = definitionId` : le type perçu (« ceci est un buisson à
          // baies ») sert directement de concept — pas de taxonomie séparée à inventer
          // pour la Phase 3.2, `definitionId` joue déjà ce rôle dans l'ancienne mémoire
          // (voir la doc de `FoodMemoryEntry.definitionId`). `worldRef` est la référence
          // technique pour revalider l'objet, jamais une connaissance en soi.
          rememberSpatial(
            cognitiveMemory,
            {
              kind: 'resource',
              x: spawn.x,
              z: spawn.z,
              subjectConceptId: spawn.definitionId,
              worldRef: {
                type: 'resource',
                resourceId: spawn.id,
                ownerChunkKey: spawn.ownerChunkKey,
                localId: spawn.localId,
              },
              source: 'selfExperience',
            },
            ctx.tick,
            ctx.config.cognition,
          );
        }
      }
    }
  }
}

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}
