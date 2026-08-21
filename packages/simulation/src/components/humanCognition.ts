import type { EntityId } from '@civ/shared';
import type { ConceptId } from '../cognition/ids.js';
import { defineComponent } from '../core/componentType.js';

/**
 * Un facteur qui a contribué à une décision — sémantique et machine-readable, jamais du
 * texte destiné à l'affichage (voir la doc de `DecisionReason`).
 *
 * Exemple : `{ code: 'need.thirst.urgency', value: 0.91 }`,
 * `{ code: 'memory.water.distance', value: 84, targetEntityId: undefined }`.
 */
export interface DecisionFactor {
  readonly code: string;
  readonly value?: number;
  readonly targetEntityId?: EntityId;
  readonly conceptId?: ConceptId;
}

/**
 * Pourquoi l'humain fait ce qu'il fait — la donnée sémantique brute, jamais une phrase.
 *
 * `code` est un identifiant machine stable (ex. `"need.thirst"`, `"goal.explore"`),
 * jamais une phrase UI (jamais `"J'ai très soif"`). La traduction en texte lisible pour
 * le joueur est un problème de présentation, résolu côté client à partir des codes —
 * exactement la séparation que `ActivityComponent.reason` (texte libre, aujourd'hui)
 * n'a PAS : `Activity.reason` reste inchangé et coexiste avec `DecisionReason` le temps
 * de la migration (P3.15 branchera ceci sur l'UI plus tard, pas avant que le Planner/
 * Utility AI existent réellement — 3.4+).
 */
export interface DecisionReason {
  readonly code: string;
  readonly factors: DecisionFactor[];
}

/**
 * État de décision/exécution de l'humain — le squelette sur lequel s'appuieront le
 * Goal system, le Planner et l'Utility AI (sous-phases post-3.2). `activeGoalId` reste
 * une référence opaque tant qu'aucun système Goal n'existe : `string | null`, jamais un
 * type `GoalId` inventé avant d'avoir un seul producteur/consommateur réel.
 *
 * Toujours créé vide à la naissance ; personne n'écrit dedans avant la sous-phase 3.4.
 */
export interface HumanCognitionComponent {
  activeGoalId: string | null;
  decisionReason: DecisionReason | null;
}

export const HumanCognition = defineComponent<HumanCognitionComponent>('HumanCognition');

export function createEmptyHumanCognition(): HumanCognitionComponent {
  return { activeGoalId: null, decisionReason: null };
}
