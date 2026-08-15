import type { CoarseGrid } from './coarseGrid.js';

/** Coût diagonal du chanfrein 3-4, exprimé par rapport au coût orthogonal. */
const ORTHOGONAL = 1;
const DIAGONAL = Math.SQRT2;

/**
 * Distance à l'eau la plus proche, en mètres.
 *
 * Chanfrein en deux passes (avant puis arrière) : deux parcours suffisent pour propager la
 * distance dans toute la grille, là où une recherche exacte par cellule serait quadratique.
 * L'approximation par le voisinage 8 reste sous 4 % d'erreur, très en deçà de la
 * granularité de la grille.
 *
 * Cette distance alimente l'humidité, les biomes de bord d'eau et la recherche d'un site de
 * campement viable.
 */
export function computeDistanceTransform(
  grid: CoarseGrid,
  mask: Uint8Array,
  cellMeters: number,
): Float32Array {
  const distance = new Float32Array(grid.cellCount);
  const infinity = grid.width * grid.height;

  for (let i = 0; i < grid.cellCount; i++) {
    distance[i] = mask[i] === 1 ? 0 : infinity;
  }

  const relax = (index: number, fromIndex: number, cost: number): void => {
    const candidate = (distance[fromIndex] as number) + cost;
    if (candidate < (distance[index] as number)) distance[index] = candidate;
  };

  for (let row = 0; row < grid.height; row++) {
    for (let column = 0; column < grid.width; column++) {
      const index = grid.index(column, row);
      if (row > 0) {
        relax(index, grid.index(column, row - 1), ORTHOGONAL);
        if (column > 0) relax(index, grid.index(column - 1, row - 1), DIAGONAL);
        if (column < grid.width - 1) relax(index, grid.index(column + 1, row - 1), DIAGONAL);
      }
      if (column > 0) relax(index, grid.index(column - 1, row), ORTHOGONAL);
    }
  }

  for (let row = grid.height - 1; row >= 0; row--) {
    for (let column = grid.width - 1; column >= 0; column--) {
      const index = grid.index(column, row);
      if (row < grid.height - 1) {
        relax(index, grid.index(column, row + 1), ORTHOGONAL);
        if (column > 0) relax(index, grid.index(column - 1, row + 1), DIAGONAL);
        if (column < grid.width - 1) relax(index, grid.index(column + 1, row + 1), DIAGONAL);
      }
      if (column < grid.width - 1) relax(index, grid.index(column + 1, row), ORTHOGONAL);
    }
  }

  for (let i = 0; i < grid.cellCount; i++) {
    distance[i] = (distance[i] as number) * cellMeters;
  }
  return distance;
}
