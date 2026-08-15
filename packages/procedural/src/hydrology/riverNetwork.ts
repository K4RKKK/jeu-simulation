import type { WorldGenerationConfig } from '../config/worldGenerationConfig.js';
import { clamp01 } from '../core/numeric.js';
import type { CoarseGrid } from './coarseGrid.js';
import type { WaterBody } from './hydrologyMap.js';

export interface RiverPoint {
  readonly x: number;
  readonly z: number;
  readonly widthMeters: number;
  readonly surface01: number;
  readonly carveDepth01: number;
  readonly bodyIndex: number;
}

export interface RiverSegmentSample {
  readonly distanceMeters: number;
  readonly halfWidthMeters: number;
  readonly surface01: number;
  readonly carveDepth01: number;
  readonly bodyIndex: number;
}

interface RiverSegment {
  readonly from: RiverPoint;
  readonly to: RiverPoint;
}

export interface RiverNetworkInput {
  readonly grid: CoarseGrid;
  readonly riverCells: readonly number[];
  readonly downstream: Int32Array;
  readonly accumulation: Float64Array;
  readonly base: Float64Array;
  readonly carve01: Float32Array;
  readonly bodyIndex: Int32Array;
  readonly bodies: readonly WaterBody[];
  readonly hydrology: WorldGenerationConfig['hydrology'];
}

/**
 * Représentation continue des cours d'eau, issue du drainage D8 mais indépendante de sa
 * résolution lors des requêtes. L'index contient les segments dans toute leur zone de
 * berge : une requête locale ne parcourt jamais le réseau mondial.
 */
export class RiverNetwork {
  readonly segmentCount: number;
  private readonly segments: readonly RiverSegment[];
  private readonly buckets = new Map<number, number[]>();

  constructor(
    segments: readonly RiverSegment[],
    private readonly grid: CoarseGrid,
    private readonly indexCellMeters: number,
    private readonly bankBlendMeters: number,
  ) {
    this.segments = segments;
    this.segmentCount = segments.length;
    for (let index = 0; index < segments.length; index++) this.indexSegment(index);
  }

  sampleAt(x: number, z: number): RiverSegmentSample | null {
    const candidates = this.buckets.get(this.bucketKey(x, z));
    if (!candidates) return null;

    let best: RiverSegmentSample | null = null;
    let bestEdgeDistance = Number.POSITIVE_INFINITY;
    for (const index of candidates) {
      const segment = this.segments[index] as RiverSegment;
      const projection = project(segment, x, z);
      const halfWidthMeters =
        lerp(segment.from.widthMeters, segment.to.widthMeters, projection.t) * 0.5;
      const edgeDistance = projection.distanceMeters - halfWidthMeters;
      if (edgeDistance > this.bankBlendMeters || edgeDistance >= bestEdgeDistance) continue;
      bestEdgeDistance = edgeDistance;
      best = {
        distanceMeters: projection.distanceMeters,
        halfWidthMeters,
        surface01: lerp(segment.from.surface01, segment.to.surface01, projection.t),
        carveDepth01: lerp(segment.from.carveDepth01, segment.to.carveDepth01, projection.t),
        bodyIndex: projection.t < 0.5 ? segment.from.bodyIndex : segment.to.bodyIndex,
      };
    }
    return best;
  }

  private indexSegment(index: number): void {
    const segment = this.segments[index] as RiverSegment;
    const reach =
      Math.max(segment.from.widthMeters, segment.to.widthMeters) * 0.5 + this.bankBlendMeters;
    const minColumn = this.bucketColumn(Math.min(segment.from.x, segment.to.x) - reach);
    const maxColumn = this.bucketColumn(Math.max(segment.from.x, segment.to.x) + reach);
    const minRow = this.bucketRow(Math.min(segment.from.z, segment.to.z) - reach);
    const maxRow = this.bucketRow(Math.max(segment.from.z, segment.to.z) + reach);
    for (let row = minRow; row <= maxRow; row++) {
      for (let column = minColumn; column <= maxColumn; column++) {
        const key = row * this.bucketWidth + column;
        const bucket = this.buckets.get(key);
        if (bucket) bucket.push(index);
        else this.buckets.set(key, [index]);
      }
    }
  }

  private get bucketWidth(): number {
    return Math.ceil(this.grid.sizeMeters / this.indexCellMeters) + 1;
  }

  private bucketColumn(x: number): number {
    return Math.max(
      0,
      Math.min(this.bucketWidth - 1, Math.floor((x - this.grid.originX) / this.indexCellMeters)),
    );
  }

  private bucketRow(z: number): number {
    return Math.max(
      0,
      Math.min(this.bucketWidth - 1, Math.floor((z - this.grid.originZ) / this.indexCellMeters)),
    );
  }

  private bucketKey(x: number, z: number): number {
    return this.bucketRow(z) * this.bucketWidth + this.bucketColumn(x);
  }
}

export function buildRiverNetwork(input: RiverNetworkInput): RiverNetwork {
  const points = buildChains(input).flatMap((chain) => {
    let smoothed = chain;
    for (let pass = 0; pass < input.hydrology.riverCenterlineSmoothingPasses; pass++) {
      smoothed = smoothChain(smoothed);
    }
    return resampleChain(smoothed, input.hydrology.riverCenterlineSampleMeters);
  });
  const segments: RiverSegment[] = [];
  for (const chain of points) {
    for (let i = 1; i < chain.length; i++) {
      segments.push({ from: chain[i - 1] as RiverPoint, to: chain[i] as RiverPoint });
    }
  }
  return new RiverNetwork(
    segments,
    input.grid,
    input.hydrology.riverSpatialIndexCellMeters,
    input.hydrology.riverBankBlendMeters,
  );
}

