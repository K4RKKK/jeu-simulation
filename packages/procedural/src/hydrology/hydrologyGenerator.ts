import type { WaterProfileRegistry } from '@civ/content';
import type { WorldGenerationConfig } from '../config/worldGenerationConfig.js';
import type { ElevationGenerator } from '../terrain/elevationGenerator.js';
import type { WorldBounds } from '../chunks/worldBounds.js';
import { computeDistanceTransform } from './distanceTransform.js';
import type { HydrologyMapData, WaterBody } from './hydrologyMap.js';
import { HydrologyMap } from './hydrologyMap.js';
import { buildCoarseGrid, computeDrainage } from './drainageGenerator.js';
import { markStandingWater, buildStandingBodies } from './waterBodiesGenerator.js';
import { markRivers, buildRivers, smoothCarve } from './riverGenerator.js';
import { growRivers } from './riverGenerator.js';
import { buildRiverNetwork } from './riverNetwork.js';

// Ré-export pour compatibilité avec les importeurs existants (tests, etc.)
export { growRivers } from './riverGenerator.js';

export interface HydrologyInput {
  config: WorldGenerationConfig;
  bounds: WorldBounds;
  elevation: ElevationGenerator;
  waterProfiles: WaterProfileRegistry;
  /** Température normalisée du climat, utilisée pour la température nominale de l'eau. */
  sampleTemperature01: (x: number, z: number) => number;
}

/**
 * Orchestre la construction de l'hydrologie du monde à partir du relief.
 *
 * L'enchaînement suit la physique plutôt qu'une esthétique :
 * 1. Drainage : on calcule le champ d'écoulement (drainageGenerator).
 * 2. Plans d'eau : les cuvettes deviennent lacs/étangs (waterBodiesGenerator).
 * 3. Rivières : l'accumulation trace les cours d'eau (riverGenerator).
 *
 * Aucune rivière n'est tracée à la main ; aucune ne remonte une pente.
 */
export function generateHydrology(input: HydrologyInput): HydrologyMap {
  const { config, bounds, elevation } = input;
  const hydrology = config.hydrology;

  // 1. Drainage : relief → champ de flux
  const grid = buildCoarseGrid(bounds, hydrology);
  const { base, flow, flooded, filled } = computeDrainage(grid, elevation);

  // Buffers partagés entre les deux phases suivantes
  const mask = new Uint8Array(grid.cellCount);
  const surface01 = new Float32Array(grid.cellCount);
  const bodyIndex = new Int32Array(grid.cellCount).fill(-1);
  const carve01 = new Float32Array(grid.cellCount);
  const bodies: WaterBody[] = [];

  const cellAreaM2 = hydrology.coarseCellMeters * hydrology.coarseCellMeters;
  const metersPerUnit = elevation.metersPerUnit;
  const sharedContext = {
    grid,
    base,
    mask,
    surface01,
    bodyIndex,
    carve01,
    bodies,
    cellAreaM2,
    metersPerUnit,
    input,
  };

  // 2. Plans d'eau stagnants (lacs, étangs) : remplissent les cuvettes ET creusent le
  // terrain fin d'une marge garantie sous leur surface (voir `buildStandingBodies`) —
  // sans quoi, contrairement aux rivières, rien ne les distinguait du bruit brut du
  // relief à la résolution fine du maillage.
  const standing = markStandingWater(grid, base, filled, flooded, hydrology);
  buildStandingBodies({ ...sharedContext, standing });
  const standingMask = Uint8Array.from(mask);
  const standingBodyIndex = Int32Array.from(bodyIndex);

  // 3. Rivières : accumulation → tracé → érosion des berges
  const riverCells = markRivers(
    grid,
    flow.accumulation,
    mask,
    hydrology.riverAccumulationThreshold,
  );
  const continuousRiverCells = growRivers(grid, flow, riverCells, hydrology);
  buildRivers({ ...sharedContext, flow, riverCells: continuousRiverCells });

  // Raccorde en une seule passe le creusement des rivières ET des plans d'eau stagnants
  // au terrain environnant — un plan d'eau stagnant a maintenant, comme une rivière, une
  // vraie transition de berge plutôt qu'une bordure brute dictée par la seule grille
  // hydrologique grossière.
  smoothCarve(
    grid,
    carve01,
    Math.ceil(hydrology.riverBankBlendMeters / hydrology.coarseCellMeters),
    hydrology.riverBankFalloff,
  );

  const riverNetwork = buildRiverNetwork({
    grid,
    riverCells: continuousRiverCells,
    downstream: flow.downstream,
    accumulation: flow.accumulation,
    base,
    carve01,
    bodyIndex,
    bodies,
    hydrology,
  });

  const distanceMeters = computeDistanceTransform(grid, mask, hydrology.coarseCellMeters);

  const data: HydrologyMapData = {
    grid,
    bodies,
    carve01,
    surface01,
    mask: standingMask,
    bodyIndex: standingBodyIndex,
    distanceMeters,
    metersPerUnit,
    minMeters: elevation.toMeters(0),
    stats: buildStats(grid, mask, bodyIndex, bodies),
    riverNetwork,
    hydrologyConfig: hydrology,
    sampleBase01: (x, z) => elevation.base01(x, z),
  };

  return new HydrologyMap(data);
}

function buildStats(
  grid: { cellCount: number },
  mask: Uint8Array,
  bodyIndex: Int32Array,
  bodies: readonly WaterBody[],
): HydrologyMapData['stats'] {
  const coverage: Record<WaterBody['type'], number> = { river: 0, lake: 0, pond: 0, spring: 0 };
  let waterCells = 0;

  for (let i = 0; i < grid.cellCount; i++) {
    if (mask[i] !== 1) continue;
    waterCells++;
    const body = bodies[bodyIndex[i] as number];
    if (body) coverage[body.type] += 1;
  }

  for (const type of Object.keys(coverage) as WaterBody['type'][]) {
    coverage[type] /= grid.cellCount;
  }

  return {
    lakes: bodies.filter((body) => body.type === 'lake').length,
    ponds: bodies.filter((body) => body.type === 'pond').length,
    rivers: bodies.filter((body) => body.type === 'river').length,
    springs: bodies.filter((body) => body.type === 'spring').length,
    waterCellRatio: waterCells / grid.cellCount,
    coverageByType: coverage,
  };
}
