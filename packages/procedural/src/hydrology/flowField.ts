import type { CoarseGrid } from './coarseGrid.js';
import { NEIGHBOR_OFFSETS } from './coarseGrid.js';

export interface FlowField {
  /** Indice de la cellule vers laquelle s'écoule chaque cellule ; -1 si elle sort du monde. */
  readonly downstream: Int32Array;
  /** Nombre de cellules drainées, cellule courante comprise. */
  readonly accumulation: Float64Array;
}

/**
 * Direction d'écoulement (D8) et accumulation.
 *
 * L'eau part vers le voisin qui offre la plus forte pente descendante ; on divise par la
 * distance réelle pour ne pas privilégier les diagonales, plus longues. Calculé sur
 * l'altitude *remplie* : celle-ci garantit qu'un chemin descendant existe toujours, donc
 * qu'aucune rivière ne se termine dans le vide.
 *
 * L'accumulation se propage en traitant les cellules de la plus haute à la plus basse : à
 * l'instant où une cellule est traitée, tout ce qui l'alimente l'a déjà été. C'est ce qui
 * rend le calcul exact en une seule passe, sans itération de convergence.
 */
export function computeFlowField(grid: CoarseGrid, filled: Float64Array): FlowField {
  const cellCount = grid.cellCount;
  const downstream = new Int32Array(cellCount).fill(-1);

  for (let row = 0; row < grid.height; row++) {
    for (let column = 0; column < grid.width; column++) {
      const index = grid.index(column, row);
      // Les bords évacuent hors du monde : ils n'ont pas d'aval interne.
      if (grid.isBoundary(column, row)) continue;

      const level = filled[index] as number;
      let bestSlope = 0;
      let bestNeighbor = -1;

      for (const [dx, dz] of NEIGHBOR_OFFSETS) {
        const neighbor = grid.index(column + dx, row + dz);
        const drop = level - (filled[neighbor] as number);
        if (drop <= 0) continue;
        const distance = dx !== 0 && dz !== 0 ? Math.SQRT2 : 1;
        const slope = drop / distance;
        // `>` strict : à pente égale, le premier voisin de la liste gagne. L'ordre des
        // décalages étant fixe, le résultat est reproductible.
        if (slope > bestSlope) {
          bestSlope = slope;
          bestNeighbor = neighbor;
        }
      }
      downstream[index] = bestNeighbor;
    }
  }

  const order = new Int32Array(cellCount);
  for (let i = 0; i < cellCount; i++) order[i] = i;
  // Tri décroissant par altitude remplie, départagé par indice pour rester déterministe.
  const sorted = Array.from(order).sort((a, b) => {
    const fa = filled[a] as number;
    const fb = filled[b] as number;
    return fa === fb ? a - b : fb - fa;
  });

  const accumulation = new Float64Array(cellCount).fill(1);
  for (const index of sorted) {
    const target = downstream[index] as number;
    if (target >= 0)
      accumulation[target] = (accumulation[target] as number) + (accumulation[index] as number);
  }

  return { downstream, accumulation };
}
