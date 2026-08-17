import type { ConceptId } from './ids.js';

/**
 * D'où vient une information mémorisée — détermine la confiance qu'on peut y accorder.
 * Une expérience vécue directement (`selfExperience`) est en général plus fiable qu'une
 * observation d'autrui (`directObservation`), elle-même plus fiable qu'une information
 * reçue de seconde main (`socialTransmission`, voir P3.13). La dégradation de confiance
 * selon la source est appliquée par les systèmes qui écrivent la mémoire (à partir de
 * la sous-phase 3.2) ; ce type n'est qu'un tag descriptif, sans logique attachée.
 */
export type ObservationSource = 'selfExperience' | 'directObservation' | 'socialTransmission';

/**
 * Information brute produite par la perception — jamais persistée telle quelle.
 *
 * Une observation ne contient que ce qui est réellement perceptible (forme, couleur,
 * position, mouvement…), jamais une vérité cachée du moteur (kcal exactes, toxicité,
 * `ResourceDefinition`). Elle est distillée par les systèmes de perception (à partir de
 * 3.2) en entrées de `CognitiveMemoryComponent` — c'est cette distillation, pas
 * l'observation elle-même, qui devient un souvenir durable. Type de valeur transitoire,
 * volontairement sans composant ECS associé.
 */
export interface Observation {
  readonly subjectConcept: ConceptId;
  readonly x: number;
  readonly z: number;
  readonly tick: number;
  readonly source: ObservationSource;
}
