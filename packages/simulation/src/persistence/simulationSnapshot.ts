import type { EntityId, WorldId } from '@civ/shared';
import {
  Activity,
  CognitiveKnowledge,
  CognitiveMemory,
  Human,
  HumanCognition,
  HumanPlan,
  HumanSkills,
  InteractiveResource,
  Memory,
  Movement,
  Needs,
  NeedsState,
  ObservableAction,
  Personality,
  Transform,
  createEmptyCognitiveKnowledge,
  createEmptyCognitiveMemory,
  createEmptyHumanCognition,
  createEmptyHumanPlan,
  createEmptyHumanSkills,
} from '../components/index.js';
import type { SimulationClockState } from '../core/clock.js';
import type { ComponentType } from '../core/componentType.js';
import type { EntityManager } from '../core/entityManager.js';
import type { SchedulerState } from '../core/scheduler.js';
import type { WorldRngState } from '../core/rng.js';
import type { SimulationEvent } from '../core/events.js';
import type { ResourceDelta, TrailChunkDelta } from '../world/worldDelta.js';

/**
 * Version du schéma de snapshot.
 *
 * Un chargement d'une sauvegarde faite avec une version ≠ celle-ci doit être refusé :
 * les champs peuvent avoir changé de nom, de type, ou avoir été ajoutés. Aucune
 * migration silencieuse — le seul comportement sûr est de rejeter.
 */
