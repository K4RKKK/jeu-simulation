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
import { scanForShorePoint } from './perceptionModel.js';

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
 *   la génération — et TOUT individu mémorable y est perçu, alimentaire ou non
 *   (`rememberable = interactive`). La praticabilité n'est PAS filtrée ici : la vue
 *   n'exige pas que le chemin existe. `NeedSatisfactionSystem` refera la vérification
 *   d'atteignabilité au moment de choisir sa cible.
 *
 * Rien n'est tiré au hasard ici : les scans sont des fonctions déterministes de la
 * position et du tick. Le travail est réparti en cohortes stables sur l'ancien intervalle
 * `medium` : chaque individu conserve la même cadence maximale de perception, mais le
 * serveur n'examine plus toute la population dans le même tick.
 *
 * Depuis la Phase 3.5, chaque scan produit UNIQUEMENT une `Observation` (voir
 * `cognition/observationBuilder.ts`) écrite dans `CognitiveMemory.spatial`. L'ancien
 * `Memory.food`/`Memory.water` (index étroit) n'est plus alimenté — `NeedSatisfactionSystem`
 * décide directement depuis `CognitiveMemory` (voir la doc de `NeedSatisfactionSystem`).
 * `MemoryComponent` reste utilisé pour les positions du DERNIER scan (`lastFoodScanX/Z`,
 * `lastWaterScanX/Z`), qui pilotent le seuil de rescan.
 *
 * `subjectConceptId` vient de `ResourceSpawn.perceptualConceptId` (apparence projetée
 * depuis `content`), jamais de `definitionId` directement — la cognition ne doit pas
 * connaître les identités moteur.
 */
export class PerceptionSystem implements SimulationSystem {
  readonly name = 'PerceptionSystem';
  readonly frequency: SystemFrequency = 'fast';

  update(ctx: SystemUpdateContext): void {
    // On conserve le débit historique (chaque humain tous les N ticks), mais on lisse la
    // charge en affectant chaque id à une phase stable. Les trous laissés par les morts ne
    // décalent donc jamais les autres humains, et une sauvegarde reprend le même planning.
    const cadenceTicks = Math.max(1, ctx.config.scheduler.intervals.medium);
    const activePhase = positiveModulo(ctx.tick - 1, cadenceTicks);

    // Cache éphémère (jamais d'un tick à l'autre) : la liste des ressources `rememberable`
    // par chunk, partagée par les humains d'un même tick pour éviter les filter() répétés.
    const memorableByChunk = new Map<string, readonly ResourceSpawn[]>();

    ctx.entities.each(
      [Transform, Memory, CognitiveMemory],
      (entity, transform, memory, cognitiveMemory) => {
        if (positiveModulo(entity - 1, cadenceTicks) !== activePhase) return;
        this.perceiveWater(ctx, transform, memory, cognitiveMemory);
        this.perceiveResources(ctx, transform, memory, memorableByChunk, cognitiveMemory);
      },
    );
  }

  private perceiveWater(
    ctx: SystemUpdateContext,
    transform: TransformComponent,
    memory: MemoryComponent,
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
      rememberSpatial(cognitiveMemory, observeShore(point, ctx.tick), ctx.config.cognition);
    }
  }

  private perceiveResources(
    ctx: SystemUpdateContext,
    transform: TransformComponent,
    memory: MemoryComponent,
    memorableByChunk: Map<string, readonly ResourceSpawn[]>,
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

        let memorable = memorableByChunk.get(key);
        if (memorable === undefined) {
          memorable = ctx.world
            .generateChunk({ x: cx, z: cz })
            .resources.filter((s) => s.rememberable);
          memorableByChunk.set(key, memorable);
        }

        for (const spawn of memorable) {
          const dx = spawn.x - transform.x;
          const dz = spawn.z - transform.z;
          if (dx * dx + dz * dz > radiusSquared) continue;

          rememberSpatial(cognitiveMemory, observeResource(spawn, ctx.tick), ctx.config.cognition);
        }
      }
    }
  }
}

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}
