import type { EntityId } from '@civ/shared';
import type {
  ActivityComponent,
  Belief,
  CognitiveKnowledgeComponent,
  CognitiveMemoryComponent,
  HumanCognitionComponent,
  HumanPlanComponent,
  HumanSkillsComponent,
  LivedExperience,
  PlanFailure,
  HumanComponent,
  MemoryComponent,
  MovementComponent,
  NeedsComponent,
  NeedsStateComponent,
  PersonalityComponent,
  TransformComponent,
} from '../components/index.js';
import {
  Activity,
  CognitiveKnowledge,
  CognitiveMemory,
  Human,
  HumanCognition,
  HumanPlan,
  HumanSkills,
  Memory,
  Movement,
  Needs,
  NeedsState,
  Personality,
  Transform,
} from '../components/index.js';
import { quantize } from '../core/math.js';
import type { SimulationSnapshot } from '../persistence/simulationSnapshot.js';
import type { Simulation } from '../simulation.js';

/**
 * Vue neutre de l'état d'un monde, indépendante de sa provenance — une `Simulation`
 * vivante ou un `SimulationSnapshot` désérialisé. `fnv1aHashState` (le moteur de hash)
 * ne connaît que cette forme : il ne sait pas s'il hache un monde en cours d'exécution
 * ou un fichier de sauvegarde, ce qui garantit par construction que les deux chemins
 * produisent la même empreinte pour le même état logique — un seul jeu de champs à
 * maintenir, jamais deux copies à faire dériver.
 */
interface CanonicalState {
  readonly tick: number;
  readonly entityCount: number;
  readonly nextEntityId: EntityId;
  readonly rng: Readonly<Record<string, readonly number[]>>;
  readonly scheduler: readonly { name: string; lastRunTick: number; hasRun: boolean }[];
  readonly deltaJson: unknown;
  /** Triés par id — l'ordre d'écriture affecte le hash, il doit être canonique. */
  readonly humans: readonly CanonicalHuman[];
}

interface CanonicalHuman {
  readonly id: EntityId;
  readonly human: HumanComponent;
  readonly transform: TransformComponent;
  /**
   * Sous-ensemble de `MovementComponent` : `waypoints`/`pathPendingFor`/`pathRequestId`
   * sont volontairement absents — voir le commentaire au point d'écriture plus bas.
   */
  readonly movement: Pick<
    MovementComponent,
    'walkSpeedMps' | 'currentSpeedMps' | 'targetX' | 'targetZ'
  >;
  readonly activity: ActivityComponent;
  readonly personality: PersonalityComponent | null;
  readonly needs: NeedsComponent | null;
  readonly needsState: NeedsStateComponent | null;
  readonly memory: MemoryComponent | null;
  readonly cognitiveMemory: CognitiveMemoryComponent | null;
  readonly cognitiveKnowledge: CognitiveKnowledgeComponent | null;
  readonly cognition: HumanCognitionComponent | null;
  readonly humanPlan: HumanPlanComponent | null;
  readonly humanSkills: HumanSkillsComponent | null;
}

