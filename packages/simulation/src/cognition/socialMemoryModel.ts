import type { EntityId } from '@civ/shared';
import type {
  CognitiveMemoryComponent,
  ObservableActionKind,
  SocialMemoryEntry,
} from '../components/index.js';
import { allocateMemoryId } from '../components/cognitiveMemory.js';
import type { ConceptId } from './ids.js';

/**
 * Logique pure de la mémoire sociale (CLAUDE.md règle 8 : testable sans ECS). Phase 3.8.
 *
 * Deux invariants forts :
 * - `trust01` est initialisé neutre (`0.5`) et JAMAIS modifié par la simple observation.
 *   Familiarity ≠ Trust : voir souvent quelqu'un ne le rend pas automatiquement fiable.
 * - Une même occurrence physique (identifiée par `(kind, startedAtTick,
 *   subjectConceptId)`) ne produit qu'un seul épisode chez l'observateur. Toute passe
 *   ultérieure sur la même occurrence rafraîchit `lastContactTick` sans écrire d'épisode
 *   ni ré-incrémenter `familiarity01`.
 */

const NEUTRAL_TRUST01 = 0.5;

/**
 * Retourne l'entrée sociale existante pour `actorId`, ou en crée une nouvelle (avec
 * `trust01` neutre, `familiarity01 = 0`, aucun dédup d'occurrence). Ajoute l'entrée à
 * `memory.social` — l'appelant reste responsable de gérer l'éviction (voir
 * `socialObservationSystem.ts` pour la protection des acteurs actuellement visibles).
 */
export function getOrCreateSocialEntry(
  memory: CognitiveMemoryComponent,
  actorId: EntityId,
  contactTick: number,
): SocialMemoryEntry {
  const existing = memory.social.find((entry) => entry.humanId === actorId);
  if (existing !== undefined) return existing;
  const created: SocialMemoryEntry = {
    id: allocateMemoryId(memory),
    humanId: actorId,
    trust01: NEUTRAL_TRUST01,
    familiarity01: 0,
    lastContactTick: contactTick,
    lastObservedActionKind: null,
    lastObservedActionStartedTick: -1,
    lastObservedActionConceptId: null,
  };
  memory.social.push(created);
  return created;
}

/**
 * Compare `(kind, startedAtTick, subjectConceptId)` observé maintenant à l'occurrence
 * précédemment stockée sur l'entrée. Retourne `true` si c'est une NOUVELLE occurrence
 * (le triplet diffère) et met à jour l'entrée en conséquence. Retourne `false` si c'est
 * la même occurrence (l'appelant n'écrit alors PAS d'épisode).
 *
 * Effets de bord : dans tous les cas, `lastContactTick` est actualisé. Une nouvelle
 * occurrence incrémente aussi `familiarity01` par `familiarityGainPerAction`.
 */
export function recordObservedOccurrence(
  entry: SocialMemoryEntry,
  observedKind: ObservableActionKind,
  observedStartedAtTick: number,
  observedConceptId: ConceptId | null,
  observationTick: number,
  familiarityGainPerAction: number,
): boolean {
  entry.lastContactTick = observationTick;
  const sameOccurrence =
    entry.lastObservedActionKind === observedKind &&
    entry.lastObservedActionStartedTick === observedStartedAtTick &&
    entry.lastObservedActionConceptId === observedConceptId;
  if (sameOccurrence) return false;
  entry.lastObservedActionKind = observedKind;
  entry.lastObservedActionStartedTick = observedStartedAtTick;
  entry.lastObservedActionConceptId = observedConceptId;
  entry.familiarity01 = clamp01(entry.familiarity01 + clamp01(familiarityGainPerAction));
  return true;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
