import type { CognitiveKnowledgeComponent } from '../components/cognitiveKnowledge.js';
import { applyProbabilityEvidence } from './beliefEvidenceModel.js';
import type { ConceptId } from './ids.js';

export const FOOD_NOURISHING_PROPERTY = 'food.nourishing';
export const FOOD_ILLNESS_RISK_PROPERTY = 'food.illnessRisk';
export const FOOD_EDIBLE_PROPERTY = 'food.edible';

export function learnedFoodProbability01(
  knowledge: CognitiveKnowledgeComponent,
  conceptId: ConceptId | undefined,
  property: typeof FOOD_NOURISHING_PROPERTY | typeof FOOD_ILLNESS_RISK_PROPERTY,
): number | null {
  if (!conceptId) return null;
  const belief = knowledge.beliefs.find(
    (candidate) => candidate.subjectConcept === conceptId && candidate.property === property,
  );
  return belief?.value.kind === 'probability' ? belief.value.value01 : null;
}

export function effectiveFoodProbability01(
  knowledge: CognitiveKnowledgeComponent,
  conceptId: ConceptId | undefined,
  property: typeof FOOD_NOURISHING_PROPERTY | typeof FOOD_ILLNESS_RISK_PROPERTY,
): number | null {
  if (!conceptId) return null;
  const belief = knowledge.beliefs.find(
    (candidate) => candidate.subjectConcept === conceptId && candidate.property === property,
  );
  if (belief?.value.kind !== 'probability') return null;
  return 0.5 + belief.confidence01 * (belief.value.value01 - 0.5);
}

export function applyFoodIngestionEvidence(
  knowledge: CognitiveKnowledgeComponent,
  conceptId: ConceptId,
  nourishingObserved: boolean,
  illnessObserved: boolean,
  tick: number,
): void {
  applyProbabilityEvidence(knowledge, {
    subjectConcept: conceptId,
    property: FOOD_NOURISHING_PROPERTY,
    observedValue01: nourishingObserved ? 1 : 0,
    tick,
    source: 'selfExperience',
  });
  applyProbabilityEvidence(knowledge, {
    subjectConcept: conceptId,
    property: FOOD_ILLNESS_RISK_PROPERTY,
    observedValue01: illnessObserved ? 1 : 0,
    tick,
    source: 'selfExperience',
  });
}
