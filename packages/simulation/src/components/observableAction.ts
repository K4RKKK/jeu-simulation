import type { ConceptId } from '../cognition/ids.js';
import { defineComponent } from '../core/componentType.js';

/**
 * Ce qu'un autre humain peut voir un acteur faire — la seule projection publique de
 * l'état interne d'un acteur qu'un observateur a le droit de lire.
 *
 * Contrat strict (Phase 3.8) : ce composant ne contient QUE des informations réellement
 * perceptibles à distance. Il ne contient jamais la faim de l'acteur, sa motivation
 * (`FoodActionIntent`), la valeur nutritionnelle de ce qu'il manipule, sa toxicité, sa
 * maîtrise (`HumanSkills`), ses croyances, son plan, son goal, ni le texte libre de
 * `Activity.reason` (qui fuite `Needs.hunger` sous forme littérale — un observateur ne
 * doit pas parser cette chaîne).
 *
 * Volontairement PAS de position :
 * - `SocialObservationSystem` lit la position ACTUELLE de l'acteur via `Transform`,
 *   jamais une position figée. Un acteur qui a bougé entre le début de son action et
 *   l'instant présent est visible ou non selon où il est MAINTENANT, pas où il a
 *   commencé — sinon deux observateurs verraient l'action à des positions incohérentes.
 * - L'identité d'occurrence est portée par `(actorId, kind, startedAtTick,
 *   subjectConceptId)`, pas par la position — ces quatre champs suffisent à distinguer
 *   deux occurrences successives, y compris à la même localisation.
 *
 * Lifecycle : écrit / remplacé / effacé UNIQUEMENT par `NeedSatisfactionSystem` (le
 * décideur qui pose déjà `Activity`). Aucun autre système ne mute ce composant. Absent
 * quand l'humain ne fait rien de socialement observable (idle, walking, seekFood,
 * seekWater — décision Phase 3.8, drink/rest ne sont pas encore projetés).
 *
 * Persistance : présent dans `PERSISTED_COMPONENTS`. Persister plutôt que reconstruire
 * évite un couplage inversé où `Simulation.restoreSnapshot` devrait connaître la
 * sémantique du couple `(Activity.kind, NeedsState.*)` pour recomposer l'action visible.
 */
export type ObservableActionKind = 'resource.gathering' | 'food.ingestion';

export interface ObservableActionComponent {
  readonly kind: ObservableActionKind;
  readonly startedAtTick: number;
  /**
   * Concept perceptif de ce qui est manipulé/consommé — jamais un `definitionId`
   * moteur. Deux ressources moteur distinctes qui se ressemblent (même
   * `perceptualConceptId`) produisent la même valeur ici. `null` acceptable quand
   * aucun concept n'a pu être projeté (rare, ne bloque pas l'observation elle-même
   * mais évite de générer une évidence sociale mal étiquetée en aval).
   */
  readonly subjectConceptId: ConceptId | null;
}

export const ObservableAction = defineComponent<ObservableActionComponent>('ObservableAction');
