import type {
  CognitiveKnowledgeComponent,
  CognitiveMemoryComponent,
  DecisionFactor,
  PersonalityComponent,
  SpatialMemoryEntry,
} from '../components/index.js';
import type { WorldRef } from './worldRef.js';
import { FOOD_ILLNESS_RISK_PROPERTY, FOOD_NOURISHING_PROPERTY } from './foodBeliefModel.js';
import { observedFoodIngestionConfidence01 } from './socialFoodBeliefModel.js';

export type ExperimentKind = 'food.try';

export interface ExperimentCandidate {
  readonly kind: ExperimentKind;
  readonly target: WorldRef;
  readonly subjectConceptId: string;
  readonly rememberedX: number;
  readonly rememberedZ: number;
  readonly score01: number;
  readonly uncertainty01: number;
  readonly factors: readonly DecisionFactor[];
}

export interface ExperimentationConfig {
  readonly minimumInterest01: number;
  readonly recentRepeatSeconds: number;
  readonly distanceScaleMeters: number;
  /**
   * Poids de l'imitation sociale dans le score `food.try` (Phase 3.8) : la belief
   * `food.observedIngestion` module la base par `(1 + weight * confidence)`, jamais
   * ne l'écrase — une croyance de danger personnelle forte, une caution élevée, ou
   * une distance importante restent dominantes. Vient de
   * `cognition.socialObservation.imitationWeight`.
   */
  readonly socialImitationWeight: number;
}

interface ProbabilityBelief {
  readonly probability01: number;
  readonly confidence01: number;
}

function probabilityBelief(
  knowledge: CognitiveKnowledgeComponent,
  conceptId: string,
  property: string,
): ProbabilityBelief | null {
  const belief = knowledge.beliefs.find(
    (candidate) => candidate.subjectConcept === conceptId && candidate.property === property,
  );
  if (belief?.value.kind !== 'probability') return null;
  return { probability01: belief.value.value01, confidence01: belief.confidence01 };
}

function outcomeAmbiguity01(belief: ProbabilityBelief): number {
  return clamp01(4 * belief.probability01 * (1 - belief.probability01));
}

function beliefInformationNeed01(belief: ProbabilityBelief | null): number {
  if (belief === null) return 1;
  return clamp01((1 - belief.confidence01) * (0.5 + 0.5 * outcomeAmbiguity01(belief)));
}

/** Information still missing; known outcome variability is represented separately. */
export function foodUncertainty01(
  knowledge: CognitiveKnowledgeComponent,
  conceptId: string,
): number {
  const nourishing = probabilityBelief(knowledge, conceptId, FOOD_NOURISHING_PROPERTY);
  const illnessRisk = probabilityBelief(knowledge, conceptId, FOOD_ILLNESS_RISK_PROPERTY);
  return (beliefInformationNeed01(nourishing) + beliefInformationNeed01(illnessRisk)) / 2;
}

/** Variability believed from observed outcomes, not ignorance and not world truth. */
export function foodOutcomeAmbiguity01(
  knowledge: CognitiveKnowledgeComponent,
  conceptId: string,
): number | null {
  const beliefs = [
    probabilityBelief(knowledge, conceptId, FOOD_NOURISHING_PROPERTY),
    probabilityBelief(knowledge, conceptId, FOOD_ILLNESS_RISK_PROPERTY),
  ].filter((belief): belief is ProbabilityBelief => belief !== null);
  if (beliefs.length === 0) return null;
  return beliefs.reduce((sum, belief) => sum + outcomeAmbiguity01(belief), 0) / beliefs.length;
}

/**
 * A deliberate trial becomes attractive again gradually, without random cooldowns.
 * Episodes are bounded and may be evicted: long-term loop prevention comes primarily
 * from learned information value decreasing, not from this short-lived penalty.
 */
export function recentExperimentPenalty01(
  memory: CognitiveMemoryComponent,
  conceptId: string,
  tick: number,
  gameSecondsPerTick: number,
  recentRepeatSeconds: number,
): number {
  let latestTick = Number.NEGATIVE_INFINITY;
  for (const episode of memory.episodic) {
    const experience = episode.experience;
    if (
      experience?.kind === 'food.ingestion' &&
      experience.subjectConceptId === conceptId &&
      experience.motivation === 'deliberateExperiment'
    ) {
      latestTick = Math.max(latestTick, experience.outcomeTick);
    }
  }
  if (!Number.isFinite(latestTick) || recentRepeatSeconds <= 0) return 1;
  return clamp01(((tick - latestTick) * gameSecondsPerTick) / recentRepeatSeconds);
}

