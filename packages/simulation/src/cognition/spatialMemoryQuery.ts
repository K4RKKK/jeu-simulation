import type { SpatialMemoryEntry } from '../components/cognitiveMemory.js';
import type { WorldRef } from './worldRef.js';

const CONFIDENCE_FLOOR = 1e-3;

function score(entry: SpatialMemoryEntry, fromX: number, fromZ: number): number {
  const distance = Math.hypot(entry.x - fromX, entry.z - fromZ);
  return (distance + entry.precisionM) / Math.max(entry.confidence01, CONFIDENCE_FLOOR);
}

/** Best remembered usable shore. This is a pure memory query. */
export function nearestKnownWater(
  spatial: readonly SpatialMemoryEntry[],
  fromX: number,
  fromZ: number,
  include: (entry: SpatialMemoryEntry) => boolean = () => true,
): SpatialMemoryEntry | null {
  let best: SpatialMemoryEntry | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const entry of spatial) {
    if (entry.kind !== 'water' || !include(entry)) continue;
    const candidateScore = score(entry, fromX, fromZ);
    if (candidateScore < bestScore) {
      best = entry;
      bestScore = candidateScore;
    }
  }
  return best;
}

/**
 * Best food-looking resource from cognition only. A remembered target may no longer
 * exist; that fact is deliberately discovered by execution at the remembered location.
 */
export function selectKnownFoodTarget(
  spatial: readonly SpatialMemoryEntry[],
  fromX: number,
  fromZ: number,
  preference: (entry: SpatialMemoryEntry) => number = () => 1,
  include: (entry: SpatialMemoryEntry) => boolean = () => true,
): SpatialMemoryEntry | null {
  let best: SpatialMemoryEntry | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const entry of spatial) {
    if (
      entry.kind !== 'resource' ||
      entry.foodCandidate !== true ||
      !entry.worldRef ||
      !include(entry)
    )
      continue;
    // Learned preference ranks plausible food but never makes it impossible to try.
    const candidateScore = score(entry, fromX, fromZ) / Math.max(0.1, preference(entry));
    if (candidateScore < bestScore) {
      best = entry;
      bestScore = candidateScore;
    }
  }
  return best;
}

/** @deprecated Execution-only compatibility query. Planners must use `selectKnownFoodTarget`. */
export function nearestKnownFood<Spawn>(
  spatial: readonly SpatialMemoryEntry[],
  fromX: number,
  fromZ: number,
  resolveSpawn: (worldRef: WorldRef) => Spawn | null,
  isDepleted: (resourceId: string) => boolean,
  preference: (entry: SpatialMemoryEntry, spawn: Spawn) => number = () => 1,
): { entry: SpatialMemoryEntry; spawn: Spawn } | null {
  const candidates = spatial.filter(
    (entry) =>
      entry.kind === 'resource' &&
      entry.foodCandidate === true &&
      entry.worldRef !== undefined &&
      !isDepleted(entry.worldRef.resourceId),
  );
  let best: { entry: SpatialMemoryEntry; spawn: Spawn } | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const entry of candidates) {
    const spawn = resolveSpawn(entry.worldRef!);
    if (spawn === null) continue;
    const candidateScore = score(entry, fromX, fromZ) / Math.max(0.1, preference(entry, spawn));
    if (candidateScore < bestScore) {
      best = { entry, spawn };
      bestScore = candidateScore;
    }
  }
  return best;
}