// v5 : NeedsState.mealMaxGain ajouté.
// v6 : configFingerprint couvre désormais aussi la génération procédurale
// (WorldGenerationConfig) et le contenu déclaratif (biomes, ressources, profils
// d'eau), pas seulement SimulationConfig + géométrie — voir Simulation.currentConfigFingerprint.
// Une sauvegarde v5 était calculée avec une formule différente ; la rejeter plutôt que
// de comparer une empreinte v5 à une empreinte v6 évite un faux « configuration
// incompatible » ou, pire, un faux positif de compatibilité.
// v7 : `ResourceDelta.ownerChunkKey` ajouté — la révision des ressources est
// désormais tenue PAR CHUNK (`WorldDelta.resourceRevision`), plus par un compteur
// global, ce qui exige de savoir à quel chunk appartient chaque delta restauré. Un
// snapshot v6 n'a pas ce champ : le charger silencieusement produirait des entrées
// « ownerChunkKey: undefined », un chunk fantôme dans `resourceRevisions` plutôt
// qu'une erreur claire.
// v8 : `Memory.lastFoodChunkX/Z` renommés `lastFoodScanX/Z` — le scan de nourriture se
// déclenche maintenant à la distance parcourue (comme l'eau), plus au changement de
// chunk (bug corrigé, voir `PerceptionConfig.foodRescanMoveThresholdM`). Un snapshot
// v7 restauré silencieusement laisserait ces champs à `undefined` : comme
// `undefined !== null`, la garde de rescan les traiterait comme « déjà scannés depuis
// une position connue », or `distance2D(x, z, undefined, undefined)` vaut `NaN`, et
// `NaN >= seuil` est toujours faux — l'individu resterait aveugle à toute nouvelle
// nourriture pour le reste de la partie.
// v9 : `ResourceDelta.localId` ajouté (adresse réseau dupliquée pour éviter de
// rechercher le spawn correspondant à chaque reconstruction de chunk) et
// `remainingServings` unifié en `remainingFraction01` dans `changedFields` — même forme
// que ce que `resource:updated` diffuse au réseau. Un snapshot v8 restauré
// silencieusement laisserait `localId: undefined` (adresse réseau invalide) et un
// éventuel `remainingServings` que plus rien ne lit.
// L'historique durable des événements majeurs a été ajouté de façon progressive sans
// bumper le schéma : contrairement aux composants ou au WorldDelta, son absence ne
// change jamais l'évolution simulée. Une sauvegarde v9 antérieure est donc restaurée
// avec un historique vide, puis sa prochaine écriture embarque ce nouveau champ.
// v10 : trois composants cognitifs ajoutés (`CognitiveMemory`, `CognitiveKnowledge`,
// `HumanCognition` — Phase 3.1). Contrairement à `history`, leur absence N'EST PAS sans
// conséquence : les systèmes qui les liront à partir de 3.2 s'attendent à ce que TOUT
// humain les porte (attachés par `HumanFactory.create`, jamais optionnels une fois
// vivants) — un humain restauré sans eux ferait échouer `getComponentOrThrow` au premier
// accès. Contrairement aux bumps v5-v9 (qui rejettent l'ancienne version), celui-ci est
// accompagné d'une migration explicite (`migrateSnapshotV9ToV10`, appelée par
// `Simulation.restoreSnapshot`) : le contenu utile d'une sauvegarde v9 (des heures de
// vie d'une civilisation) ne change pas, seuls trois composants vides doivent être
// ajoutés pour chaque humain existant — un rejet pur aurait été une perte de données
// injustifiée pour une V1 déjà distribuée aux joueurs.
// v11 : Phase 3.2 — deux bugs corrigés dans `SpatialMemoryEntry` et `Belief.value`.
// (1) `encodedConfidence01`/`encodedPrecisionM` ajoutés à `SpatialMemoryEntry` : sans eux,
// `ForgettingSystem` recalculait la confiance depuis la valeur fraîche PAR DÉFAUT
// (`freshSpatialConfidence01`), ce qui rehaussait artificiellement un souvenir faiblement
// encodé (ex. information sociale future, confiance 0,4) jusqu'à la valeur d'une
// perception directe. Migration : `encodedConfidence01 = confidence01`,
// `encodedPrecisionM = precisionM` (snapshot pris juste après l'observation — les deux
// valeurs coïncident donc nécessairement au moment de la sauvegarde). En parallèle, les
// sauvegardes v10 antérieures au correctif taguaient à tort une simple vision comme
// `selfExperience` ; migration : `source === 'selfExperience'` → `'directPerception'`.
// (2) `Belief.value` resserré de `string` à un discriminant fermé (`probability` /
// `category` / `scalar`) : un `value: string` libre aurait fini comparé par égalité de
// chaîne dans des dizaines de systèmes futurs avec un risque de désaccord silencieux.
// Migration : une ancienne valeur `string` devient `{ kind: 'category', code: value }`.
// v12 : Phase 3.5 — `MemoryComponent` réduit aux seules positions de scan
// (`lastFoodScanX/Z`, `lastWaterScanX/Z`) ; les tableaux `food`/`water` (souvenirs
// spécifiques nourriture/eau) ont été retirés car plus aucun consommateur : la mémoire
// spatiale vit désormais dans `CognitiveMemory.spatial`, lue par `NeedSatisfactionSystem`.
// Migration : les entrées Memory d'une sauvegarde v11 sont acceptées telles quelles, mais
// `food`/`water` sont dépouillés lors de la restauration — l'information n'est PAS
// reportée dans `CognitiveMemory` (déjà rempli à part par le PerceptionSystem de v11+, et
// une reprojection créerait des souvenirs dupliqués sans confiance ni précision correcte).
// Perte de fonctionnalité assumée : au chargement, la décision vitale attend un nouveau
// scan (quelques ticks) avant d'avoir un souvenir de rive/ressource utilisable.
// v14 : Phase 3.3 - ingestion experiences are consolidated separately by LearningSystem.
// The persisted watermark prevents loading a save from learning the same episode twice.
// Legacy food.edible probabilities migrate to inverse food.illnessRisk probabilities.
// v17 : voluntary food experiments persist plan intent and experienced motivation.
// v18 : individual procedural skills and timed gathering state are persisted.
export const SIMULATION_SNAPSHOT_VERSION = 18;

