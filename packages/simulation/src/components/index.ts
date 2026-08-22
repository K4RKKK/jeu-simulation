import type { ActivityKind, Sex } from '@civ/shared';
import { defineComponent } from '../core/componentType.js';
import { CognitiveKnowledge } from './cognitiveKnowledge.js';
import { CognitiveMemory } from './cognitiveMemory.js';
import { HumanCognition } from './humanCognition.js';
import { HumanPlan } from './humanPlan.js';
import { InteractiveResource } from './interactiveResource.js';
import { Memory } from './memory.js';
import { Needs, NeedsState } from './needs.js';

export {
  CognitiveKnowledge,
  CognitiveMemory,
  HumanCognition,
  HumanPlan,
  InteractiveResource,
  Memory,
  Needs,
  NeedsState,
};
export { allocateBeliefId, createEmptyCognitiveKnowledge } from './cognitiveKnowledge.js';
export { allocateMemoryId, createEmptyCognitiveMemory } from './cognitiveMemory.js';
export { createEmptyHumanCognition } from './humanCognition.js';
export { createEmptyHumanPlan } from './humanPlan.js';
export type { Belief, CognitiveKnowledgeComponent } from './cognitiveKnowledge.js';
export type {
  CognitiveMemoryComponent,
  EpisodicMemoryEntry,
  SocialMemoryEntry,
  SpatialMemoryEntry,
  WorldRef,
} from './cognitiveMemory.js';
export type { DecisionFactor, DecisionReason, HumanCognitionComponent } from './humanCognition.js';
export type {
  ActivePlan,
  HumanPlanComponent,
  PlanFailure,
  PlanFailureReason,
  PlanFailureTarget,
  PlanStep,
} from './humanPlan.js';
export type { InteractiveResourceComponent } from './interactiveResource.js';
export type { MemoryComponent } from './memory.js';
export type { NeedsComponent, NeedsStateComponent } from './needs.js';

/**
 * Composants de la phase 1.
 *
 * Un composant est une **donnée pure** : pas de méthode, pas de référence vers un système,
 * pas de référence vers le monde. C'est ce qui permettra de les sérialiser tels quels et
 * de les stocker à terme dans des tableaux typés.
 */

/* ---------------------------------------------------------------- */

export interface TransformComponent {
  x: number;
  z: number;
  /**
   * Altitude du sol sous l'entité, en mètres.
   *
   * Elle est **dérivée** du terrain, jamais choisie : le `MovementSystem` la réaligne à
   * chaque déplacement. La stocker évite au client comme aux futurs systèmes (visibilité,
   * portée, chute) de réinterroger le terrain à chaque lecture.
   */
  y: number;
  /** Orientation en radians, 0 = +Z. */
  yaw: number;
}

export const Transform = defineComponent<TransformComponent>('Transform');

/* ---------------------------------------------------------------- */

export interface MovementComponent {
  /** Vitesse de marche propre à l'individu, en m/s. */
  walkSpeedMps: number;
  /** Vitesse instantanée, mise à jour par le `MovementSystem`. */
  currentSpeedMps: number;
  targetX: number | null;
  targetZ: number | null;
  /**
   * Points de passage du chemin en cours, en mètres, produit par le `PathfindingSystem`
   * et consommé par le `MovementSystem`. Donnée pure : le décideur n'y touche jamais.
   */
  waypoints: { x: number; z: number }[];
  /**
   * Cible pour laquelle un chemin est en cours de calcul. Tant qu'elle vaut la cible
   * courante, le système ne re-demande pas : le résultat arrivera au prochain traitement.
   */
  pathPendingFor: { x: number; z: number } | null;
  /**
   * Identifiant de la requête de chemin en vol pour cette entité.
   *
   * Sans lui, deux humains ayant la même destination pouvaient hériter du chemin calculé
   * pour l'autre (une PathRequest était appariée par cible plutôt que par entité). L'id
   * garantit qu'un outcome n'est appliqué qu'à l'entité qui l'a émis. `null` quand aucune
   * requête n'est en cours ; réinitialisé en même temps que `pathPendingFor`.
   */
  pathRequestId: number | null;
  /**
   * Position à laquelle le sentier a été échantillonné pour la dernière fois — `null`
   * tant qu'aucun échantillon n'a encore été pris. Sert au throttling de
   * `recordFootTraffic` (voir `MovementSystem.recordTraffic`) : sans lui, un pas de
   * quelques centimètres à 20 Hz redéclenchait un ré-échantillonnage complet du
   * segment à chaque tick, pour une usure imperceptible. Avec des centaines
   * d'humains en mouvement continu, ce coût devient significatif ; on n'échantillonne
   * maintenant qu'après un déplacement réel (voir `movement.trailSampleThresholdM`).
   */
  lastTrailSampleX: number | null;
  lastTrailSampleZ: number | null;
}

export const Movement = defineComponent<MovementComponent>('Movement');

/* ---------------------------------------------------------------- */

/** Identité et morphologie. Ce qui définit *qui* est l'individu, pas ce qu'il fait. */
export interface HumanComponent {
  name: string;
  sex: Sex;
  ageYears: number;
  heightM: number;
  massKg: number;
  /** Variation visuelle 0..1, purement descriptive. */
  tint: number;
  bornAtTick: number;
}

export const Human = defineComponent<HumanComponent>('Human');

/* ---------------------------------------------------------------- */

/**
 * Traits stables, chacun dans [0, 1].
 *
 * Ces valeurs ne sont pas décoratives : dès la phase 1, `curiosity` module la distance
 * d'exploration et `patience` la durée d'immobilité. Toute nouvelle prise de décision
 * devra les consulter plutôt que de tirer un nombre au hasard.
 */
export interface PersonalityComponent {
  curiosity: number;
  caution: number;
  sociability: number;
  aggression: number;
  patience: number;
  altruism: number;
  courage: number;
  perseverance: number;
}

export const Personality = defineComponent<PersonalityComponent>('Personality');

/* ---------------------------------------------------------------- */

/**
 * Ce que fait l'individu maintenant, et **pourquoi** (CLAUDE.md règle 12).
 *
 * `reason` est une phrase courte produite par le système décideur. Quand l'IA utilitaire
 * remplacera le wander temporaire, elle écrira ici la justification de son score gagnant.
 */
export interface ActivityComponent {
  kind: ActivityKind;
  reason: string;
  startedAtTick: number;
}

export const Activity = defineComponent<ActivityComponent>('Activity');
