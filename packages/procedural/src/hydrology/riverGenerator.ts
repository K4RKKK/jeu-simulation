import type { WorldGenerationConfig } from '../config/worldGenerationConfig.js';
import { clamp01 } from '../core/numeric.js';
import { NEIGHBOR_OFFSETS, type CoarseGrid } from './coarseGrid.js';
import type { WaterBody } from './hydrologyMap.js';
import type { HydrologyInput } from './hydrologyGenerator.js';

export interface RiverBuildResult {
  mask: Uint8Array;
  surface01: Float32Array;
  bodyIndex: Int32Array;
  carve01: Float32Array;
  bodies: WaterBody[];
}

/** Contexte partagé par les fonctions internes de construction des rivières. */
interface RiverContext {
  grid: CoarseGrid;
  base: Float64Array;
  flow: { downstream: Int32Array; accumulation: Float64Array };
  riverCells: number[];
  mask: Uint8Array;
  surface01: Float32Array;
  bodyIndex: Int32Array;
  carve01: Float32Array;
  bodies: WaterBody[];
  cellAreaM2: number;
  metersPerUnit: number;
  input: HydrologyInput;
}

/**
 * Marque les cellules dont l'accumulation dépasse le seuil de rivière.
 * Les cellules déjà couvertes par un plan d'eau ne deviennent pas rivière :
 * arrivée dans un lac, une rivière s'y fond.
 */
export function markRivers(
  grid: CoarseGrid,
  accumulation: Float64Array,
  mask: Uint8Array,
  threshold: number,
): number[] {
  const cells: number[] = [];
  for (let i = 0; i < grid.cellCount; i++) {
    if (mask[i] === 1) continue;
    if ((accumulation[i] as number) >= threshold) cells.push(i);
  }
  return cells;
}

/**
 * Étend le réseau vers l'amont : une cellule qui s'écoule dans une rivière déjà établie
 * devient rivière dès que son accumulation dépasse un seuil réduit.
 *
 * Sans cette passe, une accumulation qui oscille autour du seuil principal découpe les
 * rivières en segments isolés — des sources de une ou deux cellules éparpillées, sans lien
 * hydraulique. Ici, seul l'amont d'une rivière existante est absorbé : rien n'est créé dans
 * le vide, et une rivière ne remonte toujours pas une pente.
 */
export function growRivers(
  grid: CoarseGrid,
  flow: { downstream: Int32Array; accumulation: Float64Array },
  riverCells: readonly number[],
  hydrology: Pick<
    WorldGenerationConfig['hydrology'],
    'riverAccumulationThreshold' | 'riverContinuationRatio'
  >,
): number[] {
  if (riverCells.length === 0) return [];

  const isRiver = new Uint8Array(grid.cellCount);
  for (const cell of riverCells) isRiver[cell] = 1;

  const continuationThreshold =
    hydrology.riverAccumulationThreshold * hydrology.riverContinuationRatio;

  // Une itération propage le marquage d'une cellule vers l'amont : on répète jusqu'à
  // stabilisation. La garde est le diamètre de la grille, pas un plafond arbitraire.
  const maxPasses = grid.width + grid.height;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (let i = 0; i < grid.cellCount; i++) {
      if (isRiver[i] === 1) continue;
      if ((flow.accumulation[i] as number) < continuationThreshold) continue;
      if (isRiver[flow.downstream[i] as number] !== 1) continue;
      isRiver[i] = 1;
      changed = true;
    }
    if (!changed) break;
  }

  const grown: number[] = [];
  for (let i = 0; i < grid.cellCount; i++) if (isRiver[i] === 1) grown.push(i);
  return grown;
}

/**
 * Construit les entités river et spring à partir des cellules marquées.
 * Le lit est creusé proportionnellement au débit, puis étalé par `smoothCarve`.
 */
