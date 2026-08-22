import { allocateBeliefId } from '../components/cognitiveKnowledge.js';
import type { CognitiveKnowledgeComponent } from '../components/cognitiveKnowledge.js';
import type { ConceptId } from './ids.js';

/**
 * Croyance sociale (Phase 3.8) — « j'ai vu au moins un humain consommer ce concept ».
 *
 * Volontairement SÉPARÉE de `food.nourishing` et `food.illnessRisk`, qui ne peuvent
 * être établies que par une ingestion PERSONNELLEMENT vécue. Voir un autre manger
 * quelque chose ne prouve pas que c'est nourrissant (peut-être qu'il n'était pas
 * repu), ni sûr (peut-être qu'il va tomber malade plus tard sans que l'observateur
 * le voie). Une propriété distincte évite qu'un appel accidentel avec
 * `source: 'directObservation'` puisse jamais toucher les croyances de sûreté/nutrition.
 *
 * Encodage :
 * - `BeliefValue.kind = 'probability'`, `value01` toujours à `1` : c'est une
 *   proposition positive (« ce concept EST ingéré par d'autres humains »), pas une
 *   fréquence. `1` n'est jamais faux : dès qu'un humain a été observé consommant ce
 *   concept, la proposition est vraie.
 * - `confidence01` : force de l'évidence sociale, mise à jour par une formule
 *   multiplicative — chaque observation directe la rapproche de 1 sans jamais
 *   l'atteindre : `next = 1 - (1 - current) * (1 - gain)`. Une seule observation à
 *   `gain = 0.25` donne 0.25 ; la 4ᵉ ≈ 0.68 ; la 10ᵉ ≈ 0.94.
 * - `evidenceCount` : nombre d'observations sociales directes (utile pour l'UI/debug).
 */
export const FOOD_OBSERVED_INGESTION_PROPERTY = 'food.observedIngestion';

export function applyObservedFoodIngestionEvidence(
  knowledge: CognitiveKnowledgeComponent,
  conceptId: ConceptId,
  tick: number,
  directObservationGain: number,
): void {
  const gain = clamp01(directObservationGain);
  const existing = knowledge.beliefs.find(
    (belief) =>
      belief.subjectConcept === conceptId && belief.property === FOOD_OBSERVED_INGESTION_PROPERTY,
  );
  if (existing === undefined) {
    knowledge.beliefs.push({
      id: allocateBeliefId(knowledge),
      subjectConcept: conceptId,
      property: FOOD_OBSERVED_INGESTION_PROPERTY,
      // Proposition positive : dès qu'un humain a été observé consommer ce concept,
      // la valeur est 1. La force reste modulée par confidence.
      value: { kind: 'probability', value01: 1 },
      confidence01: gain,
      evidenceCount: 1,
      lastUpdatedTick: tick,
    });
    return;
  }
  // Formule multiplicative : approche 1 sans jamais l'atteindre.
  existing.confidence01 = 1 - (1 - clamp01(existing.confidence01)) * (1 - gain);
  existing.evidenceCount += 1;
  existing.lastUpdatedTick = tick;
  // La valeur reste 1 : la proposition « ingéré par d'autres » ne se dégrade pas.
  existing.value = { kind: 'probability', value01: 1 };
}

/**
 * Retourne la confidence courante de la belief `food.observedIngestion` pour un
 * concept donné, ou `0` si aucune observation sociale n'a encore été consolidée.
 * Point d'entrée typé pour les consommateurs (ExperimentModel notamment) sans
 * qu'ils aient à connaître la structure de `CognitiveKnowledgeComponent.beliefs`.
 */
export function observedFoodIngestionConfidence01(
  knowledge: CognitiveKnowledgeComponent,
  conceptId: ConceptId | undefined | null,
): number {
  if (!conceptId) return 0;
  const belief = knowledge.beliefs.find(
    (candidate) =>
      candidate.subjectConcept === conceptId &&
      candidate.property === FOOD_OBSERVED_INGESTION_PROPERTY,
  );
  return belief === undefined ? 0 : clamp01(belief.confidence01);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
