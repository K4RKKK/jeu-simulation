/**
 * Identifiants stables du moteur.
 *
 * Choix volontaire : les `EntityId` ne sont JAMAIS recyclés. Un compteur monotone évite
 * les références fantômes (une mémoire, une relation ou un snapshot réseau peuvent citer
 * une entité morte sans jamais désigner accidentellement une entité vivante), et rend les
 * identifiants directement persistables.
 */
export type EntityId = number;

/** Identifiant d'un monde persistant. Stable entre deux sauvegardes. */
export type WorldId = string;

/** Identifiant d'un chunk, de la forme `"cx:cz"`. */
export type ChunkId = string;

/** Aucune entité. Utilisé plutôt que `null` dans les composants numériques. */
export const NO_ENTITY: EntityId = 0;

export function isEntityId(value: unknown): value is EntityId {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