/**
 * Empreinte de l'état logique du monde.
 *
 * Sert de preuve de déterminisme : deux simulations partant de la même seed et ayant
 * exécuté le même nombre de ticks doivent produire la même empreinte. Les positions sont
 * quantifiées à 4 décimales, car comparer des flottants bruts testerait la reproductibilité
 * bit-à-bit de `Math.sin`, ce qui n'est pas le contrat visé.
 *
 * Bug corrigé : la version précédente ne couvrait que `Transform`, `Movement.target*`,
 * `Activity.kind` et trois besoins — un hash identique ne prouvait donc PAS une
 * simulation totalement identique. Deux simulations pouvaient avoir des `Memory`
 * différentes (souvenirs de nourriture/eau divergents), un RNG déjà désynchronisé (le
 * prochain tirage aurait divergé sans que le hash le voie avant le tick suivant), ou
 * une `NeedsState` différente (plan en cours) et passer quand même pour
 * « identiques ». Cette version couvre : RNG (tous les streams), l'ordonnanceur,
 * `WorldDelta` (ressources + sentiers), et par entité : `Transform`, `Movement`
 * (vitesse, cible), `Activity`, `Personality`, `Needs`, `NeedsState` (plan en cours),
 * `Memory` (souvenirs et positions de scan), et depuis la Phase 3.1 : `CognitiveMemory`,
 * `CognitiveKnowledge`, `HumanCognition` — sans quoi deux croyances ou souvenirs
 * cognitifs différents pourraient produire le même hash, exactement le faux positif déjà
 * corrigé une fois pour l'ancien `Memory`.
 *
 * **Volontairement exclus** : `Movement.waypoints`/`pathPendingFor`/`pathRequestId` — un
 * cache de calcul du `PathfindingSystem`, pas un état persisté (`restoreSnapshot` les
 * efface au chargement, voir `SimulationSnapshot`). Ce hash prouve donc l'égalité de
 * l'état PERSISTÉ, pas de la trajectoire exacte en vol : deux mondes avec ce hash
 * identique peuvent avoir un humain à mi-chemin d'une requête A* différente sans que ça
 * se voie ici — la position/cible finale, elles, sont couvertes et convergeront.
 */
export function hashWorldState(simulation: Simulation): string {
  return fnv1aHashState(canonicalStateFromSimulation(simulation));
}

/**
 * Empreinte canonique calculée DIRECTEMENT depuis un `SimulationSnapshot` — sans
 * reconstruire une `Simulation` complète (monde procédural, `EntityManager`,
 * ordonnanceur…) juste pour la vérifier.
 *
 * Garantie : pour tout snapshot `s` capturé depuis une simulation `sim`,
 * `hashSnapshot(s) === hashWorldState(sim)` au moment de la capture, ET
 * `hashSnapshot(s) === hashWorldState(restored)` après `restored.restoreSnapshot(s)` —
 * aucun des champs hachés n'est parmi ceux que `restoreSnapshot` efface au chargement
 * (`waypoints`/`pathPendingFor`/`pathRequestId`, déjà exclus du hash, voir plus bas).
 * C'est cette égalité à trois branches (capture, snapshot brut, rechargement) qui rend
 * un « hash canonique depuis le snapshot » utile : il permet de comparer un fichier de
 * sauvegarde à une simulation qui a continué de tourner SANS jamais être interrompue,
 * un test que comparer deux branches rechargées l'une contre l'autre ne peut pas faire
 * — les deux auraient pu partager le même bug de rechargement sans que rien ne le
 * révèle (voir `simulationSnapshot.test.ts`, « continu vs rechargé »).
 */
export function hashSnapshot(snapshot: SimulationSnapshot): string {
  return fnv1aHashState(canonicalStateFromSnapshot(snapshot));
}

function canonicalStateFromSimulation(simulation: Simulation): CanonicalState {
  const rngState = simulation.rng.getState();
  const schedulerState = simulation.scheduler.getState();

  const humans: CanonicalHuman[] = simulation.entities.query(Human).map((id) => {
    const human = simulation.entities.getComponentOrThrow(id, Human);
    const transform = simulation.entities.getComponentOrThrow(id, Transform);
    const movement = simulation.entities.getComponentOrThrow(id, Movement);
    const activity = simulation.entities.getComponentOrThrow(id, Activity);
    return {
      id,
      human,
      transform,
      movement,
      activity,
      personality: simulation.entities.getComponent(id, Personality) ?? null,
      needs: simulation.entities.getComponent(id, Needs) ?? null,
      needsState: simulation.entities.getComponent(id, NeedsState) ?? null,
      memory: simulation.entities.getComponent(id, Memory) ?? null,
      cognitiveMemory: simulation.entities.getComponent(id, CognitiveMemory) ?? null,
      cognitiveKnowledge: simulation.entities.getComponent(id, CognitiveKnowledge) ?? null,
      cognition: simulation.entities.getComponent(id, HumanCognition) ?? null,
      humanPlan: simulation.entities.getComponent(id, HumanPlan) ?? null,
      humanSkills: simulation.entities.getComponent(id, HumanSkills) ?? null,
    };
  });

  return {
    tick: simulation.clock.currentTick,
    entityCount: simulation.entities.entityCount,
    nextEntityId: simulation.entities.nextId,
    rng: rngState,
    scheduler: schedulerState.systems,
    deltaJson: simulation.world.delta.toJSON(),
    humans,
  };
}