export function buildFoodExperimentCandidate(
  entry: SpatialMemoryEntry,
  memory: CognitiveMemoryComponent,
  knowledge: CognitiveKnowledgeComponent,
  personality: PersonalityComponent,
  fromX: number,
  fromZ: number,
  tick: number,
  gameSecondsPerTick: number,
  config: ExperimentationConfig,
): ExperimentCandidate | null {
  if (
    entry.kind !== 'resource' ||
    entry.foodCandidate !== true ||
    entry.worldRef === undefined ||
    entry.subjectConceptId === undefined
  ) {
    return null;
  }

  const conceptId = entry.subjectConceptId;
  const uncertainty01 = foodUncertainty01(knowledge, conceptId);
  const ambiguity01 = foodOutcomeAmbiguity01(knowledge, conceptId);
  const illnessRisk = probabilityBelief(knowledge, conceptId, FOOD_ILLNESS_RISK_PROPERTY);
  const believedRisk01 =
    illnessRisk === null
      ? null
      : 0.5 + illnessRisk.confidence01 * (illnessRisk.probability01 - 0.5);
  const riskTolerance01 = clamp01(
    1 - personality.caution * (believedRisk01 === null ? 0.25 : believedRisk01),
  );
  const distanceM = Math.hypot(entry.x - fromX, entry.z - fromZ) + entry.precisionM;
  const accessibility01 = clamp01(
    entry.confidence01 / (1 + distanceM / Math.max(1, config.distanceScaleMeters)),
  );
  const repeatPenalty01 = recentExperimentPenalty01(
    memory,
    conceptId,
    tick,
    gameSecondsPerTick,
    config.recentRepeatSeconds,
  );
  const baseScore01 = clamp01(
    uncertainty01 * personality.curiosity * accessibility01 * riskTolerance01 * repeatPenalty01,
  );
  // Phase 3.8 — support d'imitation : la confiance de la belief `food.observedIngestion`
  // (0 si aucune) module la base multiplicativement, jamais ne l'écrase. Un observateur
  // qui a personnellement été empoisonné plusieurs fois (illnessRisk élevé + caution
  // haute) garde une base très basse, et le support social ne la remonte pas au-dessus
  // du seuil `minimumInterest01` — vérifié par test KNOWN DANGER.
  const imitationSupport01 = observedFoodIngestionConfidence01(knowledge, conceptId);
  const score01 = clamp01(
    baseScore01 * (1 + clamp01(config.socialImitationWeight) * imitationSupport01),
  );

  return {
    kind: 'food.try',
    target: entry.worldRef,
    subjectConceptId: conceptId,
    rememberedX: entry.x,
    rememberedZ: entry.z,
    score01,
    uncertainty01,
    factors: [
      { code: 'knowledge.uncertainty', value: uncertainty01, conceptId },
      ...(ambiguity01 === null
        ? []
        : [{ code: 'knowledge.outcomeAmbiguity', value: ambiguity01, conceptId }]),
      { code: 'personality.curiosity', value: personality.curiosity },
      { code: 'personality.caution', value: personality.caution },
      believedRisk01 === null
        ? { code: 'knowledge.unknown', conceptId }
        : { code: 'knowledge.illnessRisk', value: believedRisk01, conceptId },
      { code: 'memory.confidence', value: entry.confidence01, conceptId },
      { code: 'experiment.recentPenalty', value: repeatPenalty01, conceptId },
      { code: 'social.imitationSupport', value: imitationSupport01, conceptId },
    ],
  };
}

/** Selects from bounded cognition only and retains no transient candidate state. */
export function selectFoodExperimentCandidate(
  memory: CognitiveMemoryComponent,
  knowledge: CognitiveKnowledgeComponent,
  personality: PersonalityComponent,
  fromX: number,
  fromZ: number,
  tick: number,
  gameSecondsPerTick: number,
  config: ExperimentationConfig,
  include: (entry: SpatialMemoryEntry) => boolean = () => true,
): ExperimentCandidate | null {
  let best: ExperimentCandidate | null = null;
  for (const entry of memory.spatial) {
    if (!include(entry)) continue;
    const candidate = buildFoodExperimentCandidate(
      entry,
      memory,
      knowledge,
      personality,
      fromX,
      fromZ,
      tick,
      gameSecondsPerTick,
      config,
    );
    if (candidate !== null && (best === null || candidate.score01 > best.score01)) best = candidate;
  }
  return best;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
