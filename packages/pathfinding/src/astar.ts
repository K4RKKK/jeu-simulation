import type { NavGrid } from './navGrid.js';
import type { CostMemo, TileCoord } from './types.js';
import { tileKey } from './types.js';

const SQRT2 = Math.SQRT2;

export interface AStarResult {
  /** Chemin de tuiles de départ à arrivée incluses, ou `null`. */
  readonly path: TileCoord[] | null;
  /** Nombre de nœuds développés (compté pour le budget par tick). */
  readonly explored: number;
  /**
   * `false` quand la recherche s'est arrêtée par budget : elle aurait pu trouver un
   * chemin plus loin. `IncrementalAStarSearch.step()` permet alors de la reprendre.
   */
  readonly finished: boolean;
}

interface OpenNode {
  tile: TileCoord;
  g: number;
  h: number;
  seq: number;
}

/** Heuristique octile : admissible pour un voisinage 8-connexe. */
function octile(from: TileCoord, to: TileCoord): number {
  const dx = Math.abs(from.x - to.x);
  const dz = Math.abs(from.z - to.z);
  return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
}

/**
 * A* sur la grille, avec budget de nœuds et mémorisation des coûts dans la mémo fournie.
 *
 * Déterministe : aucun tirage, et l'ordre de départage des égalités est fixé
 * (f, puis h, puis ordre d'insertion). Un même monde produit donc toujours le même
 * chemin.
 */
export function findPath(
  start: TileCoord,
  goal: TileCoord,
  grid: NavGrid,
  memo: CostMemo,
  maxNodes: number,
): AStarResult {
  return new IncrementalAStarSearch(start, goal, grid, memo).step(maxNodes);
}

/**
 * Recherche A* reprenable. Toute la frontière et les scores survivent entre deux appels
 * à `step()` : un budget de 50 + 50 nœuds explore réellement 100 nœuds, jamais deux fois
 * les mêmes 50 premiers.
 */
export class IncrementalAStarSearch {
  private readonly open: OpenNode[] = [];
  private readonly openIndex = new Map<string, number>();
  private readonly gScore = new Map<string, number>();
  private readonly cameFrom = new Map<string, TileCoord>();
  private terminalPath: TileCoord[] | null | undefined;
  private totalExplored = 0;

  constructor(
    start: TileCoord,
    private readonly goal: TileCoord,
    private readonly grid: NavGrid,
    private readonly memo: CostMemo = new Map(),
  ) {
    if (grid.tileCost(start, memo) === null || grid.tileCost(goal, memo) === null) {
      this.terminalPath = null;
      return;
    }
    if (start.x === goal.x && start.z === goal.z) {
      this.terminalPath = [start];
      return;
    }

    const startH = octile(start, goal);
    push(this.open, this.openIndex, { tile: start, g: 0, h: startH, seq: 0 });
    this.gScore.set(tileKey(start), 0);
  }

  get exploredTotal(): number {
    return this.totalExplored;
  }

  step(maxNodes: number): AStarResult {
    if (this.terminalPath !== undefined) {
      return { path: this.terminalPath, explored: 0, finished: true };
    }
    const budget = Math.max(0, Math.floor(maxNodes));
    let explored = 0;

    while (this.open.length > 0) {
      if (explored >= budget) return { path: null, explored, finished: false };
      const current = pop(this.open, this.openIndex);
      explored++;
      this.totalExplored++;

      if (current.tile.x === this.goal.x && current.tile.z === this.goal.z) {
        this.terminalPath = reconstruct(this.cameFrom, current.tile);
        return { path: this.terminalPath, explored, finished: true };
      }

      for (const neighbor of this.grid.neighbors(current.tile, this.memo)) {
        const tentative = current.g + neighbor.cost;
        const key = tileKey(neighbor.tile);
        const previous = this.gScore.get(key);
        if (previous !== undefined && tentative >= previous) continue;
        this.gScore.set(key, tentative);
        this.cameFrom.set(key, current.tile);
        const node: OpenNode = {
          tile: neighbor.tile,
          g: tentative,
          h: octile(neighbor.tile, this.goal),
          seq: 0,
        };
        const existingIndex = this.openIndex.get(key);
        if (existingIndex !== undefined) {
          // Coût amélioré : la f n'a pu que baisser, on remonte le tas.
          this.open[existingIndex] = node;
          siftUp(this.open, this.openIndex, existingIndex);
        } else {
          node.seq = this.open.length;
          push(this.open, this.openIndex, node);
        }
      }
    }

    this.terminalPath = null;
    return { path: null, explored, finished: true };
  }
}

function reconstruct(cameFrom: Map<string, TileCoord>, goal: TileCoord): TileCoord[] {
  const path: TileCoord[] = [goal];
  let current = goal;
  while (true) {
    const previous = cameFrom.get(tileKey(current));
    if (previous === undefined) break;
    current = previous;
    path.push(current);
  }
  path.reverse();
  return path;
}

function less(a: OpenNode, b: OpenNode): boolean {
  const fa = a.g + a.h;
  const fb = b.g + b.h;
  if (fa !== fb) return fa < fb;
  if (a.h !== b.h) return a.h < b.h;
  return a.seq < b.seq;
}

function push(open: OpenNode[], openIndex: Map<string, number>, node: OpenNode): void {
  open.push(node);
  openIndex.set(tileKey(node.tile), open.length - 1);
  siftUp(open, openIndex, open.length - 1);
}

function pop(open: OpenNode[], openIndex: Map<string, number>): OpenNode {
  const root = open[0]!;
  const last = open.pop()!;
  openIndex.delete(tileKey(root.tile));
  if (open.length > 0) {
    open[0] = last;
    openIndex.set(tileKey(last.tile), 0);
    siftDown(open, openIndex, 0);
  }
  return root;
}

function siftUp(open: OpenNode[], openIndex: Map<string, number>, index: number): void {
  let i = index;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!less(open[i]!, open[parent]!)) break;
    swap(open, openIndex, i, parent);
    i = parent;
  }
}

function siftDown(open: OpenNode[], openIndex: Map<string, number>, index: number): void {
  let i = index;
  const size = open.length;
  while (true) {
    const left = 2 * i + 1;
    const right = left + 1;
    let smallest = i;
    if (left < size && less(open[left]!, open[smallest]!)) smallest = left;
    if (right < size && less(open[right]!, open[smallest]!)) smallest = right;
    if (smallest === i) break;
    swap(open, openIndex, i, smallest);
    i = smallest;
  }
}

function swap(open: OpenNode[], openIndex: Map<string, number>, a: number, b: number): void {
  const nodeA = open[a]!;
  const nodeB = open[b]!;
  open[a] = nodeB;
  open[b] = nodeA;
  openIndex.set(tileKey(nodeA.tile), b);
  openIndex.set(tileKey(nodeB.tile), a);
}
