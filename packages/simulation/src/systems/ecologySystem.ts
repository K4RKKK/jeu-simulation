import { hashString, parseChunkKey } from '@civ/procedural';
import type { SystemFrequency } from '../config/simulationConfig.js';
import type { SimulationSystem, SystemUpdateContext } from '../core/system.js';

/** Repousse bornée des ressources épuisées, pilotée par l'état régional réel. */
export class EcologySystem implements SimulationSystem {
  readonly name = 'EcologySystem';
  readonly frequency: SystemFrequency = 'verySlow';

  update(ctx: SystemUpdateContext): void {
    const maxRegrowth = Math.max(0, Math.floor(ctx.config.ecology.maxRegrowthPerUpdate));
    const candidates = [...ctx.world.delta.entries()]
      .map(([, delta]) => delta)
      .filter(
        (delta) =>
          delta.state === 'depleted' ||
          (delta.state === 'modified' &&
            typeof delta.changedFields.remainingFraction01 === 'number' &&
            delta.changedFields.remainingFraction01 < 1),
      )
      .sort(
        (a, b) =>
          a.lastModifiedTick - b.lastModifiedTick || a.resourceId.localeCompare(b.resourceId),
      );
    let restored = 0;
    const ecologyByRegion = new Map<string, ReturnType<typeof ctx.world.ecology.sample>>();
    for (const delta of candidates) {
      if (restored >= maxRegrowth) break;
      if (ctx.tick < this.eligibleTick(ctx, delta.resourceId, delta.lastModifiedTick)) continue;
      const spawn = ctx.world.findBaseResourceById(delta.resourceId, delta.ownerChunkKey);
      if (!spawn) continue;
      const owner = parseChunkKey(delta.ownerChunkKey);
      const chunkSize = ctx.world.generator.config.layout.chunkSizeMeters;
      const coordinate = ctx.world.regionAt(
        (owner.x + 0.5) * chunkSize,
        (owner.z + 0.5) * chunkSize,
      );
      const regionKey = `${coordinate.x},${coordinate.z}`;
      let ecology = ecologyByRegion.get(regionKey);
      if (!ecology) {
        ecology = ctx.world.ecology.sample(coordinate, ctx.entities);
        ecologyByRegion.set(regionKey, ecology);
      }
      if (ecology.growthPotential01 < ctx.config.ecology.minGrowthPotential01) continue;
      if (ctx.world.regrowResource(delta.resourceId, ctx.tick)) restored++;
    }
  }

  private eligibleTick(
    ctx: SystemUpdateContext,
    resourceId: string,
    depletedAtTick: number,
  ): number {
    const config = ctx.config.ecology;
    const unit = hashString(resourceId) / 0x100000000;
    const minDays = Math.max(0, config.minRegrowthDays);
    const maxDays = Math.max(minDays, config.maxRegrowthDays);
    const days = minDays + (maxDays - minDays) * unit;
    const seconds = days * ctx.config.time.hoursPerDay * 3600;
    return depletedAtTick + Math.ceil(seconds / ctx.config.time.gameSecondsPerTick);
  }
}