function canonicalStateFromSnapshot(snapshot: SimulationSnapshot): CanonicalState {
  const componentMap = <T>(name: string): Map<EntityId, T> =>
    new Map((snapshot.entities.components[name] ?? []) as [EntityId, T][]);

  const humanById = componentMap<HumanComponent>('Human');
  const transformById = componentMap<TransformComponent>('Transform');
  const movementById = componentMap<MovementComponent>('Movement');
  const activityById = componentMap<ActivityComponent>('Activity');
  const personalityById = componentMap<PersonalityComponent>('Personality');
  const needsById = componentMap<NeedsComponent>('Needs');
  const needsStateById = componentMap<NeedsStateComponent>('NeedsState');
  const memoryById = componentMap<MemoryComponent>('Memory');
  const cognitiveMemoryById = componentMap<CognitiveMemoryComponent>('CognitiveMemory');
  const cognitiveKnowledgeById = componentMap<CognitiveKnowledgeComponent>('CognitiveKnowledge');
  const cognitionById = componentMap<HumanCognitionComponent>('HumanCognition');
  const humanPlanById = componentMap<HumanPlanComponent>('HumanPlan');
  const humanSkillsById = componentMap<HumanSkillsComponent>('HumanSkills');

  const getOrThrow = <T>(map: Map<EntityId, T>, id: EntityId, name: string): T => {
    const value = map.get(id);
    if (value === undefined) {
      throw new Error(`hashSnapshot: composant "${name}" manquant pour l'entité ${id}`);
    }
    return value;
  };

  const humans: CanonicalHuman[] = [...humanById.keys()]
    .sort((a, b) => a - b)
    .map((id) => ({
      id,
      human: getOrThrow(humanById, id, 'Human'),
      transform: getOrThrow(transformById, id, 'Transform'),
      movement: getOrThrow(movementById, id, 'Movement'),
      activity: getOrThrow(activityById, id, 'Activity'),
      personality: personalityById.get(id) ?? null,
      needs: needsById.get(id) ?? null,
      needsState: needsStateById.get(id) ?? null,
      memory: memoryById.get(id) ?? null,
      cognitiveMemory: cognitiveMemoryById.get(id) ?? null,
      cognitiveKnowledge: cognitiveKnowledgeById.get(id) ?? null,
      cognition: cognitionById.get(id) ?? null,
      humanPlan: humanPlanById.get(id) ?? null,
      humanSkills: humanSkillsById.get(id) ?? null,
    }));

  return {
    tick: snapshot.clock.currentTick,
    entityCount: snapshot.entities.ids.length,
    nextEntityId: snapshot.entities.nextEntityId,
    rng: snapshot.rng,
    scheduler: snapshot.scheduler.systems,
    deltaJson: snapshot.delta,
    humans,
  };
}

