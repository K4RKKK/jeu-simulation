import type { SpatialMemoryEntry, WorldRef } from '../components/cognitiveMemory.js';

/**
 * Requêtes de la mémoire spatiale générique (CLAUDE.md règle 8 : logique pure, testable
 * sans ECS). Complète `spatialMemoryModel.ts` (écriture, décroissance) côté LECTURE : les
 * décideurs (`NeedSatisfactionSystem` en 3.5, l'IA utilitaire en 3.4+) ne fouillent plus
 * `Memory.food`/`Memory.water` (index étroit) mais interrogent ici la mémoire cognitive
 * générique, avec confiance et précision prises en compte.
 *
 * Un souvenir n'est jamais « le plus proche à vol d'oiseau ». Deux points d'eau
 * équidistants ne valent pas la même chose si l'un a été vu la semaine dernière et l'autre
 * ce matin. Le score combine :
 *
 *   coût effectif = distance + precisionM
 *
 * Le flou de position paie comme du déplacement supplémentaire : un souvenir imprécis
 * demande d'errer autour du point mémorisé pour retrouver la vraie rive. La confiance
 * divise ensuite ce coût : `score = coût / confidence01`. Un souvenir à confiance très
 * basse voit son score exploser et perd contre un souvenir plus lointain mais net.
 *
 * Nul « paramètre magique » ici : precisionM et distance sont déjà en mètres, la confiance
 * est un ratio ; la formule reste sans coefficient à équilibrer. Un raffinement pondéré
 * pourrait suivre si le comportement observé le demande.
 */

const CONFIDENCE_FLOOR = 1e-3; // évite la division par zéro ; en pratique `ForgettingSystem` purge bien avant.

function score(entry: SpatialMemoryEntry, fromX: number, fromZ: number): number {
  const dx = entry.x - fromX;
  const dz = entry.z - fromZ;
  const distance = Math.hypot(dx, dz);
  const effectiveCost = distance + entry.precisionM;
  return effectiveCost / Math.max(entry.confidence01, CONFIDENCE_FLOOR);
}

/**
 * Meilleur souvenir de rive praticable connu. Retourne `null` si la mémoire n'en contient
 * aucun. Ne filtre ni ne modifie la mémoire (le vieillissement/purge est du ressort de
 * `ForgettingSystem`) : lecture pure.
 */
export function nearestKnownWater(
  spatial: readonly SpatialMemoryEntry[],
  fromX: number,
  fromZ: number,
): SpatialMemoryEntry | null {
  let best: SpatialMemoryEntry | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const entry of spatial) {
    if (entry.kind !== 'water') continue;
    const s = score(entry, fromX, fromZ);
    if (s < bestScore) {
      best = entry;
      bestScore = s;
    }
  }
  return best;
}

/**
 * Meilleur souvenir de ressource comestible connue, encore présente dans le monde.
 *
 * La cognition ne retient pas les kcal (vérité moteur cachée, voir la doc de
 * `SpatialMemoryEntry`) : pour distinguer « nourriture » d'« autre ressource »
 * (pierre, buisson non alimentaire…), on retombe sur le monde via `resolveSpawn` — dont
 * la valeur `foodKcal` sert de filtre. Cette relecture n'est pas de l'omniscience :
 * `NeedSatisfactionSystem` allait déjà interroger le monde par `worldRef` à l'arrivée
 * pour connaître la toxicité ; ici on le fait juste plus tôt, sur au plus
 * `maxSpatialEntries` (80) candidats.
 *
 * `isDepleted` écarte les ressources marquées comme épuisées dans `WorldDelta` : un
 * buisson mangé par un voisin ne vaut plus le voyage. Retourne `{ entry, spawn }` — le
 * décideur peut lire `worldRef` ET la valeur nutritionnelle du spawn en un seul aller.
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
    if (entry.kind !== 'resource') continue;
    if (entry.foodCandidate !== true) continue;
    if (!entry.worldRef) continue;
    if (isDepleted(entry.worldRef.resourceId)) continue;
    const spawn = resolveSpawn(entry.worldRef);
    if (!spawn) continue;
    // Une préférence apprise affine un souvenir déjà valide, elle ne le rend jamais
    // impossible : à faim extrême, une piste très suspecte reste une option de survie.
    const s = score(entry, fromX, fromZ) / Math.max(0.1, preference(entry, spawn));
    if (s < bestScore) {
      best = { entry, spawn };
      bestScore = s;
    }
  }
  return best;
}
