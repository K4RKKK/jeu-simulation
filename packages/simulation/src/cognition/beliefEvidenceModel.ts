import { allocateBeliefId } from '../components/cognitiveKnowledge.js';
import type { CognitiveKnowledgeComponent } from '../components/cognitiveKnowledge.js';
import type { ConceptId } from './ids.js';

export interface ProbabilityEvidence {
  readonly subjectConcept: ConceptId;
  readonly property: string;
  readonly observedValue01: number;
  readonly tick: number;
  readonly source: 'selfExperience';
}

/** Met à jour une croyance probabiliste par moyenne empirique, une expérience à la fois. */
export function applyProbabilityEvidence(
  knowledge: CognitiveKnowledgeComponent,
  evidence: ProbabilityEvidence,
): void {
  const existing = knowledge.beliefs.find(
    (belief) =>
      belief.subjectConcept === evidence.subjectConcept && belief.property === evidence.property,
  );
  if (!existing) {
    knowledge.beliefs.push({
      id: allocateBeliefId(knowledge),
      subjectConcept: evidence.subjectConcept,
      property: evidence.property,
      value: { kind: 'probability', value01: evidence.observedValue01 },
      confidence01: 0.5,
      evidenceCount: 1,
      lastUpdatedTick: evidence.tick,
    });
    return;
  }
  const previous = existing.value.kind === 'probability' ? existing.value.value01 : 0.5;
  const count = existing.evidenceCount + 1;
  existing.value = {
    kind: 'probability',
    value01: (previous * existing.evidenceCount + evidence.observedValue01) / count,
  };
  existing.evidenceCount = count;
  existing.confidence01 = 1 - 1 / (count + 1);
  existing.lastUpdatedTick = evidence.tick;
}
