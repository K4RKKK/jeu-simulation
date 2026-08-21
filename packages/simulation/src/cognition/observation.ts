import type { ConceptId } from './ids.js';
import type { WorldRef } from './worldRef.js';

/**
 * D'où vient une information mémorisée — détermine la confiance qu'on peut y accorder.
 *
 * - `directPerception` : perçu par les sens, sans interaction ni conséquence vécue —
 *   voir une baie, apercevoir une rive. C'est la source la plus commune et, malgré son
 *   nom, PAS la plus fiable : un objet vu de loin peut être mal identifié.
 * - `selfExperience` : une conséquence vécue PERSONNELLEMENT (manger cette baie et
 *   constater l'effet — sous-phase 3.3). Strictement plus fiable qu'une simple
 *   perception : l'issue est connue, pas seulement l'apparence.
 * - `directObservation` : perception du résultat d'une action D'AUTRUI (voir un autre
 *   humain manger puis rester en bonne santé — sous-phase 3.8). Fiabilité intermédiaire :
 *   l'issue est connue, mais pas vécue par soi.
 * - `socialTransmission` : reçu de seconde main (sous-phase 3.9). La moins fiable :
 *   dépend de la confiance envers l'émetteur et de la qualité de la transmission.
 *
 * Bug corrigé : `PerceptionSystem` taguait initialement la simple vue d'une ressource ou
 * d'une rive comme `selfExperience` — confondant « je l'ai vue » avec « je l'ai vécue ».
 * Sans cette distinction, la future confiance moindre d'une observation sociale (3.9)
 * n'aurait eu aucune source de rang supérieur à laquelle se comparer de façon cohérente.
 *
 * La dégradation de confiance selon la source est appliquée par les systèmes qui
 * écrivent la mémoire ; ce type n'est qu'un tag descriptif, sans logique attachée.
 */
export type ObservationSource =
  'directPerception' | 'selfExperience' | 'directObservation' | 'socialTransmission';

/**
 * Information brute produite par la perception — jamais persistée telle quelle.
 *
 * Une observation ne contient que ce qui est réellement perceptible (forme, couleur,
 * position, mouvement…), jamais une vérité cachée du moteur (kcal exactes, toxicité,
 * `ResourceDefinition`). Elle est distillée par les systèmes de perception en entrées de
 * `CognitiveMemoryComponent` (voir `rememberSpatial`) — c'est cette distillation, pas
 * l'observation elle-même, qui devient un souvenir durable. Type de valeur transitoire,
 * volontairement sans composant ECS associé.
 *
 * `worldRef` est la référence technique permettant de revalider l'objet observé —
 * jamais une connaissance en soi (voir la doc de `WorldRef`). `subjectConceptId` est ce
 * que l'humain reconnaît réellement : deux vérités moteur différentes (deux
 * `ResourceDefinition` distinctes) peuvent partager le même `subjectConceptId` si elles
 * se ressemblent à l'œil — voir `ResourceSpawn.perceptualConceptId`.
 *
 * `confidence01`/`precisionM` sont des surcharges OPTIONNELLES : absentes, l'écrivain de
 * mémoire (`rememberSpatial`) applique les valeurs fraîches par défaut de
 * `CognitionConfig` (adaptées à une perception directe) ; une source future moins fiable
 * (observation sociale, 3.8/3.9) les fournira explicitement, plus basses.
 */
export interface Observation {
  readonly kind: 'water' | 'resource' | 'shelter' | 'human' | 'danger' | 'place';
  readonly x: number;
  readonly z: number;
  readonly tick: number;
  readonly source: ObservationSource;
  readonly subjectConceptId?: ConceptId;
  readonly worldRef?: WorldRef;
  readonly confidence01?: number;
  readonly precisionM?: number;
}
