import type { EntityId } from '@civ/shared';
import {
  CognitiveMemory,
  ObservableAction,
  Transform,
} from '../../components/index.js';
import type {
  CognitiveMemoryComponent,
  ObservableActionComponent,
  SocialMemoryEntry,
  TransformComponent,
} from '../../components/index.js';
import type { SystemFrequency } from '../../config/simulationConfig.js';
import { rememberEpisodic } from '../../cognition/episodicMemoryModel.js';
import {
  getOrCreateSocialEntry,
  recordObservedOccurrence,
} from '../../cognition/socialMemoryModel.js';
import type { SimulationSystem, SystemUpdateContext } from '../../core/system.js';
import { SocialSpatialIndex } from './socialSpatialIndex.js';

/**
 * Ce qu'un humain PERÇOIT directement d'un autre humain (Phase 3.8).
 *
 * Frontière stricte, verrouillée par tests : ce système lit UNIQUEMENT
 * - chez l'observateur : `Transform` + `CognitiveMemory` (pour écrire).
 * - chez l'acteur observé : `Transform` + `ObservableAction`.
 *
 * Il ne lit JAMAIS chez l'acteur : `Needs`, `NeedsState`, `HumanCognition`, `HumanPlan`,
 * `HumanSkills`, `CognitiveKnowledge`, `Personality`, ni le texte libre de
 * `Activity.reason` (qui fuite `Needs.hunger`). Voir un autre agir ≠ lire son état
 * interne — c'est précisément ce que cette phase interdit.
 *
 * Un observateur enregistre au plus UNE observation par occurrence physique
 * `(actorId, kind, startedAtTick, subjectConceptId)`. Un gather qui dure 8 s produit
 * un unique épisode côté observateur, pas huit ; une deuxième action ultérieure du
 * même acteur produit un nouvel épisode. Le rechargement conserve cette dédup grâce
 * aux champs persistés dans `SocialMemoryEntry`.
 *
 * Fréquence `medium` (comme `PerceptionSystem` et `LearningSystem`) : perceptions
 * humaines vs humaines rythmées à la même cadence. Ordre dans le pipeline : après
 * `NeedSatisfactionSystem` (qui projette `ObservableAction` au démarrage du gather/
 * eat), donc une action très courte peut être observée AU tick de son démarrage — la
 * consolidation d'apprentissage (Belief `food.observedIngestion`) suivra à la
 * prochaine passe `LearningSystem`. Voir défautSystems() dans simulation.ts.
 *
 * Éviction `SocialMemory` : quand `maxSocialEntries` est atteint, on refuse de créer
 * une nouvelle entrée pour un acteur si toutes les entrées existantes correspondent à
 * des acteurs ACTUELLEMENT observés — sinon la même occurrence physique pourrait être
 * ré-observée après éviction et générer un doublon d'épisode. Cette protection est
 * plus importante que d'apprendre à connaître un tout nouvel humain immédiatement.
 */
export class SocialObservationSystem implements SimulationSystem {
  readonly name = 'SocialObservationSystem';
  readonly frequency: SystemFrequency = 'medium';

  update(ctx: SystemUpdateContext): void {
    const visionRangeM = ctx.config.perception.visionRangeM;
    const config = ctx.config.cognition.socialObservation;

    // 1. Indexation O(N) des seuls ACTEURS visibles (portent ObservableAction).
    //    `activeActors` conserve les composants pour éviter un second lookup ECS
    //    à la consommation — les buckets ne portent que l'id, la position réelle
    //    de l'acteur est lue depuis `Transform` (jamais figée dans ObservableAction).
    const index = new SocialSpatialIndex(visionRangeM);
    const activeActors: Map<
      EntityId,
      { transform: TransformComponent; action: ObservableActionComponent }
    > = new Map();
    ctx.entities.each(
      [Transform, ObservableAction],
      (entity, transform, action) => {
        index.add(entity, transform.x, transform.z);
        activeActors.set(entity, { transform, action });
      },
    );

    if (activeActors.size === 0) return; // rien à observer, on épargne les passes observateur

    // 2. Chaque observateur (Transform + CognitiveMemory) interroge l'index à SA
    //    position actuelle. Un observateur qui est lui-même un acteur actif s'y
    //    trouvera dans les buckets, on l'exclut explicitement via observer !== actor.
    ctx.entities.each(
      [Transform, CognitiveMemory],
      (observer, observerTransform, observerMemory) => {
        index.forEachNear(
          observerTransform.x,
          observerTransform.z,
          visionRangeM,
          (actor) => {
            if (actor === observer) return; // pas d'auto-observation
            const record = activeActors.get(actor);
            if (record === undefined) return; // safety net : bucket incohérent (ne devrait pas arriver)
            this.observe(ctx, observerMemory, observer, actor, record.action, activeActors, config);
          },
        );
      },
    );
  }