/**
 * Instantané du monde suffisant pour rejouer identiquement à partir de cet instant.
 *
 * Modèle : « état réel = seed + version de génération + configuration + snapshot ».
 * Ce que **contient** ce snapshot :
 * - horloge (`clock`) : sans quoi le nombre de ticks écoulés serait perdu.
 * - RNG (`rng`) : sans quoi un `wander` post-chargement partirait dans un autre sens.
 * - entités & composants : la matière vivante du monde.
 * - ordonnanceur (`scheduler`) : `lastRunTick`/`hasRun`, faute de quoi le premier
 *   tick post-chargement recevrait un `deltaGameSeconds` erroné (bug subtil sur le
 *   métabolisme et la perception).
 * - `WorldDelta` : la seule vérité persistante sur les ressources modifiées ou
 *   consommées.
 * - `history` : événements majeurs bornés qui alimentent la Chronique après reconnexion.
 * - `configFingerprint` (v3, étendu en v6) : empreinte de la `SimulationConfig` + la
 *   géométrie du monde + (depuis v6) les paramètres de génération procédurale
 *   (`WorldGenerationConfig`) et le contenu déclaratif (biomes, ressources, profils
 *   d'eau). Bug corrigé en v3 : avant ce champ, une sauvegarde faite avec
 *   `walkSpeedMps=1.4` était acceptée sans broncher par un serveur reconfiguré à `1.8`
 *   — même seed, même `generationVersion` si on avait oublié de la bumper. Bug corrigé
 *   en v6 : un ajustement de `hydrology.waterLevel01` ou de la toxicité d'une baie,
 *   oublié dans le bump manuel de `generationVersion`, passait pareillement inaperçu.
 *   Voir `configFingerprint.ts` et `Simulation.currentConfigFingerprint`.
 *
 * Ce qui n'y est **pas** :
 * - le monde procédural lui-même (terrain, biomes assignés, ressources placées —
 *   rejoué depuis la seed) — `generationVersion` en reste la seule garde contre un
 *   changement de l'ALGORITHME de génération ; `configFingerprint` protège contre une
 *   dérive des PARAMÈTRES qui l'alimentent (numériques ou déclaratifs), pas contre une
 *   réécriture du code de génération lui-même.
 * - le `WorldChangeJournal` (flux réseau volatile).
 * - la file du `PathfindingSystem` (une requête en vol est perdue à la sauvegarde ;
 *   le système ré-émet une requête au tick suivant si la cible existe encore) — ET,
 *   plus largement, le cache LRU de chemins déjà résolus et la file à budget que
 *   maintient `PathFindingService` (`@civ/pathfinding`), qui ne sont pas non plus
 *   sérialisés. Conséquence mesurée (test « continu vs rechargé » à seed fixe,
 *   population 10+, rechargement à mi-parcours) : une branche continue a un cache
 *   « chaud » (trajets répétés résolus instantanément), une branche rechargée repart
 *   d'un cache froid. Une requête résolue immédiatement dans un cas devient une requête
 *   différée de quelques ticks dans l'autre, ce qui décale le tick auquel l'entité se
 *   met en mouvement. Comme les streams de `WorldRng` sont consommés séquentiellement à
 *   travers `entities.each()`, ce décalage se propage à toutes les entités traitées
 *   après elle dans le même tick — le hash `hashWorldState` diverge de la branche
 *   continue en quelques ticks après un rechargement, même à un point de quiescence
 *   (aucune requête en vol). Ce n'est PAS une régression de correction : les chemins
 *   restent valides, les humains arrivent toujours à destination — seule la
 *   *trajectoire précise dans le temps* diverge. Le déterminisme garanti par ce
 *   snapshot est donc : hash identique AU tick de sauvegarde, pas nécessairement
 *   ensuite. Combler ça exigerait de sérialiser des structures internes de
 *   `@civ/pathfinding` (cache LRU + file à budget), ce que la Règle 2 et la
 *   cartographie des responsabilités (pathfinding ignore tout du snapshot) découragent
 *   — accepté comme limite de scope plutôt que bug à corriger.
 * - les métriques, l'`EventBus` et son tampon de diffusion (session-local).
 */
export interface SimulationSnapshot {
  readonly version: number;
  /** Identité permanente du monde, distincte de sa seed et de son slot de sauvegarde. */
  readonly worldId?: WorldId;
  readonly seed: string;
  readonly generationVersion: string;
  /** Empreinte de la config + géométrie du monde — voir `configFingerprint.ts`. */
  readonly configFingerprint: string;
  readonly clock: SimulationClockState;
  readonly rng: WorldRngState;
  readonly entities: EntitiesSnapshot;
  readonly scheduler: SchedulerState;
  readonly delta: { deltas: ResourceDelta[]; trails: TrailChunkDelta[] };
  readonly history?: SimulationEvent[];
  /** Absent sur les sauvegardes v9 antérieures à la repousse régionale. */
  readonly ecologyVersion?: number;
}

