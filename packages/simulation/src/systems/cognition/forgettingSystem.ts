import { CognitiveMemory } from '../../components/index.js';
import { decaySpatialMemory } from '../../cognition/spatialMemoryModel.js';
import type { SystemFrequency } from '../../config/simulationConfig.js';
import type { SimulationSystem, SystemUpdateContext } from '../../core/system.js';

/**
 * Fait vieillir la mémoire cognitive : un souvenir spatial non revu perd en confiance et
 * en précision, jusqu'à disparaître (voir `decaySpatialMemory`, CLAUDE.md règle 8 —
 * logique pure, testable sans ECS).
 *
 * Fréquence `verySlow` (P3.16 : « Forgetting → slow / verySlow », jamais un balayage à
 * chaque tick rapide). Le calcul reste exact quelle que soit la fréquence effective de
 * cette passe : `decaySpatialMemory` recalcule `confidence01`/`precisionM` comme une
 * fonction ABSOLUE du temps écoulé depuis `lastSeenTick`, jamais un décrément cumulatif
 * par passe — voir la doc de `CognitionConfig`.
 *
 * Ne traite que `CognitiveMemory.spatial` : `episodic`/`social` restent vides tant
 * qu'aucun système ne les remplit (Phase 3.3 pour `episodic`, 3.8 pour `social`) — les
 * faire « vieillir » avant qu'ils contiennent quoi que ce soit n'aurait aucun sens
 * observable, et ajouterait du code sans consommateur réel.
 */
export class ForgettingSystem implements SimulationSystem {
  readonly name = 'ForgettingSystem';
  readonly frequency: SystemFrequency = 'verySlow';

  update(ctx: SystemUpdateContext): void {
    const config = ctx.config.cognition;
    const gameSecondsPerTick = ctx.clock.gameSecondsPerTick;
    ctx.entities.each([CognitiveMemory], (_entity, memory) => {
      decaySpatialMemory(memory, ctx.tick, gameSecondsPerTick, config);
    });
  }
}
