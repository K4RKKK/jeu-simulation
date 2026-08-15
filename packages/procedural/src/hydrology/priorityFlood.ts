import type { CoarseGrid } from './coarseGrid.js';
import { NEIGHBOR_OFFSETS } from './coarseGrid.js';

/**
 * Tas binaire minimal (priorité, indice).
 *
 * Écrit à la main plutôt qu'importé : la file de priorité doit trier de façon strictement
 * déterministe. En cas d'égalité de priorité, on départage par indice de cellule, sinon
 * deux exécutions pourraient remplir les dépressions dans un ordre différent.
 */
class MinHeap {
  private readonly priorities: number[] = [];
  private readonly values: number[] = [];

  get size(): number {
    return this.values.length;
  }

  push(priority: number, value: number): void {
    this.priorities.push(priority);
    this.values.push(value);
    this.bubbleUp(this.values.length - 1);
  }

  pop(): { priority: number; value: number } | undefined {
    if (this.values.length === 0) return undefined;
    const priority = this.priorities[0] as number;
    const value = this.values[0] as number;

    const lastPriority = this.priorities.pop() as number;
    const lastValue = this.values.pop() as number;
    if (this.values.length > 0) {
      this.priorities[0] = lastPriority;
      this.values[0] = lastValue;
      this.bubbleDown(0);
    }
    return { priority, value };
  }

  private isBefore(a: number, b: number): boolean {
    const pa = this.priorities[a] as number;
    const pb = this.priorities[b] as number;
    if (pa !== pb) return pa < pb;
    return (this.values[a] as number) < (this.values[b] as number);
  }

  private swap(a: number, b: number): void {
    const p = this.priorities[a] as number;
    const v = this.values[a] as number;
    this.priorities[a] = this.priorities[b] as number;
    this.values[a] = this.values[b] as number;
    this.priorities[b] = p;
    this.values[b] = v;
  }

  private bubbleUp(start: number): void {
    let index = start;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.isBefore(index, parent)) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  private bubbleDown(start: number): void {
    let index = start;
    const length = this.values.length;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < length && this.isBefore(left, smallest)) smallest = left;
      if (right < length && this.isBefore(right, smallest)) smallest = right;
      if (smallest === index) break;
      this.swap(index, smallest);
      index = smallest;
    }
  }
}

/**
 * Remplissage des dépressions (Priority-Flood + ε).
 *
 * Deux résultats en un seul parcours :
 *
 * 1. **Les cuvettes sont comblées** jusqu'à l'altitude de leur exutoire — c'est exactement
 *    l'endroit où un lac se forme naturellement.
 * 2. **Aucun plat ne subsiste** : chaque cellule reçoit une altitude strictement supérieure
 *    à celle par laquelle l'eau l'a atteinte. Sans cet ε, les plateaux issus du remplissage
 *    n'auraient pas de direction d'écoulement et les rivières s'y arrêteraient net.
 *
 * L'eau sort par les bords du monde : les cellules de bordure amorcent le parcours.
 */
export interface FilledTerrain {
  readonly filled: Float64Array;
  /**
   * Cellules effectivement noyées par le remplissage.
   *
   * Marquées pendant le parcours plutôt que déduites après coup en comparant `filled` à
   * l'altitude d'origine : l'ε s'accumule le long des plats et finit par dépasser n'importe
   * quel seuil de comparaison, ce qui ferait passer des versants entiers pour des cuvettes.
   */
  readonly flooded: Uint8Array;
}

export function fillDepressions(
  grid: CoarseGrid,
  elevation: Float64Array,
  epsilon = 1e-9,
): FilledTerrain {
  const filled = new Float64Array(grid.cellCount);
  const flooded = new Uint8Array(grid.cellCount);
  const visited = new Uint8Array(grid.cellCount);
  const heap = new MinHeap();

  for (let row = 0; row < grid.height; row++) {
    for (let column = 0; column < grid.width; column++) {
      if (!grid.isBoundary(column, row)) continue;
      const index = grid.index(column, row);
      filled[index] = elevation[index] as number;
      visited[index] = 1;
      heap.push(filled[index] as number, index);
    }
  }

  while (heap.size > 0) {
    const current = heap.pop();
    if (!current) break;
    const index = current.value;
    const column = index % grid.width;
    const row = (index - column) / grid.width;
    const currentLevel = filled[index] as number;

    for (const [dx, dz] of NEIGHBOR_OFFSETS) {
      const nc = column + dx;
      const nr = row + dz;
      if (nc < 0 || nr < 0 || nc >= grid.width || nr >= grid.height) continue;
      const neighbor = grid.index(nc, nr);
      if (visited[neighbor]) continue;

      visited[neighbor] = 1;
      const raw = elevation[neighbor] as number;
      const raised = raw <= currentLevel;
      const level = raised ? currentLevel + epsilon : raw;
      filled[neighbor] = level;
      if (raised) flooded[neighbor] = 1;
      heap.push(level, neighbor);
    }
  }

  return { filled, flooded };
}
