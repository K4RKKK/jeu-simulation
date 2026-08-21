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
): SpatialMemoryEntry | null {
  let best: SpatialMemoryEntry | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const entry of spatial) {
    if (entry.kind !== 'water') continue;
    const candidateScore = score(entry, fromX, fromZ);
    if (candidateScore < bestScore) {
      best = entry;
      bestScore = candidateScore;
    }
  }
  return best;
}

/**
 * Best remembered resource that appears edible and still exists in the world.
 *
 * `entry.foodCandidate` is a perceptual affordance captured during observation: it means
 * the resource looks like something that may be eaten. It deliberately says nothing
 * about nutrition or toxicity. Those engine facts remain hidden until ingestion.
 * `resolveSpawn` only verifies that the remembered resource still exists and returns the
 * stable reference needed to plan the interaction.
 */
export function nearestKnownFood<Spawn>(
  spatial: readonly SpatialMemoryEntry[],
  fromX: number,
  fromZ: number,
  resolveSpawn: (worldRef: WorldRef) => Spawn | null,
  isDepleted: (resourceId: string) => boolean,
  preference: (entry: SpatialMemoryEntry, spawn: Spawn) => number = () => 1,
): { entry: SpatialMemoryEntry; spawn: Spawn } | null {
  let best: { entry: SpatialMemoryEntry; spawn: Spawn } | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const entry of spatial) {
    if (entry.kind !== 'resource' || entry.foodCandidate !== true || !entry.worldRef) continue;
    if (isDepleted(entry.worldRef.resourceId)) continue;
    const spawn = resolveSpawn(entry.worldRef);
    if (!spawn) continue;
    // Learned preference ranks plausible food but never makes it impossible to try.
    const candidateScore = score(entry, fromX, fromZ) / Math.max(0.1, preference(entry, spawn));
    if (candidateScore < bestScore) {
      best = { entry, spawn };
      bestScore = candidateScore;
    }
  }
  return best;
}
