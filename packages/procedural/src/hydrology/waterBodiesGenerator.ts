import type { WorldGenerationConfig } from '../config/worldGenerationConfig.js';
import { clamp01 } from '../core/numeric.js';
import { NEIGHBOR_OFFSETS, type CoarseGrid } from './coarseGrid.js';
import type { WaterBody } from './hydrologyMap.js';
import type { HydrologyInput } from './hydrologyGenerator.js';

/** Contexte partagé pour la construction des plans d'eau stagnants. */
interface StandingContext {
  grid: CoarseGrid;
  base: Float64Array;
  standing: Float64Array;
  mask: Uint8Array;
  surface01: Float32Array;
  bodyIndex: Int32Array;
  /**
   * Creusement du terrain fin — voir la doc de `HydrologyConfig.standingWaterCarveMarginMeters`.
   * Partagé avec les rivières (`buildRivers` y écrit aussi) : `smoothCarve`, appelé une
   * seule fois sur l'ensemble du champ après les deux passes, raccorde les deux au
   * terrain environnant de la même façon.
   */
  carve01: Float32Array;
  bodies: WaterBody[];
  cellAreaM2: number;
  metersPerUnit: number;
  input: HydrologyInput;
}

/**
 * Cellules sous l'eau : soit noyées par le remplissage d'une cuvette, soit situées sous le
 * niveau général des eaux. Retourne l'altitude de surface candidate par cellule.
 */
export function markStandingWater(
  grid: CoarseGrid,
  base: Float64Array,
  filled: Float64Array,
  flooded: Uint8Array,
  hydrology: WorldGenerationConfig['hydrology'],
): Float64Array {
  const surface = new Float64Array(grid.cellCount).fill(Number.NEGATIVE_INFINITY);
  for (let i = 0; i < grid.cellCount; i++) {
    const ground = base[i] as number;
    let candidate = Number.NEGATIVE_INFINITY;

    // Une cuvette perchée ne retient pas d'eau : à cette échelle de temps, l'érosion a
    // depuis longtemps entaillé son seuil et la vallée s'est vidée. Seules les cuvettes
    // basses forment durablement un plan d'eau.
    if (flooded[i] === 1 && (filled[i] as number) <= hydrology.maxStandingSurface01) {
      candidate = filled[i] as number;
    }
    if (ground < hydrology.waterLevel01 && hydrology.waterLevel01 > candidate) {
      candidate = hydrology.waterLevel01;
    }
    surface[i] = candidate;
  }
  return surface;
}

/** Regroupe les cellules noyées en composantes connexes : une composante = un plan d'eau. */
export function buildStandingBodies(context: StandingContext): void {
  const { grid, base, standing, mask, surface01, bodyIndex, carve01, bodies } = context;
  const hydrology = context.input.config.hydrology;
  // Marge garantie sous la surface, en altitude normalisée — voir la doc du champ de
  // config. Convertie une fois ici plutôt qu'à chaque cellule.
  const carveMargin01 = hydrology.standingWaterCarveMarginMeters / context.metersPerUnit;
  const visited = new Uint8Array(grid.cellCount);
  const stack: number[] = [];

  for (let start = 0; start < grid.cellCount; start++) {
    if (visited[start] || (standing[start] as number) === Number.NEGATIVE_INFINITY) continue;

    const component: number[] = [];
    let surfaceLevel = Number.NEGATIVE_INFINITY;
    visited[start] = 1;
    stack.push(start);

    while (stack.length > 0) {
      const index = stack.pop() as number;
      component.push(index);
      const level = standing[index] as number;
      if (level > surfaceLevel) surfaceLevel = level;

      const column = index % grid.width;
      const row = (index - column) / grid.width;
      for (const [dx, dz] of NEIGHBOR_OFFSETS) {
        const nc = column + dx;
        const nr = row + dz;
        if (nc < 0 || nr < 0 || nc >= grid.width || nr >= grid.height) continue;
        const neighbor = grid.index(nc, nr);
        if (visited[neighbor] || (standing[neighbor] as number) === Number.NEGATIVE_INFINITY) {
          continue;
        }
        visited[neighbor] = 1;
        stack.push(neighbor);
      }
    }

    if (component.length < hydrology.minPondCells) continue;

    // Une cuvette de quelques centimètres n'est pas un étang : sans ce filtre, le
    // remplissage des dépressions couvrirait le monde de flaques.
    let depthSum = 0;
    for (const cell of component) depthSum += Math.max(0, surfaceLevel - (base[cell] as number));
    const meanDepthM = (depthSum / component.length) * context.metersPerUnit;
    if (meanDepthM < hydrology.minStandingDepthMeters) continue;

    const type = component.length >= hydrology.minLakeCells ? 'lake' : 'pond';
    const index = bodies.length;
    for (const cell of component) {
      mask[cell] = 1;
      // Surface uniforme sur toute la composante : un lac est plat, y compris quand son
      // fond ne l'est pas.
      surface01[cell] = surfaceLevel;
      bodyIndex[cell] = index;
      // Creuse le terrain fin d'une marge garantie sous la surface — voir la doc de
      // `standingWaterCarveMarginMeters`. `surfaceLevel >= base[cell]` toujours (c'est la
      // définition même d'une cellule « noyée »), donc ce terme reste positif : sans lui,
      // le maillage fin (à bien plus haute résolution que la grille hydrologique) pouvait
      // localement remonter au-dessus d'une surface d'eau calculée sur un échantillon
      // grossier, donnant une eau qui semble posée sur le sol plutôt que nichée dedans.
      const needed = surfaceLevel - (base[cell] as number) + carveMargin01;
      if (needed > (carve01[cell] as number)) carve01[cell] = needed;
    }
    bodies.push(makeStandingBody(type, index, component, surfaceLevel, base, context));
  }
}

/**
 * Propriétés d'un plan d'eau stagnant (lac, étang).
 *
 * Le profil du type fournit une base ; la géométrie la corrige. Une eau peu profonde et
 * stagnante se charge davantage : c'est ce qui fera plus tard la différence entre boire à
 * la rivière et boire à la mare.
 */
function makeStandingBody(
  type: WaterBody['type'],
  index: number,
  cells: readonly number[],
  surfaceLevel: number,
  base: Float64Array,
  context: StandingContext,
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
    temperatureC: 12 + profile.temperatureOffsetC + (localTemperature01 - 0.5) * 16 + shallowness * 2,
    flowRenewal,
    wadeableDepthM: profile.wadeableDepthM,
  };
}
