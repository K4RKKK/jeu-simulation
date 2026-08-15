import type { WorldGenerationConfig } from '../config/worldGenerationConfig.js';
import { CoarseGrid } from './coarseGrid.js';
import { computeFlowField } from './flowField.js';
import { fillDepressions } from './priorityFlood.js';
import type { ElevationGenerator } from '../terrain/elevationGenerator.js';

export interface DrainageResult {
  grid: CoarseGrid;
  base: Float64Array;
  flow: ReturnType<typeof computeFlowField>;
  flooded: Uint8Array;
  filled: Float64Array;
}

/**
 * Phase 1 de l'hydrologie : structure physique du drainage.
 *
 * On échantillonne le relief sur la grille grossière, on remplit les cuvettes (sans elles,
 * le champ de flux rencontre des minima locaux et s'arrête), puis on calcule la direction
 * et l'accumulation du flux dans chaque cellule. Le résultat est une vue brute du bassin
 * versant — à ce stade, aucune eau n'est encore visible.
 */
export function computeDrainage(
  grid: CoarseGrid,
  elevation: ElevationGenerator,
): DrainageResult {
  const base = sampleElevationGrid(grid, elevation);
  const { filled, flooded } = fillDepressions(grid, base);
  const flow = computeFlowField(grid, filled);
  return { grid, base, flow, flooded, filled };
}

export function buildCoarseGrid(
  bounds: { halfSizeMeters: number; sizeMeters: number },
  hydrology: WorldGenerationConfig['hydrology'],
): CoarseGrid {
  return new CoarseGrid(
    -bounds.halfSizeMeters,
    -bounds.halfSizeMeters,
    bounds.sizeMeters,
    hydrology.coarseCellMeters,
  );
}

function sampleElevationGrid(grid: CoarseGrid, elevation: ElevationGenerator): Float64Array {
  const values = new Float64Array(grid.cellCount);
  for (let row = 0; row < grid.height; row++) {
    for (let column = 0; column < grid.width; column++) {
      values[grid.index(column, row)] = elevation.base01(grid.centerX(column), grid.centerZ(row));
    }
  }
  return values;
}