export interface EntitiesSnapshot {
  readonly nextEntityId: EntityId;
  readonly ids: EntityId[];
  /**
   * Composants par nom → liste triée de `[entityId, valeur]`. La valeur est un JSON
   * simple : les composants sont des données pures (règle 8).
   */
  readonly components: Record<string, [EntityId, unknown][]>;
}

/**
 * Types de composants pris en charge par le snapshot. Ajouter un nouveau composant
 * ECS *sans* l'ajouter ici l'exclurait de la persistance — d'où la liste centralisée.
 * Le nom sert de clé stable côté serialization (l'index numérique de `defineComponent`
 * dépend de l'ordre d'import et n'est pas stable entre versions).
 *
 * Exportée (avec `INTENTIONALLY_UNPERSISTED_COMPONENT_NAMES` ci-dessous) pour que
 * `simulationSnapshot.componentCoverage.test.ts` puisse vérifier qu'AUCUN composant
 * enregistré via `defineComponent` n'est absent des deux listes — un ajout muet
 * (« Knowledge » demain, oublié ici) romprait la persistance sans qu'aucun test ne le
 * révèle avant un redémarrage réel en production.
 */
export const PERSISTED_COMPONENTS: readonly ComponentType<unknown>[] = [
  Transform,
  Movement,
  Human,
  Personality,
  Activity,
  Needs,
  NeedsState,
  Memory,
  InteractiveResource,
  CognitiveMemory,
  CognitiveKnowledge,
  HumanCognition,
  HumanPlan,
  HumanSkills,
  // Phase 3.8 — action publiquement observable pendant gather/eat. Persister plutôt que
  // reconstruire évite un couplage inversé où `restoreSnapshot` devrait connaître la
  // sémantique du couple `(Activity.kind, NeedsState.*)` pour recomposer l'action visible.
  ObservableAction,
];

/**
 * Composants sciemment exclus de la persistance, avec leur justification. Un composant
 * qui n'apparaît ni ici ni dans `PERSISTED_COMPONENTS` est un composant qu'on a oublié
 * de trancher — c'est exactement ce que le test de couverture détecte.
 */
export const INTENTIONALLY_UNPERSISTED_COMPONENT_NAMES: ReadonlySet<string> = new Set([
  // Réinitialisé à zéro au chargement : un plan d'errance interrompu n'a pas besoin de
  // survivre à un redémarrage, l'individu recommencera à errer normalement.
  'TemporaryWanderState',
]);

const COMPONENT_BY_NAME: Map<string, ComponentType<unknown>> = new Map(
  PERSISTED_COMPONENTS.map((type) => [type.name, type]),
);

/**
 * Migre un snapshot v9 vers v10 : ajoute les trois composants cognitifs (Phase 3.1),
 * vides, pour chaque humain déjà présent — voir la doc de `SIMULATION_SNAPSHOT_VERSION`.
 *
 * Pure et idempotente : ne mute jamais `snapshot`, retourne toujours un nouvel objet.
 * Si un humain porte déjà (improbable mais possible en théorie — snapshot déjà
 * partiellement migré) une entrée pour l'un de ces composants, elle est conservée telle
 * quelle plutôt qu'écrasée par un défaut vide.
 */
export function migrateSnapshotV9ToV10(snapshot: SimulationSnapshot): SimulationSnapshot {
  if (snapshot.version !== 9) {
    throw new Error(`migrateSnapshotV9ToV10: version ${snapshot.version} inattendue (9 requis)`);
  }

  const humanIds = (snapshot.entities.components.Human ?? []).map(([id]) => id);

  const backfill = (name: string, makeDefault: () => unknown): [EntityId, unknown][] => {
    const existing = new Map(snapshot.entities.components[name] ?? []);
    return humanIds.map((id) => [id, existing.get(id) ?? makeDefault()]);
  };

  return {
    ...snapshot,
    version: 10,
    entities: {
      ...snapshot.entities,
      components: {
        ...snapshot.entities.components,
        CognitiveMemory: backfill('CognitiveMemory', createEmptyCognitiveMemory),
        CognitiveKnowledge: backfill('CognitiveKnowledge', createEmptyCognitiveKnowledge),
        HumanCognition: backfill('HumanCognition', createEmptyHumanCognition),
      },
    },
  };
}