function fnv1aHashState(state: CanonicalState): string {
  let hash = 0x811c9dc5; // FNV-1a 32 bits

  const write = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  const q = (value: number): number => quantize(value, 4);
  const qOrNull = (value: number | null): number | 'n' => (value === null ? 'n' : q(value));
  const encodeExperience = (experience: LivedExperience): string => {
    if (experience.kind === 'resource.gathering') {
      return `${experience.kind}:${experience.subjectConceptId ?? 'n'}:${experience.actionTick}:${experience.outcomeTick}:${experience.completed ? 1 : 0}`;
    }
    return `${experience.kind}:${experience.subjectConceptId}:${experience.motivation}:${experience.actionTick}:${experience.outcomeTick}:${q(experience.hungerBefore01)}:${q(experience.hungerAfter01)}:${experience.illnessObserved ? 1 : 0}`;
  };

  write(`tick:${state.tick}`);
  write(`entities:${state.entityCount}`);
  write(`nextId:${state.nextEntityId}`);

  // RNG : toute divergence ici entraîne une divergence future, même si l'état actuel
  // des entités correspond encore — sans ce champ, le hash ne détecterait un problème
  // qu'au tick suivant (ou jamais, si le stream concerné n'a pas encore été consommé).
  for (const streamName of Object.keys(state.rng).sort()) {
    write(`rng:${streamName}:${state.rng[streamName]!.join(',')}`);
  }

  // Ordonnanceur : `lastRunTick`/`hasRun` déterminent le `deltaGameSeconds` du prochain
  // passage de chaque système — une divergence ici fausse silencieusement le
  // métabolisme et la perception au tick suivant sans que rien d'autre ne le révèle.
  for (const system of [...state.scheduler].sort((a, b) => a.name.localeCompare(b.name))) {
    write(`sched:${system.name}:${system.lastRunTick}:${system.hasRun ? 1 : 0}`);
  }

  // WorldDelta : ressources modifiées/consommées + usure des sentiers. `toJSON()` est
  // déjà canonique (trié par identifiant), une simple sérialisation suffit.
  write(`delta:${JSON.stringify(state.deltaJson)}`);

  for (const {
    id: entity,
    human,
    transform,
    movement,
    activity,
    personality,
    needs,
    needsState,
    memory,
    cognitiveMemory,
    cognitiveKnowledge,
    cognition,
    humanPlan,
    humanSkills,
  } of state.humans) {
    write(
      [
        'e',
        entity,
        human.name,
        q(transform.x),
        q(transform.y),
        q(transform.z),
        q(transform.yaw),
        q(movement.walkSpeedMps),
        q(movement.currentSpeedMps),
        qOrNull(movement.targetX),
        qOrNull(movement.targetZ),
        // Volontairement absents : `waypoints`/`pathRequestId`/`pathPendingFor` sont
        // un cache de calcul du `PathfindingSystem`, pas un état persisté — le
        // snapshot les efface explicitement au chargement (voir
        // `SimulationSnapshot`'s doc et `Simulation.restoreSnapshot`). Les inclure
        // ferait échouer la comparaison « même hash » entre une simulation continue
        // (avec un chemin en cours) et sa version rechargée (chemin effacé par
        // conception) — un faux négatif sur une différence déjà documentée et
        // acceptée, pas un vrai bug.
        activity.kind,
        activity.reason,
      ].join('|'),
    );

    if (personality) {
      write(
        `p:${entity}:` +
          [
            personality.curiosity,
            personality.caution,
            personality.sociability,
            personality.aggression,
            personality.patience,
            personality.altruism,
            personality.courage,
            personality.perseverance,
          ]
            .map(q)
            .join(','),
      );
    }

    if (needs) {
      write(
        `n:${entity}:${q(needs.hydration)},${q(needs.hunger)},${q(needs.energy)},${q(needs.metabolismRate)}`,
      );
    }

    if (needsState) {
      write(
        `ns:${entity}:${needsState.action}:${qOrNull(needsState.targetX)}:${qOrNull(needsState.targetZ)}:` +
          `${needsState.resourceId ?? 'n'}:${needsState.resourceOwnerChunkKey ?? 'n'}:` +
          `${needsState.resourceLocalId ?? 'n'}:${needsState.resourceConceptId ?? 'n'}:` +
          `${needsState.foodIntent ?? 'n'}:` +
          `${needsState.gatherStartedTick ?? 'n'}:` +
          `${needsState.mealStartedTick}:${q(needsState.mealHungerBefore01)}:` +
          `${needsState.untilTick}:${q(needsState.mealMaxGain)}:` +
          `${needsState.poisoningUntilTick}:${q(needsState.poisoningToxicity01)}:` +
          `${needsState.currentMealCausedPoisoning ? 1 : 0}:${needsState.pathFailedAtTick}`,
      );
    }

    if (memory) {
      // Phase 3.5 : `Memory` ne porte plus que les positions du dernier scan — les
      // souvenirs eux-mêmes (rives, ressources) sont hachés via `CognitiveMemory`
      // ci-dessous. Ces positions gouvernent le seuil de rescan de `PerceptionSystem` :
      // deux individus dont l'un a rescanné plus récemment n'ont pas le même futur
      // (le prochain rescan tombe à un moment différent), les omettre masquerait cette
      // divergence.
      write(
        `m:${entity}:` +
          `${memory.lastFoodScanX === null ? 'n' : q(memory.lastFoodScanX)},` +
          `${memory.lastFoodScanZ === null ? 'n' : q(memory.lastFoodScanZ)},${memory.lastFoodScanTick ?? 'n'}|` +
          `${memory.lastWaterScanX === null ? 'n' : q(memory.lastWaterScanX)},` +
          `${memory.lastWaterScanZ === null ? 'n' : q(memory.lastWaterScanZ)},${memory.lastWaterScanTick ?? 'n'}`,
      );
    }

    if (cognitiveMemory) {
      // Phase 3.1 : toujours vide pour l'instant (aucun système n'y écrit encore), mais
      // couvert dès maintenant — voir le commentaire de tête sur le faux positif que ça
      // évite dès qu'un écrivain existera (3.2+).
      const spatial = cognitiveMemory.spatial
        .map(
          (entry) =>
            `${entry.id}:${entry.kind}@${q(entry.x)},${q(entry.z)}:${entry.lastSeenTick}:${entry.decayAnchorTick ?? entry.lastSeenTick}:` +
            `${q(entry.confidence01)}:${q(entry.precisionM)}:` +
            // encodedConfidence01/encodedPrecisionM déterminent la trajectoire future de
            // ForgettingSystem : deux souvenirs identiques aujourd'hui mais avec des
            // baselines différentes divergeront au prochain tick de décroissance.
            `${q(entry.encodedConfidence01)}:${q(entry.encodedPrecisionM)}:` +
            `${entry.source}:${entry.subjectConceptId ?? 'n'}:` +
            `${entry.worldRef ? `${entry.worldRef.resourceId}:${entry.worldRef.ownerChunkKey}:${entry.worldRef.localId}` : 'n'}:${entry.foodCandidate ? 1 : 0}`,
        )
        .join(';');
      const episodic = cognitiveMemory.episodic
        .map(
          (entry) =>
            `${entry.id}:${entry.tick}:${entry.eventType}:${entry.actors.join(',')}:` +
            `${entry.subjectConcept ?? 'n'}:${entry.x === undefined ? 'n' : q(entry.x)}:` +
            `${entry.z === undefined ? 'n' : q(entry.z)}:${entry.outcome}:${q(entry.emotionalStrength01)}:` +
            `${entry.experience === undefined ? 'n' : encodeExperience(entry.experience)}`,
        )
        .join(';');
      const social = cognitiveMemory.social
        .map(
          (entry) =>
            `${entry.id}:${entry.humanId}:${q(entry.trust01)}:${q(entry.familiarity01)}:${entry.lastContactTick}`,
        )
        .join(';');
      write(
        `cm:${entity}:${cognitiveMemory.nextMemoryId}:${cognitiveMemory.lastProcessedExperienceId ?? 'n'}|${spatial}|${episodic}|${social}`,
      );
    }

    if (cognitiveKnowledge) {
      const beliefValue = (value: Belief['value']): string => {
        switch (value.kind) {
          case 'probability':
            return `probability:${q(value.value01)}`;
          case 'category':
            return `category:${value.code}`;
          case 'scalar':
            return `scalar:${q(value.value)}:${value.unit ?? 'n'}`;
        }
      };
      const beliefs = cognitiveKnowledge.beliefs
        .map(
          (belief) =>
            `${belief.id}:${belief.subjectConcept}:${belief.property}:${beliefValue(belief.value)}:` +
            `${q(belief.confidence01)}:${belief.evidenceCount}:${belief.lastUpdatedTick}`,
        )
        .join(';');
      write(`ck:${entity}:${cognitiveKnowledge.nextBeliefId}|${beliefs}`);
    }

    if (cognition) {
      const factors = (cognition.decisionReason?.factors ?? [])
        .map(
          (factor) =>
            `${factor.code}:${factor.value === undefined ? 'n' : q(factor.value)}:` +
            `${factor.targetEntityId ?? 'n'}:${factor.conceptId ?? 'n'}`,
        )
        .join(',');
      write(
        `hc:${entity}:${cognition.activeGoal?.kind ?? 'n'}:${cognition.activeGoal?.startedAtTick ?? 'n'}|${cognition.decisionReason?.code ?? 'n'}|${factors}`,
      );
    }

    if (humanPlan) {
      const active = humanPlan.activePlan;
      const steps = active?.steps
        .map((step) => {
          if (step.kind === 'move.to_water' || step.kind === 'drink')
            return `${step.kind}:${step.rememberedX === null ? 'n' : q(step.rememberedX)}:${step.rememberedZ === null ? 'n' : q(step.rememberedZ)}`;
          if (step.kind === 'move.to_resource')
            return `${step.kind}:${step.worldRef.resourceId}:${step.worldRef.ownerChunkKey}:${step.worldRef.localId}:${step.subjectConceptId ?? 'n'}:${q(step.rememberedX)}:${q(step.rememberedZ)}`;
          if (step.kind === 'eat.resource')
            return `${step.kind}:${step.worldRef.resourceId}:${step.worldRef.ownerChunkKey}:${step.worldRef.localId}:${step.subjectConceptId ?? 'n'}:${step.intent}`;
          return step.kind;
        })
        .join(';');
      const selectionFactors = (active?.selectionReason?.factors ?? [])
        .map(
          (factor) =>
            `${factor.code}:${factor.value === undefined ? 'n' : q(factor.value)}:` +
            `${factor.targetEntityId ?? 'n'}:${factor.conceptId ?? 'n'}`,
        )
        .join(',');
      const failure = (value: PlanFailure | null) => {
        if (value === null) return 'n';
        const target = value.target;
        const encodedTarget =
          target === undefined
            ? 'n'
            : target.kind === 'resource'
              ? `r:${target.worldRef.resourceId}:${target.worldRef.ownerChunkKey}:${target.worldRef.localId}`
              : `w:${q(target.rememberedX)}:${q(target.rememberedZ)}`;
        return `${value.stepIndex}:${value.reason}:${value.tick}:${encodedTarget}`;
      };
      write(
        `hp:${entity}:${humanPlan.nextPlanId}:${active?.id ?? 'n'}:${active?.goalKind ?? 'n'}:${active?.createdAtTick ?? 'n'}:${active?.currentStepIndex ?? 'n'}:${steps ?? 'n'}:` +
          `${active?.selectionReason?.code ?? 'n'}:${selectionFactors}:` +
          `${failure(active?.lastFailure ?? null)}:${failure(humanPlan.lastFailure)}`,
      );
    }

    if (humanSkills) {
      const skills = humanSkills.skills
        .map(
          (skill) =>
            `${skill.kind}:${q(skill.proficiency01)}:${skill.practiceCount}:${skill.lastPracticedTick}`,
        )
        .join(';');
      write(`hs:${entity}:${skills}`);
    }
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}
