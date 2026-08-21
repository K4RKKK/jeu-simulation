import type { ResourceSpawn } from '@civ/procedural';
import type { Observation, ObservationSource } from './observation.js';

/**
 * Construit les `Observation` que produit la perception — la frontière explicite entre
 * « lire le monde » (ce module, pur, sans écriture) et « écrire un souvenir »
 * (`rememberSpatial`, consommateur). `PerceptionSystem` ne construit plus directement
 * un souvenir depuis un `ResourceSpawn` : il produit d'abord une observation, qui ne
 * retient QUE ce qui est perceptible (position, apparence, référence technique de
 * revalidation) — jamais `foodKcal`/`foodToxicity01`, jamais `definitionId` comme
 * connaissance sémantique (voir `ResourceSpawn.perceptualConceptId`).
 *
 * CLAUDE.md règle 8 : logique pure, testable sans ECS ni monde.
 */

export function observeResource(
  spawn: ResourceSpawn,
  tick: number,
  source: ObservationSource = 'directPerception',
): Observation {
  return {
    kind: 'resource',
    x: spawn.x,
    z: spawn.z,
    tick,
    source,
    subjectConceptId: spawn.perceptualConceptId,
    worldRef: {
      type: 'resource',
      resourceId: spawn.id,
      ownerChunkKey: spawn.ownerChunkKey,
      localId: spawn.localId,
    },
  };
}

export function observeShore(
  point: { readonly x: number; readonly z: number },
  tick: number,
  source: ObservationSource = 'directPerception',
): Observation {
  return { kind: 'water', x: point.x, z: point.z, tick, source };
}
