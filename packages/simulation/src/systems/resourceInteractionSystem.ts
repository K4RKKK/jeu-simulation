import { InteractiveResource, NeedsState } from '../components/index.js';
import type { SystemFrequency } from '../config/simulationConfig.js';
import type { SimulationSystem, SystemUpdateContext } from '../core/system.js';

/**
 * Filet de sécurité du cycle Static → Interactive → Static.
 *
 * Le chemin normal libère la ressource au commit de `gatherFood`. Ce système
 * retire aussi les acteurs morts, supprimés ou dont le plan a été interrompu, afin
 * qu'aucune coquille interactive ne puisse rester vivante indéfiniment.
 */
export class ResourceInteractionSystem implements SimulationSystem {
  readonly name = 'ResourceInteractionSystem';
  readonly frequency: SystemFrequency = 'medium';

  update(ctx: SystemUpdateContext): void {
    const toDemote: number[] = [];
    ctx.entities.each([InteractiveResource], (entity, resource) => {
      resource.interactingEntityIds = resource.interactingEntityIds.filter((actor) => {
        if (!ctx.entities.exists(actor)) return false;
        const state = ctx.entities.getComponent(actor, NeedsState);
        return state?.action === 'gatherFood' && state.resourceId === resource.resourceId;
      });
      if (resource.interactingEntityIds.length === 0) toDemote.push(entity);
    });
    for (const entity of toDemote) ctx.entities.destroyEntity(entity);
  }
}
