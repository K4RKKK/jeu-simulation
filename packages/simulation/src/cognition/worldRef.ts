/**
 * Référence technique vers l'objet du monde qui a produit un souvenir — sert à
 * revalider l'objet (existe-t-il encore ? a-t-il changé ?), jamais une connaissance de
 * l'humain lui-même. La connaissance sémantique, c'est `SpatialMemoryEntry.subjectConceptId`
 * (« ceci est le type de baie que je reconnais »), pas `worldRef` (« ceci est exactement
 * la ressource #348 du chunk 2:3 »). Un humain ne pense jamais en identifiants de chunk.
 *
 * Isolé ici pour éviter le cycle de types entre `cognitiveMemory.ts` (qui utilise
 * `ObservationSource` de `observation.ts`) et `observation.ts` (qui avait besoin de
 * `WorldRef` de `cognitiveMemory.ts`). Les deux importent maintenant depuis ce module neutre.
 */
export interface WorldRef {
  readonly type: 'resource';
  readonly resourceId: string;
  readonly ownerChunkKey: string;
  readonly localId: number;
}