  private observe(
    ctx: SystemUpdateContext,
    observerMemory: CognitiveMemoryComponent,
    observer: EntityId,
    actor: EntityId,
    action: ObservableActionComponent,
    activeActors: Map<EntityId, unknown>,
    config: {
      familiarityGainPerAction: number;
      maxSocialEntries: number;
    },
  ): void {
    // Éviction protectrice : si la mémoire est pleine ET que l'acteur observé n'y a
    // pas encore d'entrée, refuser plutôt que d'évincer une entrée d'un autre acteur
    // actuellement observé — car cette dernière porte la dédup de son occurrence en
    // cours, sans quoi un doublon d'épisode s'écrirait au prochain passage.
    const existing = observerMemory.social.find((entry) => entry.humanId === actor);
    if (existing === undefined && observerMemory.social.length >= config.maxSocialEntries) {
      const evicted = this.evictOldestUnprotected(observerMemory, activeActors);
      if (!evicted) {
        // Toutes les entrées sont protégées : on laisse tomber la nouvelle relation
        // plutôt que de fabriquer un doublon d'observation ; observer.
        return;
      }
    }

    const entry = getOrCreateSocialEntry(observerMemory, actor, ctx.tick);
    const isNewOccurrence = recordObservedOccurrence(
      entry,
      action.kind,
      action.startedAtTick,
      action.subjectConceptId,
      ctx.tick,
      config.familiarityGainPerAction,
    );
    if (!isNewOccurrence) return; // même occurrence physique — pas d'épisode, pas de familiarity

    rememberEpisodic(
      observerMemory,
      {
        tick: ctx.tick,
        eventType: 'social.actionObserved',
        actors: [observer, actor],
        ...(action.subjectConceptId === null ? {} : { subjectConcept: action.subjectConceptId }),
        outcome: 'social.action_perceived',
        // Intensité modérée : plus notable qu'une gorgée d'eau (0.15), moins qu'un
        // traumatisme personnel (0.8). Une observation sociale n'est pas un événement
        // physiologique — elle ne doit pas survivre à des dizaines d'événements vécus.
        emotionalStrength01: 0.25,
        experience: {
          kind: 'social.actionObserved',
          actorId: actor,
          observedAction: action.kind,
          subjectConceptId: action.subjectConceptId,
          actionStartedTick: action.startedAtTick,
          observationTick: ctx.tick,
          source: 'directObservation',
        },
      },
      ctx.config.cognition,
    );
  }

  /**
   * Retire l'entrée `lastContactTick` la plus ancienne parmi celles dont l'acteur n'est
   * PAS actuellement observable. Tie-break par `humanId` pour déterminisme total.
   * Retourne `true` si une entrée a été retirée, `false` si tout est protégé.
   */
  private evictOldestUnprotected(
    memory: CognitiveMemoryComponent,
    activeActors: Map<EntityId, unknown>,
  ): boolean {
    let victimIndex = -1;
    let victimLastContact = Number.POSITIVE_INFINITY;
    let victimHumanId = Number.POSITIVE_INFINITY;
    for (let i = 0; i < memory.social.length; i++) {
      const candidate = memory.social[i]!;
      if (activeActors.has(candidate.humanId)) continue;
      if (
        candidate.lastContactTick < victimLastContact ||
        (candidate.lastContactTick === victimLastContact && candidate.humanId < victimHumanId)
      ) {
        victimIndex = i;
        victimLastContact = candidate.lastContactTick;
        victimHumanId = candidate.humanId;
      }
    }
    if (victimIndex < 0) return false;
    memory.social.splice(victimIndex, 1);
    return true;
  }
}

// Ré-export purement documentaire — permet aux tests d'affirmer par typage stricte que
// l'entrée manipulée est bien un SocialMemoryEntry, sans importer depuis `components/`.
export type { SocialMemoryEntry };
