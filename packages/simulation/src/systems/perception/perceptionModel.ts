/**
 * Fonction pure de scan (CLAUDE.md règle 8 : testable sans entités). Le
 * `PerceptionSystem` s'en sert pour trouver un point de rive praticable dans le voisinage ;
 * rien ici ne dépend du monde ni des entités — juste de la géométrie et de deux
 * prédicats fournis par l'appelant.
 *
 * Phase 3.5 : les caches spécifiques `Memory.food`/`Memory.water` et leurs helpers
 * (`rememberFood`/`rememberWater`/`nearestFood`/`nearestWater`) ont été retirés — la
 * mémoire spatiale vit maintenant dans `CognitiveMemory` (voir `cognition/spatialMemoryModel.ts`
 * pour l'écriture, `cognition/spatialMemoryQuery.ts` pour la lecture).
 */

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
