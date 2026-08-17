import type { BeliefId, ConceptId } from '../cognition/ids.js';
import { defineComponent } from '../core/componentType.js';

/**
 * Une croyance n'est pas une vérité recopiée depuis `ResourceDefinition` — elle est
 * construite (et corrigée) par l'expérience de CET humain (voir P3.4, sous-phase 3.3).
 * `value` reste une hypothèse textuelle volontairement libre à ce stade (ex. `"likely"`,
 * `"probablement dangereux"`) ; un vocabulaire de valeurs stabilisé viendra avec le
 * système d'expérience qui les produit réellement, pas avant.
 *
 * Exemple visé (non encore produit en 3.1) :
 * `{ subjectConcept: "berry:red:round", property: "edible", value: "likely", confidence01: 0.72 }`
 */
export interface Belief {
  readonly id: BeliefId;
  subjectConcept: ConceptId;
  property: string;
  value: string;
  confidence01: number;
  evidenceCount: number;
  lastUpdatedTick: number;
}

/**
 * Connaissances (croyances) de l'humain — jamais un singleton civilisation (CLAUDE.md,
 * « Aucune connaissance globale »). Deux humains peuvent porter des croyances
 * différentes, voire contradictoires, sur le même concept.
 *
 * `nextBeliefId` alloue les `BeliefId` de cet humain (voir `allocateBeliefId`) — un
 * compteur local, jamais un aléa. Toujours créé vide à la naissance ; rempli par le
 * système d'expérience à partir de la sous-phase 3.3.
 */
export interface CognitiveKnowledgeComponent {
  nextBeliefId: BeliefId;
  beliefs: Belief[];
}

export const CognitiveKnowledge =
  defineComponent<CognitiveKnowledgeComponent>('CognitiveKnowledge');

export function createEmptyCognitiveKnowledge(): CognitiveKnowledgeComponent {
  return { nextBeliefId: 0, beliefs: [] };
}

/** Alloue un `BeliefId` déterministe et met à jour le compteur du composant en place. */
export function allocateBeliefId(component: CognitiveKnowledgeComponent): BeliefId {
  const id = component.nextBeliefId;
  component.nextBeliefId += 1;
  return id;
}