/**
 * Migre un snapshot v10 vers v11 — deux corrections de Phase 3.2 :
 * (1) Backfille `encodedConfidence01`/`encodedPrecisionM` depuis les valeurs courantes
 *     de chaque `SpatialMemoryEntry` (au moment de la sauvegarde, les deux valeurs
 *     coïncident nécessairement : le souvenir vient d'être perçu ou n'a pas encore subi
 *     de décroissance différentielle). Corrige aussi les `source === 'selfExperience'`
 *     écrits par erreur par le `PerceptionSystem` v10 initial (simple vision ≠ expérience
 *     vécue) — ils deviennent `'directPerception'`.
 * (2) Convertit les `Belief.value: string` (format libre pré-3.2) en
 *     `{ kind: 'category', code: string }` — le discriminant fermé introduit en 3.2.
 *
 * Pure et idempotente : ne mute jamais `snapshot`, retourne toujours un nouvel objet.
 */
export function migrateSnapshotV10ToV11(snapshot: SimulationSnapshot): SimulationSnapshot {
  if (snapshot.version !== 10) {
    throw new Error(`migrateSnapshotV10ToV11: version ${snapshot.version} inattendue (10 requis)`);
  }

  type SpatialEntryLegacy = {
    id: number;
    kind: string;
    x: number;
    z: number;
    lastSeenTick: number;
    confidence01: number;
    precisionM: number;
    encodedConfidence01?: number;
    encodedPrecisionM?: number;
    decayAnchorTick?: number;
    source: string;
    subjectConceptId?: string;
    worldRef?: unknown;
  };
  type CognitiveMemoryLegacy = {
    nextMemoryId: number;
    spatial: SpatialEntryLegacy[];
    episodic: unknown[];
    social: unknown[];
  };
  type BeliefLegacy = {
    id: number;
    subjectConcept: string;
    property: string;
    value: { kind: string } | string;
    confidence01: number;
    evidenceCount: number;
    lastUpdatedTick: number;
  };
  type CognitiveKnowledgeLegacy = { nextBeliefId: number; beliefs: BeliefLegacy[] };

  const cogMemEntries = (snapshot.entities.components.CognitiveMemory ?? []) as unknown as [
    EntityId,
    CognitiveMemoryLegacy,
  ][];
  const migratedCogMem: [EntityId, unknown][] = cogMemEntries.map(([id, mem]) => [
    id,
    {
      ...mem,
      spatial: mem.spatial.map((entry) => ({
        ...entry,
        encodedConfidence01: entry.encodedConfidence01 ?? entry.confidence01,
        encodedPrecisionM: entry.encodedPrecisionM ?? entry.precisionM,
        // Les valeurs courantes deviennent la nouvelle baseline à l'instant du snapshot :
        // repartir de lastSeenTick les ferait décroître une seconde fois.
        decayAnchorTick: entry.decayAnchorTick ?? snapshot.clock.currentTick,
        source: entry.source === 'selfExperience' ? 'directPerception' : entry.source,
      })),
    },
  ]);

  const cogKnowEntries = (snapshot.entities.components.CognitiveKnowledge ?? []) as unknown as [
    EntityId,
    CognitiveKnowledgeLegacy,
  ][];
  const migratedCogKnow: [EntityId, unknown][] = cogKnowEntries.map(([id, know]) => [
    id,
    {
      ...know,
      beliefs: know.beliefs.map((belief) => ({
        ...belief,
        value:
          typeof belief.value === 'string'
            ? { kind: 'category' as const, code: belief.value }
            : belief.value,
      })),
    },
  ]);

  return {
    ...snapshot,
    version: 11,
    entities: {
      ...snapshot.entities,
      components: {
        ...snapshot.entities.components,
        CognitiveMemory: migratedCogMem,
        CognitiveKnowledge: migratedCogKnow,
      },
    },
  };
}

/**
 * Migre un snapshot v11 vers v12 (Phase 3.5) : retire `food`/`water` des entrées
 * `Memory`, désormais réduites aux positions de scan. Voir la doc de
 * `SIMULATION_SNAPSHOT_VERSION` pour le compromis (perte de mémoire spécifique acceptée :
 * `CognitiveMemory` est déjà remplie et sera rescannée en quelques ticks).
 *
 * Pure et idempotente : ne mute jamais `snapshot`, retourne toujours un nouvel objet.
 */
