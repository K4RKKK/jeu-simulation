import * as THREE from 'three';

export interface WaterSurfaceInput {
  readonly resolution: number;
  readonly chunkSizeMeters: number;
  readonly terrainHeights: Float32Array;
  readonly waterHeights: Float32Array;
}

interface Vertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Signed distance to the shoreline: positive in water, negative on dry ground. */
  readonly shoreline: number;
  readonly depth: number;
}

export interface WaterSurfaceData {
  readonly positions: Float32Array;
  readonly depths: Float32Array;
}

const MIN_EDGE_DEPTH_M = 0.05;

/**
 * Builds a shoreline-clipped water surface.
 *
 * A terrain cell is split into two triangles, then each triangle is clipped against the
 * waterline. The former renderer emitted both complete triangles as soon as one corner was
 * wet, which produced the conspicuous blue wedges visible along narrow rivers.
 */
export function buildWaterSurface(input: WaterSurfaceInput): WaterSurfaceData | null {
  const { resolution, chunkSizeMeters, terrainHeights, waterHeights } = input;
  const side = resolution + 1;
  const step = chunkSizeMeters / resolution;
  const positions: number[] = [];
  const depths: number[] = [];

  for (let row = 0; row < resolution; row++) {
    for (let column = 0; column < resolution; column++) {
      const a = row * side + column;
      const indices = [a, a + 1, a + side, a + side + 1] as const;
      const wetSurfaces = indices
        .map((index) => waterHeights[index] as number)
        .filter((height) => Number.isFinite(height));
      if (wetSurfaces.length === 0) continue;

      const inferredSurface =
        wetSurfaces.reduce((sum, height) => sum + height, 0) / wetSurfaces.length;
      const vertices = indices.map((index, corner) => {
        const surface = waterHeights[index] as number;
        const wet = Number.isFinite(surface);
        const y = wet ? surface : inferredSurface;
        const terrain = terrainHeights[index] as number;
        const physicalDepth = y - terrain;
        return {
          x: (column + (corner % 2)) * step,
          y,
          z: (row + (corner >= 2 ? 1 : 0)) * step,
          shoreline: wet
            ? Math.max(MIN_EDGE_DEPTH_M, physicalDepth)
            : -Math.max(MIN_EDGE_DEPTH_M, Math.abs(physicalDepth)),
          depth: wet ? Math.max(0, physicalDepth) : 0,
        } satisfies Vertex;
      });

      emitClippedTriangle(
        vertices[0] as Vertex,
        vertices[2] as Vertex,
        vertices[1] as Vertex,
        positions,
        depths,
      );
      emitClippedTriangle(
        vertices[1] as Vertex,
        vertices[2] as Vertex,
        vertices[3] as Vertex,
        positions,
        depths,
      );
    }
  }

  if (positions.length === 0) return null;
  return { positions: new Float32Array(positions), depths: new Float32Array(depths) };
}

function emitClippedTriangle(
  a: Vertex,
  b: Vertex,
  c: Vertex,
  positions: number[],
  depths: number[],
): void {
  const input = [a, b, c];
  const polygon: Vertex[] = [];

  for (let i = 0; i < input.length; i++) {
    const current = input[i] as Vertex;
    const next = input[(i + 1) % input.length] as Vertex;
    const currentInside = current.shoreline >= 0;
    const nextInside = next.shoreline >= 0;

    if (currentInside) polygon.push(current);
    if (currentInside !== nextInside) polygon.push(intersection(current, next));
  }

  for (let i = 1; i + 1 < polygon.length; i++) {
    emitVertex(polygon[0] as Vertex, positions, depths);
    emitVertex(polygon[i] as Vertex, positions, depths);
    emitVertex(polygon[i + 1] as Vertex, positions, depths);
  }
}

function intersection(a: Vertex, b: Vertex): Vertex {
  const t = a.shoreline / (a.shoreline - b.shoreline);
  return {
    x: THREE.MathUtils.lerp(a.x, b.x, t),
    y: THREE.MathUtils.lerp(a.y, b.y, t),
    z: THREE.MathUtils.lerp(a.z, b.z, t),
    shoreline: 0,
    depth: 0,
  };
}

function emitVertex(vertex: Vertex, positions: number[], depths: number[]): void {
  positions.push(vertex.x, vertex.y, vertex.z);
  depths.push(vertex.depth);
}
