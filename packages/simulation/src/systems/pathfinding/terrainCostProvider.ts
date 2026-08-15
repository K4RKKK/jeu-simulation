import type { CostMemo, TileCostProvider } from '@civ/pathfinding';
import type { PathfindingConfig } from '../../config/simulationConfig.js';
import type { World } from '../../world/world.js';

/**
 * Traduit le terrain procédural en coûts de déplacement (CLAUDE.md règle 5 : aucun
 * littéral d'équilibrage — les seuils de pente et les coûts viennent de la config).
 *
 * La praticabilité reprend exactement la définition du monde (`walkability` de la
 * génération : pente maximale, profondeur d'eau maximale, et profondeur guéable du plan
 * d'eau lui-même). Au-dessus de cette vérité, la simulation ajoute des coûts relatifs :
 * plat < pente facile < pente difficile < gué. Une pente infranchissable, une eau trop
 * profonde et le hors-monde sont `null` : l'A* n'y entre jamais.
 *
 * Le contrat du `TileCostProvider` : les coordonnées reçues sont des **indices de tuile**,
 * pas des mètres. Il faut donc les convertir au centre monde de la tuile avant tout
 * échantillonnage du terrain (`(tx + 0.5) * tileSize`). Un bug corrigé : auparavant, ces
 * indices étaient passés tels quels à `sampleHeight/sampleSlope/contains`, ce qui faisait
 * examiner un point 100× plus près du centre du monde que la tuile ciblée.
 *
 * Le `PathfindingSystem` lui fournit une mémo bornée partagée entre les recherches. C'est
 * exact parce que terrain et hydrologie sont immuables pendant une partie ; les sentiers
 * et ressources dynamiques ne participent pas au coût de navigation.
 */
export function terrainTileCostProvider(world: World, config: PathfindingConfig): TileCostProvider {
  const { costs } = config;
  const walkability = world.terrain.config.walkability;
  const sampler = world.terrain;
  const tileSize = config.tileSizeMeters;
  const half = tileSize / 2;

  return {
    tileCost(tx: number, tz: number, _memo): number | null {
      const xM = tx * tileSize + half;
      const zM = tz * tileSize + half;
      let value: number | null;
      if (!world.bounds.contains(xM, zM)) {
        value = null;
      } else {
        const height = sampler.sampleHeight(xM, zM);
        const slope = sampler.sampleSlope(xM, zM);
        if (slope > walkability.maxSlope01) {
          value = null;
        } else {
          const water = world.hydrology.sampleWater(xM, zM, height);
          if (water !== null) {
            const limit = Math.min(walkability.maxWaterDepthMeters, water.body.wadeableDepthM);
            value = water.depthM > limit ? null : costs.waterWalkCost;
          } else if (slope > costs.steepSlopeThreshold01) {
            value = costs.steepCost;
          } else if (slope > costs.gentleSlopeThreshold01) {
            value = costs.gentleCost;
          } else {
            value = costs.flatCost;
          }
        }
      }

      return value;
    },
  };
}

/** Cache FIFO borné : une éviction ne change jamais le résultat, seulement un recalcul futur. */
export function createTerrainCostMemo(capacity: number): CostMemo {
  const limit = Math.max(0, Math.floor(capacity));
  return new (class extends Map<string, number | null> {
    override set(key: string, value: number | null): this {
      if (limit === 0) return this;
      super.set(key, value);
      if (this.size > limit) {
        const oldest = this.keys().next().value;
        if (oldest !== undefined) this.delete(oldest);
      }
      return this;
    }
  })();
}