export function migrateSnapshotV11ToV12(snapshot: SimulationSnapshot): SimulationSnapshot {
  if (snapshot.version !== 11) {
    throw new Error(`migrateSnapshotV11ToV12: version ${snapshot.version} inattendue (11 requis)`);
  }

  type MemoryLegacy = {
    food?: unknown[];
    water?: unknown[];
    lastFoodScanX: number | null;
    lastFoodScanZ: number | null;
    lastWaterScanX: number | null;
    lastWaterScanZ: number | null;
  };

  const memoryEntries = (snapshot.entities.components.Memory ?? []) as unknown as [
    EntityId,
    MemoryLegacy,
  ][];
  const migratedMemory: [EntityId, unknown][] = memoryEntries.map(([id, mem]) => {
    const { food: _f, water: _w, ...kept } = mem;
    return [id, kept];
  });

  return {
    ...snapshot,
    version: 12,
    entities: {
      ...snapshot.entities,
      components: {
        ...snapshot.entities.components,
        Memory: migratedMemory,
      },
    },
  };
}

/** Migre v12 vers v13 : ancre explicite de décroissance et état de décision ajouté. */
export function migrateSnapshotV12ToV13(snapshot: SimulationSnapshot): SimulationSnapshot {
  if (snapshot.version !== 12) {
    throw new Error(`migrateSnapshotV12ToV13: version ${snapshot.version} inattendue (12 requis)`);
  }
  const components = snapshot.entities.components;
  type LegacySpatial = { lastSeenTick: number; decayAnchorTick?: number; [key: string]: unknown };
  type LegacyCognitiveMemory = { spatial: LegacySpatial[]; [key: string]: unknown };
  type LegacyComponent = Record<string, unknown>;
  const cognitiveMemory = (components.CognitiveMemory ?? []) as unknown as [
    EntityId,
    LegacyCognitiveMemory,
  ][];
  const memory = (components.Memory ?? []) as unknown as [EntityId, LegacyComponent][];
  const needsState = (components.NeedsState ?? []) as unknown as [EntityId, LegacyComponent][];
  return {
    ...snapshot,
    version: 13,
    entities: {
      ...snapshot.entities,
      components: {
        ...components,
        CognitiveMemory: cognitiveMemory.map(([id, value]) => [
          id,
          {
            ...value,
            spatial: value.spatial.map((entry) => ({
              ...entry,
              decayAnchorTick: entry.decayAnchorTick ?? entry.lastSeenTick,
            })),
          },
        ]),
        Memory: memory.map(([id, value]) => [
          id,
          { ...value, lastFoodScanTick: null, lastWaterScanTick: null },
        ]),
        NeedsState: needsState.map(([id, value]) => [
          id,
          {
            ...value,
            resourceConceptId: value.resourceConceptId ?? null,
            currentMealCausedPoisoning: value.currentMealCausedPoisoning ?? false,
          },
        ]),
      },
    },
  };
}

/** v13 -> v14 : apprentissage séparé, watermark et croyances nutrition/risque. */
export function migrateSnapshotV13ToV14(snapshot: SimulationSnapshot): SimulationSnapshot {
  if (snapshot.version !== 13) {
    throw new Error(`migrateSnapshotV13ToV14: version ${snapshot.version} inattendue (13 requis)`);
  }
  type LegacyMemory = { episodic: { id: number }[]; [key: string]: unknown };
  type LegacyKnowledge = {
    beliefs: { property: string; value: unknown; [key: string]: unknown }[];
    [key: string]: unknown;
  };
  type LegacyNeedsState = Record<string, unknown>;
  const components = snapshot.entities.components;
  const memories = (components.CognitiveMemory ?? []) as unknown as [EntityId, LegacyMemory][];
  const knowledge = (components.CognitiveKnowledge ?? []) as unknown as [
    EntityId,
    LegacyKnowledge,
  ][];
  const needsStates = (components.NeedsState ?? []) as unknown as [EntityId, LegacyNeedsState][];
  return {
    ...snapshot,
    version: 14,
    entities: {
      ...snapshot.entities,
      components: {
        ...components,
        CognitiveMemory: memories.map(([id, memory]) => [
          id,
          {
            ...memory,
            lastProcessedExperienceId:
              memory.episodic.length === 0 ? null : memory.episodic[memory.episodic.length - 1]!.id,
          },
        ]),
        CognitiveKnowledge: knowledge.map(([id, entry]) => [
          id,
          {
            ...entry,
            beliefs: entry.beliefs.map((belief) => {
              if (belief.property !== 'food.edible') return belief;
              const value = belief.value as { kind?: string; value01?: number };
              return {
                ...belief,
                property: 'food.illnessRisk',
                value:
                  value.kind === 'probability'
                    ? { kind: 'probability', value01: 1 - (value.value01 ?? 0.5) }
                    : belief.value,
              };
            }),
          },
        ]),
        // A v13 meal has no canonical hunger baseline, so it cannot yield learning evidence.
        NeedsState: needsStates.map(([id, state]) => [
          id,
          {
            ...state,
            mealStartedTick: -1,
            mealHungerBefore01: 0,
          },
        ]),
      },
    },
  };
}

