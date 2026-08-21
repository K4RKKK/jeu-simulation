import type { BeliefId, ConceptId } from '../cognition/ids.js';
import { defineComponent } from '../core/componentType.js';

/**
 * Valeur d'une croyance — machine-readable, jamais une phrase (même principe que
 * `DecisionReason`/`EpisodicMemoryEntry.eventType` : la simulation ne connaît que du
 * sémantique, la traduction en texte lisible est un problème de présentation).
 *
 * Bug évité en corrigeant avant que 3.3 ne produise de vraies croyances : un `value:
 * string` libre (`"likely"`, `"probablement dangereux"`) aurait fini comparé par égalité
 * de chaîne dans des dizaines de systèmes futurs, avec le risque qu'un système écrive
 * `"probably_safe"` et qu'un autre lise `"likely"` sans jamais se rencontrer. Trois formes
 * fermées suffisent pour l'instant :
 * - `probability` : une hypothèse graduée (« probablement comestible », confiance 0..1).
 * - `category` : une classification fermée par un code (`"edible"|"toxic"|"unknown"`, etc.
 *   — le vocabulaire de codes vit avec le système qui les produit, pas ici).
 * - `scalar` : une grandeur mesurée/estimée (ex. une distance de sécurité apprise).
 */
export type BeliefValue =
  | { readonly kind: 'probability'; readonly value01: number }
  | { readonly kind: 'category'; readonly code: string }
  | { readonly kind: 'scalar'; readonly value: number; readonly unit?: string };

/**
 * Une croyance n'est pas une vérité recopiée depuis `ResourceDefinition` — elle est
 * construite (et corrigée) par l'expérience de CET humain.
 *
 * Exemple produit par `foodBeliefModel` après une ingestion :
 * `{ subjectConcept: "berry:red:round", property: "edible",
 *    value: { kind: "probability", value01: 0.72 }, confidence01: 0.72 }`
 */
export interface Belief {
  readonly id: BeliefId;
  subjectConcept: ConceptId;
  property: string;
  value: BeliefValue;
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
 * compteur local, jamais un aléa. Toujours créé vide à la naissance puis alimenté par
 * les systèmes d'expérience.
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