function buildChains(input: RiverNetworkInput): RiverPoint[][] {
  const active = new Uint8Array(input.grid.cellCount);
  for (const cell of input.riverCells) {
    const body = input.bodies[input.bodyIndex[cell] as number];
    if (body?.type === 'river' || body?.type === 'spring') active[cell] = 1;
  }

  const upstreamCount = new Uint8Array(input.grid.cellCount);
  const principalUpstream = new Int32Array(input.grid.cellCount).fill(-1);
  for (const cell of input.riverCells) {
    if (active[cell] !== 1) continue;
    const target = input.downstream[cell] as number;
    if (target >= 0 && active[target] === 1) {
      upstreamCount[target] = (upstreamCount[target] ?? 0) + 1;
      const previous = principalUpstream[target] as number;
      if (
        previous < 0 ||
        (input.accumulation[cell] as number) > (input.accumulation[previous] as number) ||
        ((input.accumulation[cell] as number) === (input.accumulation[previous] as number) &&
          cell < previous)
      ) {
        principalUpstream[target] = cell;
      }
    }
  }

  const chains: RiverPoint[][] = [];
  for (const start of input.riverCells) {
    if (active[start] !== 1 || upstreamCount[start] !== 0) continue;
    const target = input.downstream[start] as number;
    if (target < 0 || active[target] !== 1) continue;
    const cells = [start];
    let current = start;
    while (true) {
      const next = input.downstream[current] as number;
      if (next < 0 || active[next] !== 1) break;
      cells.push(next);
      // Le bras qui porte le plus de débit devient le cours principal et traverse la
      // confluence sans casser sa tangente. Les affluents s'arrêtent au même point partagé.
      if ((upstreamCount[next] ?? 0) > 1 && principalUpstream[next] !== current) break;
      current = next;
    }
    if (cells.length > 1) chains.push(cells.map((cell) => pointForCell(cell, input)));
  }
  return chains;
}

function pointForCell(cell: number, input: RiverNetworkInput): RiverPoint {
  const column = cell % input.grid.width;
  const row = (cell - column) / input.grid.width;
  const hydrology = input.hydrology;
  const widthFactor = clamp01(
    ((input.accumulation[cell] as number) - hydrology.riverAccumulationThreshold) /
      Math.max(1, hydrology.riverFullWidthAccumulation - hydrology.riverAccumulationThreshold),
  );
  return {
    x: input.grid.centerX(column),
    z: input.grid.centerZ(row),
    widthMeters: lerp(hydrology.minRiverWidthMeters, hydrology.maxRiverWidthMeters, widthFactor),
    surface01:
      (input.base[cell] as number) -
      (input.carve01[cell] as number) * (1 - hydrology.riverFillRatio),
    carveDepth01: input.carve01[cell] as number,
    bodyIndex: input.bodyIndex[cell] as number,
  };
}

/** Chaikin conserve les extrémités et n'utilise que des combinaisons convexes : l'altitude
 * reste donc monotone vers l'aval alors que les angles de la grille disparaissent. */
export function smoothChain(points: readonly RiverPoint[]): RiverPoint[] {
  if (points.length < 3) return [...points];
  const result: RiverPoint[] = [points[0] as RiverPoint];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1] as RiverPoint;
    const to = points[i] as RiverPoint;
    result.push(interpolatePoint(from, to, 0.25), interpolatePoint(from, to, 0.75));
  }
  result.push(points[points.length - 1] as RiverPoint);
  return result;
}

function resampleChain(points: readonly RiverPoint[], spacing: number): RiverPoint[][] {
  if (points.length < 2) return [];
  const result: RiverPoint[] = [points[0] as RiverPoint];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1] as RiverPoint;
    const to = points[i] as RiverPoint;
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let step = 1; step <= steps; step++) result.push(interpolatePoint(from, to, step / steps));
  }
  return [result];
}

function interpolatePoint(from: RiverPoint, to: RiverPoint, t: number): RiverPoint {
  return {
    x: lerp(from.x, to.x, t),
    z: lerp(from.z, to.z, t),
    widthMeters: lerp(from.widthMeters, to.widthMeters, t),
    surface01: lerp(from.surface01, to.surface01, t),
    carveDepth01: lerp(from.carveDepth01, to.carveDepth01, t),
    bodyIndex: t < 0.5 ? from.bodyIndex : to.bodyIndex,
  };
}

function project(
  segment: RiverSegment,
  x: number,
  z: number,
): { t: number; distanceMeters: number } {
  const dx = segment.to.x - segment.from.x;
  const dz = segment.to.z - segment.from.z;
  const lengthSquared = dx * dx + dz * dz;
  const rawT =
    lengthSquared > 0 ? ((x - segment.from.x) * dx + (z - segment.from.z) * dz) / lengthSquared : 0;
  const t = clamp01(rawT);
  return {
    t,
    distanceMeters: Math.hypot(
      x - lerp(segment.from.x, segment.to.x, t),
      z - lerp(segment.from.z, segment.to.z, t),
    ),
  };
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}