/** v14 -> v15 : activeGoal structure l'intention au lieu d'un identifiant opaque. */
export function migrateSnapshotV14ToV15(snapshot: SimulationSnapshot): SimulationSnapshot {
  if (snapshot.version !== 14) {
    throw new Error(`migrateSnapshotV14ToV15: version ${snapshot.version} inattendue (14 requis)`);
  }
  type LegacyCognition = Record<string, unknown>;
  const components = snapshot.entities.components;
  const cognitions = (components.HumanCognition ?? []) as unknown as [EntityId, LegacyCognition][];
  return {
    ...snapshot,
    version: 15,
    entities: {
      ...snapshot.entities,
      components: {
        ...components,
        HumanCognition: cognitions.map(([id, cognition]) => {
          const { activeGoalId: _legacyGoalId, ...rest } = cognition;
          return [id, { ...rest, activeGoal: null }];
        }),
      },
    },
  };
}

/** v15 -> v16 : active short-term plans become persisted working memory. */
export function migrateSnapshotV15ToV16(snapshot: SimulationSnapshot): SimulationSnapshot {
  if (snapshot.version !== 15) {
    throw new Error(`migrateSnapshotV15ToV16: version ${snapshot.version} inattendue (15 requis)`);
  }
  return {
    ...snapshot,
    version: 16,
    entities: {
      ...snapshot.entities,
      components: {
        ...snapshot.entities.components,
        HumanPlan: snapshot.entities.ids.map((id) => [id, createEmptyHumanPlan()]),
      },
    },
  };
}

/** v16 -> v17 : food actions distinguish survival from deliberate experimentation. */
export function migrateSnapshotV16ToV17(snapshot: SimulationSnapshot): SimulationSnapshot {
  if (snapshot.version !== 16) {
    throw new Error(`migrateSnapshotV16ToV17: version ${snapshot.version} inattendue (16 requis)`);
  }
  type LegacyPlan = { activePlan?: { steps?: Record<string, unknown>[] } | null } & Record<
    string,
    unknown
  >;
  type LegacyMemory = { episodic?: Record<string, unknown>[] } & Record<string, unknown>;
  type LegacyNeedsState = { action?: unknown } & Record<string, unknown>;
  const components = snapshot.entities.components;
  const plans = (components.HumanPlan ?? []) as unknown as [EntityId, LegacyPlan][];
  const memories = (components.CognitiveMemory ?? []) as unknown as [EntityId, LegacyMemory][];
  const needsStates = (components.NeedsState ?? []) as unknown as [EntityId, LegacyNeedsState][];
  return {
    ...snapshot,
    version: 17,
    entities: {
      ...snapshot.entities,
      components: {
        ...components,
        HumanPlan: plans.map(([id, plan]) => [
          id,
          {
            ...plan,
            activePlan:
              plan.activePlan === null || plan.activePlan === undefined
                ? (plan.activePlan ?? null)
                : {
                    ...plan.activePlan,
                    steps: (plan.activePlan.steps ?? []).map((step) =>
                      step.kind === 'eat.resource'
                        ? { ...step, intent: step.intent ?? 'satisfyNeed' }
                        : step,
                    ),
                  },
          },
        ]),
        CognitiveMemory: memories.map(([id, memory]) => [
          id,
          {
            ...memory,
            episodic: (memory.episodic ?? []).map((episode) => {
              const experience = episode.experience as Record<string, unknown> | undefined;
              return experience?.kind === 'food.ingestion'
                ? { ...episode, experience: { ...experience, motivation: 'need' } }
                : episode;
            }),
          },
        ]),
        NeedsState: needsStates.map(([id, state]) => [
          id,
          {
            ...state,
            foodIntent:
              state.action === 'seekFood' || state.action === 'eat' ? 'satisfyNeed' : null,
          },
        ]),
      },
    },
  };
}