export function buildRivers(context: RiverContext): void {
  const { grid, base, flow, riverCells, mask, surface01, bodyIndex, carve01, bodies } = context;
  const hydrology = context.input.config.hydrology;
  if (riverCells.length === 0) return;

  const isRiver = new Uint8Array(grid.cellCount);
  for (const cell of riverCells) isRiver[cell] = 1;

  // Le lit est d'autant plus creusé que le débit est important.
  for (const cell of riverCells) {
    const accumulation = flow.accumulation[cell] as number;
    const widthFactor = clamp01(
      (accumulation - hydrology.riverAccumulationThreshold) /
        Math.max(1, hydrology.riverFullWidthAccumulation - hydrology.riverAccumulationThreshold),
    );
    carve01[cell] = hydrology.riverCarveDepth01 * (0.45 + 0.55 * widthFactor);
  }

  // Une source est la tête d'un cours d'eau : aucune cellule amont ne lui apporte d'eau.
  const springHeads = new Set<number>();
  for (const cell of riverCells) {
    let hasUpstream = false;
    const column = cell % grid.width;
    const row = (cell - column) / grid.width;
    for (const [dx, dz] of NEIGHBOR_OFFSETS) {
      const nc = column + dx;
      const nr = row + dz;
      if (nc < 0 || nr < 0 || nc >= grid.width || nr >= grid.height) continue;
      const neighbor = grid.index(nc, nr);
      if (isRiver[neighbor] === 1 && flow.downstream[neighbor] === cell) hasUpstream = true;
    }
    if (!hasUpstream) springHeads.add(cell);
  }

  const visited = new Uint8Array(grid.cellCount);
  const stack: number[] = [];

  for (const start of riverCells) {
    if (visited[start]) continue;
    const component: number[] = [];
    visited[start] = 1;
    stack.push(start);

    while (stack.length > 0) {
      const index = stack.pop() as number;
      component.push(index);
      const column = index % grid.width;
      const row = (index - column) / grid.width;
      for (const [dx, dz] of NEIGHBOR_OFFSETS) {
        const nc = column + dx;
        const nr = row + dz;
        if (nc < 0 || nr < 0 || nc >= grid.width || nr >= grid.height) continue;
        const neighbor = grid.index(nc, nr);
        if (visited[neighbor] || isRiver[neighbor] === 0) continue;
        visited[neighbor] = 1;
        stack.push(neighbor);
      }
    }

    // Une rivière de deux cellules est un artefact de l'accumulation, pas un cours d'eau :
    // le lit reste creusé (visible dans le relief) mais il n'y a pas d'eau à afficher.
    if (component.length < hydrology.minRiverCells) continue;

    let springCells = component.filter((cell) => springHeads.has(cell));
    let streamCells = component.filter((cell) => !springHeads.has(cell));

    // Une tête d'une seule cellule n'est pas une source mais le départ du cours d'eau :
    // elle se fond dans la rivière au lieu de former un carré d'eau isolé.
    if (springCells.length < hydrology.minSpringCells) {
      streamCells = [...streamCells, ...springCells];
      springCells = [];
    }

    for (const group of [
      { type: 'spring' as const, cells: springCells },
      { type: 'river' as const, cells: streamCells },
    ]) {
      if (group.cells.length === 0) continue;
      const index = bodies.length;
      let surfaceSum = 0;
      for (const cell of group.cells) {
        mask[cell] = 1;
        // La surface suit le lit creusé : l'eau descend avec la vallée.
        const level =
          (base[cell] as number) - (carve01[cell] as number) * (1 - hydrology.riverFillRatio);
        surface01[cell] = level;
        bodyIndex[cell] = index;
        surfaceSum += level;
      }
      bodies.push(
        makeRiverBody(
          group.type,
          index,
          group.cells,
          surfaceSum / group.cells.length,
          base,
          context,
        ),
      );
    }
  }
}

/**
 * Étale le creusement autour du lit pour éviter une tranchée à parois verticales.
 *
 * Le falloff est plafonné à `1 - riverFillRatio` : une berge creusée plus profond que la
 * surface de l'eau voisine serait inondée par le maillage d'eau, qui paraîtrait flotter
 * au-dessus du sol.
 */
export function smoothCarve(
  grid: CoarseGrid,
  carve01: Float32Array,
  passes: number,
  falloff: number,
): void {
  for (let pass = 0; pass < passes; pass++) {
    const previous = Float32Array.from(carve01);
    for (let row = 0; row < grid.height; row++) {
      for (let column = 0; column < grid.width; column++) {
        const index = grid.index(column, row);
        let best = previous[index] as number;
        for (const [dx, dz] of NEIGHBOR_OFFSETS) {
          const nc = column + dx;
          const nr = row + dz;
          if (nc < 0 || nr < 0 || nc >= grid.width || nr >= grid.height) continue;
          const candidate = (previous[grid.index(nc, nr)] as number) * falloff;
          if (candidate > best) best = candidate;
        }
        carve01[index] = best;
      }
    }
  }
}

function makeRiverBody(
  type: WaterBody['type'],
  index: number,
  cells: readonly number[],
  surfaceLevel: number,
  base: Float64Array,
  context: RiverContext,
): WaterBody {
  const { grid, cellAreaM2, metersPerUnit, input } = context;
  const profile = input.waterProfiles.getOrThrow(type);

  let depthSum = 0;
  let maxDepth = 0;
  let centerX = 0;
  let centerZ = 0;

  for (const cell of cells) {
    const column = cell % grid.width;
    const row = (cell - column) / grid.width;
    const depth = Math.max(0, (surfaceLevel - (base[cell] as number)) * metersPerUnit);
    depthSum += depth;
    if (depth > maxDepth) maxDepth = depth;
    centerX += grid.centerX(column);
    centerZ += grid.centerZ(row);
  }

  const areaM2 = cells.length * cellAreaM2;
  const meanDepthM = depthSum / cells.length;
  const shallowness = clamp01(1 - meanDepthM / 2.5);
  const flowRenewal = clamp01(profile.flowRenewal * (1 - shallowness * 0.35));
  const stagnation = 1 - flowRenewal;

  const localTemperature01 = input.sampleTemperature01(
    centerX / cells.length,
    centerZ / cells.length,
  );

  let smallestCell = cells[0] as number;
  for (const cell of cells) if (cell < smallestCell) smallestCell = cell;

  return {
    id: `water:${type}:${smallestCell}`,
    index,
    type,
    centerX: centerX / cells.length,
    centerZ: centerZ / cells.length,
    areaM2,
    volume: depthSum * cellAreaM2,
    meanDepthM,
    maxDepthM: maxDepth,
    surfaceHeightM: input.elevation.toMeters(surfaceLevel),
    contamination: clamp01(profile.baseContamination * (1 + stagnation * 1.2)),
    pathogenLoad: clamp01(profile.basePathogenLoad * (1 + stagnation * 1.8 + shallowness * 0.6)),
    turbidity: clamp01(profile.baseTurbidity * (1 + shallowness * 0.8)),
    temperatureC:
      12 + profile.temperatureOffsetC + (localTemperature01 - 0.5) * 16 + shallowness * 2,
    flowRenewal,
    wadeableDepthM: profile.wadeableDepthM,
  };
}
