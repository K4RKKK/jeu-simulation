import { allocateBeliefId } from '../components/cognitiveKnowledge.js';
import type { CognitiveKnowledgeComponent } from '../components/cognitiveKnowledge.js';
import type { ConceptId } from './ids.js';

/** Propriété stable produite uniquement par les expériences d'ingestion. */
export const FOOD_EDIBLE_PROPERTY = 'food.edible';

/**
 * Probabilité apprise qu'un concept visuel soit comestible. `null` signifie qu'aucune
 * expérience personnelle ne permet encore de distinguer cette apparence.
 */
export function learnedEdibility01(
  knowledge: CognitiveKnowledgeComponent,
  conceptId: ConceptId | undefined,
): number | null {
  if (conceptId === undefined) return null;
  const belief = knowledge.beliefs.find(
    (candidate) =>
      candidate.subjectConcept === conceptId && candidate.property === FOOD_EDIBLE_PROPERTY,
  );
  return belief?.value.kind === 'probability' ? belief.value.value01 : null;
}

/**
 * Consolide une ingestion vécue. La moyenne empirique garde le modèle interprétable :
 * chaque repas sain ajoute 1, chaque empoisonnement ajoute 0, sans révéler la toxicité
 * réelle du monde.
 */
export function learnFoodEdibility(
  knowledge: CognitiveKnowledgeComponent,
  conceptId: ConceptId,
  wasEdible: boolean,
  tick: number,
): void {
  const sample = wasEdible ? 1 : 0;
  const existing = knowledge.beliefs.find(
    (candidate) =>
      candidate.subjectConcept === conceptId && candidate.property === FOOD_EDIBLE_PROPERTY,
  );

  if (existing === undefined) {
    knowledge.beliefs.push({
      id: allocateBeliefId(knowledge),
      subjectConcept: conceptId,
      property: FOOD_EDIBLE_PROPERTY,
      value: { kind: 'probability', value01: sample },
      confidence01: 0.5,
      evidenceCount: 1,
      lastUpdatedTick: tick,
    });
    return;
  }

  const previousEvidence = existing.value.kind === 'probability' ? existing.evidenceCount : 0;
  const previousValue = existing.value.kind === 'probability' ? existing.value.value01 : 0.5;
  const evidenceCount = previousEvidence + 1;
  existing.value = {
    kind: 'probability',
    value01: (previousValue * previousEvidence + sample) / evidenceCount,
  };
  existing.confidence01 = 1 - 1 / (evidenceCount + 1);
  existing.evidenceCount = evidenceCount;
  existing.lastUpdatedTick = tick;
}
