import type { FoodMemoryEntry, MemoryComponent, WaterMemoryEntry } from '../../components/index.js';

/**
 * Logique pure de la perception et de la mémoire (CLAUDE.md règle 8 : testable sans
 * entités). Le `PerceptionSystem` fait le lien avec le monde ; ici, rien ne dépend ni du
 * monde ni des entités — des fonctions, des données, des seuils.
 *
 * Les souvenirs sont des tableaux ordonnés du plus ancien au plus récent : revoir une
 * ressource la rafraîchit (déplacée en fin de tableau), le dépassement de la capacité ou
 * du TTL oublie depuis le début. L'oubli est paresseux : il a lieu à la prochaine écriture
 * ou lecture, jamais par un balayage coûteux.
 */

export interface PerceptionMemoryConfig {
  foodMemoryTtlTicks: number;
  waterMemoryTtlTicks: number;
  maxFoodEntries: number;
  maxWaterEntries: number;
}

/**
 * Spirale déterministe par anneaux carrés autour de (x, z) : le premier point praticable
 * à distance de boire de l'eau gagne, donc le plus proche — sans tirage aléatoire.
 * Le point courant est testé d'abord : si l'on est déjà sur la rive, inutile d'avancer.
 */
export function scanForShorePoint(
  x: number,
  z: number,
  maxDistanceM: number,
  stepM: number,
  shoreDistanceM: number,
  isWalkable: (x: number, z: number) => boolean,
  distanceToWaterMeters: (x: number, z: number) => number,
): { x: number; z: number } | null {
  const fits = (candidateX: number, candidateZ: number): boolean =>
    isWalkable(candidateX, candidateZ) &&
    distanceToWaterMeters(candidateX, candidateZ) <= shoreDistanceM &&
    hasWalkableApproach(x, z, candidateX, candidateZ, stepM, isWalkable);
  if (fits(x, z)) return { x, z };

  const steps = Math.max(1, Math.ceil(maxDistanceM / stepM));
  for (let ring = 1; ring <= steps; ring++) {
    const radius = ring * stepM;
    for (let dx = -radius; dx <= radius; dx += stepM) {
      for (let dz = -radius; dz <= radius; dz += stepM) {
        if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
        const candidateX = x + dx;
        const candidateZ = z + dz;
        if (fits(candidateX, candidateZ)) return { x: candidateX, z: candidateZ };
      }
    }
  }
  return null;
}

/**
 * Écarte une rive visible mais située de l'autre côté de l'eau. Ce n'est pas un chemin de
 * remplacement : le pathfinding reste seul responsable du trajet final ; ce contrôle évite
 * seulement de mémoriser comme destination prioritaire un point dont l'approche directe est
 * déjà coupée par un obstacle.
 */
function hasWalkableApproach(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  stepM: number,
  isWalkable: (x: number, z: number) => boolean,
): boolean {
  const distance = Math.hypot(toX - fromX, toZ - fromZ);
  const steps = Math.max(1, Math.ceil(distance / stepM));
  for (let step = 1; step < steps; step++) {
    const ratio = step / steps;
    if (!isWalkable(fromX + (toX - fromX) * ratio, fromZ + (toZ - fromZ) * ratio)) return false;
  }
  return true;
}

/** Oublie les souvenirs de nourriture périmés. Mutations en place, retourne `memory`. */
export function forgetExpiredFood(
  memory: MemoryComponent,
  nowTick: number,
  config: PerceptionMemoryConfig,
): void {
  const expired = memory.food.filter(
    (entry) => entry.lastSeenTick < nowTick - config.foodMemoryTtlTicks,
  );
  if (expired.length > 0) {
    const kept = new Set(expired.map((entry) => entry.resourceId));
    memory.food = memory.food.filter((entry) => !kept.has(entry.resourceId));
  }
}

/** Oublie les souvenirs de rives périmés. Mutations en place, retourne `memory`. */
export function forgetExpiredWater(
  memory: MemoryComponent,
  nowTick: number,
  config: PerceptionMemoryConfig,
): void {
  memory.water = memory.water.filter(
    (entry) => entry.lastSeenTick >= nowTick - config.waterMemoryTtlTicks,
  );
}

/**
 * Enregistre une ressource comestible vue. Révoir la même ressource rafraîchit son souvenir
 * (dernière position, dernier tick) au lieu de la dupliquer.
 */
export function rememberFood(
  memory: MemoryComponent,
  seen: Omit<FoodMemoryEntry, 'lastSeenTick'>,
  nowTick: number,
  config: PerceptionMemoryConfig,
): void {
  forgetExpiredFood(memory, nowTick, config);
  const existing = memory.food.find((entry) => entry.resourceId === seen.resourceId);
  if (existing) {
    existing.x = seen.x;
    existing.z = seen.z;
    existing.foodKcal = seen.foodKcal;
    existing.lastSeenTick = nowTick;
    // Rafraîchissement : le souvenir le plus récent part en fin de tableau.
    memory.food.splice(memory.food.indexOf(existing), 1);
    memory.food.push(existing);
    return;
  }
  memory.food.push({ ...seen, lastSeenTick: nowTick });
  if (memory.food.length > config.maxFoodEntries) {
    memory.food.shift();
  }
}

/**
 * Enregistre une rive vue. Deux rives plus proches que `cellM` ne font qu'un souvenir :
 * la mémoire spatiale n'est pas une carte au centimètre.
 */
export function rememberWater(
  memory: MemoryComponent,
  seen: { x: number; z: number },
  nowTick: number,
  config: PerceptionMemoryConfig,
  cellM = 4,
): void {
  forgetExpiredWater(memory, nowTick, config);
  const cellX = Math.round(seen.x / cellM) * cellM;
  const cellZ = Math.round(seen.z / cellM) * cellM;
  const existing = memory.water.find(
    (entry) =>
      Math.round(entry.x / cellM) * cellM === cellX &&
      Math.round(entry.z / cellM) * cellM === cellZ,
  );
  if (existing) {
    existing.lastSeenTick = nowTick;
    return;
  }
  memory.water.push({ x: seen.x, z: seen.z, lastSeenTick: nowTick });
  if (memory.water.length > config.maxWaterEntries) {
    memory.water.shift();
  }
}

/** Rive mémorisée la plus proche, encore fraîche. */
export function nearestWater(
  memory: MemoryComponent,
  x: number,
  z: number,
  nowTick: number,
  config: PerceptionMemoryConfig,
): WaterMemoryEntry | null {
  forgetExpiredWater(memory, nowTick, config);
  let best: WaterMemoryEntry | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of memory.water) {
    const dx = entry.x - x;
    const dz = entry.z - z;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Ressource comestible mémorisée la plus proche, encore fraîche et pas encore cueillie.
 * `isRemoved` filtre les souvenirs périmés par le monde : un buisson mangé par un autre
 * ne vaut plus le voyage.
 */
export function nearestFood(
  memory: MemoryComponent,
  x: number,
  z: number,
  nowTick: number,
  config: PerceptionMemoryConfig,
  isRemoved: (resourceId: string) => boolean,
): FoodMemoryEntry | null {
  forgetExpiredFood(memory, nowTick, config);
  let best: FoodMemoryEntry | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of memory.food) {
    if (isRemoved(entry.resourceId)) continue;
    const dx = entry.x - x;
    const dz = entry.z - z;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best;
}