/** v17 -> v18: add empty individual skills without fabricating past practice. */
export function migrateSnapshotV17ToV18(snapshot: SimulationSnapshot): SimulationSnapshot {
  if (snapshot.version !== 17) {
    throw new Error(`migrateSnapshotV17ToV18: version ${snapshot.version} inattendue (17 requis)`);
  }
  type LegacyNeedsState = Record<string, unknown>;
  const components = snapshot.entities.components;
  const needsStates = (components.NeedsState ?? []) as unknown as [EntityId, LegacyNeedsState][];
  const humanIds = (components.Human ?? []).map(([id]) => id);
  return {
    ...snapshot,
    version: 18,
    entities: {
      ...snapshot.entities,
      components: {
        ...components,
        HumanSkills: humanIds.map((id) => [id, createEmptyHumanSkills()]),
        NeedsState: needsStates.map(([id, state]) => [id, { ...state, gatherStartedTick: -1 }]),
      },
    },
  };
}

/**
 * Sérialise l'état des entités. Les composants non listés dans `PERSISTED_COMPONENTS`
 * sont ignorés silencieusement : c'est la source d'un bug potentiel si un nouveau
 * composant apparaît, d'où la liste centralisée. Un test de rappel doit vérifier que
 * tout composant introduit y est ajouté.
 */
export function captureEntities(entities: EntityManager): EntitiesSnapshot {
  const ids = entities.allEntities();
  const components: Record<string, [EntityId, unknown][]> = {};
  const stores = entities.storesByName();
  for (const type of PERSISTED_COMPONENTS) {
    const store = stores.get(type.name);
    if (!store) {
      components[type.name] = [];
      continue;
    }
    const entries: [EntityId, unknown][] = [];
    for (const [id, value] of store.entries()) {
      // Copie profonde légère : sans elle, muter le composant après capture muterait
      // le snapshot. JSON round-trip suffit pour des données pures.
      entries.push([id, JSON.parse(JSON.stringify(value))]);
    }
    entries.sort((a, b) => a[0] - b[0]);
    components[type.name] = entries;
  }
  return { nextEntityId: entities.nextId, ids: [...ids], components };
}

/**
 * Restaure l'état des entités dans un `EntityManager` vidé au préalable.
 *
 * Chaque valeur de composant est **copiée** avant d'être injectée dans le store — bug
 * corrigé : sans cette copie, la simulation restaurée recevait une référence directe
 * vers l'objet du snapshot. Les systèmes mutent les composants en place
 * (`transform.x = …`), ce qui finissait par corrompre le snapshot lui-même ; un second
 * chargement du même snapshot recevait alors un état partiellement muté par la
 * première simulation restaurée, brisant le déterminisme (deux simulations restaurées
 * depuis le même snapshot devaient être indépendantes, elles ne l'étaient pas).
 */
export function restoreEntities(entities: EntityManager, snapshot: EntitiesSnapshot): void {
  entities.clear();
  for (const id of snapshot.ids) entities.restoreEntity(id);
  // `forceNextId`, pas `restoreNextId` : on remplace l'état vivant en entier, le
  // compteur précédent (issu d'une population initiale jetable créée avant le
  // chargement, potentiellement plus grand que celui du snapshot) n'a plus de sens.
  entities.forceNextId(snapshot.nextEntityId);
  for (const [name, entries] of Object.entries(snapshot.components)) {
    const type = COMPONENT_BY_NAME.get(name);
    if (!type) {
      // Composant inconnu : on refuse plutôt que d'ignorer silencieusement — un
      // chargement partiel briserait le déterminisme sans crier gare.
      throw new Error(`restoreEntities: composant inconnu "${name}" — schema désynchronisé ?`);
    }
    for (const [id, value] of entries) {
      entities.restoreComponent(id, type, JSON.parse(JSON.stringify(value)));
    }
  }
}
