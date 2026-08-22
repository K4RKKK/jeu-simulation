import { describe, expect, it } from 'vitest';
import type { EntityId } from '@civ/shared';
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
  ObservableAction,
  Personality,
  Transform,
  createEmptyCognitiveKnowledge,
  createEmptyCognitiveMemory,
  createEmptyHumanCognition,
  createEmptyHumanPlan,
  createEmptyHumanSkills,
} from '../../components/index.js';
import type { ObservableActionKind } from '../../components/index.js';
import { Simulation } from '../../simulation.js';
import { SocialObservationSystem } from './socialObservationSystem.js';

/**
 * Ces tests verrouillent la frontière public/privé introduite en Phase 3.8 :
 * SocialObservationSystem ne doit lire QUE Transform + ObservableAction chez l'acteur
 * (jamais Needs, NeedsState, HumanSkills, etc.), et un observateur ne doit produire
 * qu'UN épisode par occurrence physique.
 */

function makeSocialSimulation(): Simulation {
  // Uniquement SocialObservationSystem enregistré : isolation totale — pas de
  // NeedSatisfactionSystem qui viendrait projeter ou effacer ObservableAction et
  // fausser les observations. Les acteurs sont posés à la main dans chaque test.
  return new Simulation({
    seed: 'social-observation',
    spawnInitialPopulation: false,
    config: { time: { gameSecondsPerTick: 1 } },
    systems: [new SocialObservationSystem()],
  });
}

function makeHumanAt(simulation: Simulation, x: number, z: number): EntityId {
  const entity = simulation.entities.createEntity();
  simulation.entities.addComponent(entity, Human, {
    name: `human-${entity}`,
    sex: 'female',
    ageYears: 25,
    heightM: 1.6,
    massKg: 55,
    tint: 0.5,
    bornAtTick: 0,
  });
  simulation.entities.addComponent(entity, Transform, { x, z, y: 0, yaw: 0 });
  simulation.entities.addComponent(entity, Movement, {
    walkSpeedMps: 1.2,
    currentSpeedMps: 0,
    targetX: null,
    targetZ: null,
    waypoints: [],
    pathPendingFor: null,
    pathRequestId: null,
    lastTrailSampleX: null,
    lastTrailSampleZ: null,
  });
  simulation.entities.addComponent(entity, Personality, {
    curiosity: 0.5,
    caution: 0.5,
    sociability: 0.5,
    aggression: 0.3,
    patience: 0.5,
    altruism: 0.5,
    courage: 0.5,
    perseverance: 0.5,
  });
  simulation.entities.addComponent(entity, Needs, {
    hydration: 1,
    hunger: 1,
    energy: 1,
    metabolismRate: 1,
  });
  simulation.entities.addComponent(entity, Activity, {
    kind: 'idle',
    reason: 'test',
    startedAtTick: 0,
  });
  simulation.entities.addComponent(entity, Memory, {
    lastFoodScanX: null,
    lastFoodScanZ: null,
    lastFoodScanTick: null,
    lastWaterScanX: null,
    lastWaterScanZ: null,
    lastWaterScanTick: null,
  });
  simulation.entities.addComponent(entity, CognitiveMemory, createEmptyCognitiveMemory());
  simulation.entities.addComponent(entity, CognitiveKnowledge, createEmptyCognitiveKnowledge());
  simulation.entities.addComponent(entity, HumanCognition, createEmptyHumanCognition());
  simulation.entities.addComponent(entity, HumanPlan, createEmptyHumanPlan());
  simulation.entities.addComponent(entity, HumanSkills, createEmptyHumanSkills());
  return entity;
}

function startAction(
  simulation: Simulation,
  actor: EntityId,
  kind: ObservableActionKind,
  startedAtTick: number,
  subjectConceptId: string | null,
): void {
  simulation.entities.addComponent(actor, ObservableAction, {
    kind,
    startedAtTick,
    subjectConceptId,
  });
}

describe('SocialObservationSystem — frontière et dédup', () => {
  it("IN RANGE : un acteur visible produit une observation sociale", () => {
    const sim = makeSocialSimulation();
    const actor = makeHumanAt(sim, 0, 0);
    const observer = makeHumanAt(sim, 5, 0); // à 5 m, portée = 32 m
    startAction(sim, actor, 'resource.gathering', 10, 'berry:red');
    sim.start();
    sim.step(5);
    const memory = sim.entities.getComponentOrThrow(observer, CognitiveMemory);
    const entry = memory.social.find((s) => s.humanId === actor);
    expect(entry).toBeDefined();
    expect(entry!.lastObservedActionKind).toBe('resource.gathering');
    expect(entry!.lastObservedActionStartedTick).toBe(10);
    expect(entry!.lastObservedActionConceptId).toBe('berry:red');
    const episode = memory.episodic.find(
      (e) => e.eventType === 'social.actionObserved' && e.actors.includes(actor),
    );
    expect(episode?.experience).toMatchObject({
      kind: 'social.actionObserved',
      actorId: actor,
      observedAction: 'resource.gathering',
      subjectConceptId: 'berry:red',
      actionStartedTick: 10,
      source: 'directObservation',
    });
    sim.dispose();
  });

  it('OUT OF RANGE : un acteur trop loin ne produit aucune observation', () => {
    const sim = makeSocialSimulation();
    const actor = makeHumanAt(sim, 0, 0);
    const observer = makeHumanAt(sim, 100, 0); // 100 m > visionRange (32)
    startAction(sim, actor, 'resource.gathering', 10, 'berry:red');
    sim.start();
    sim.step(5);
    const memory = sim.entities.getComponentOrThrow(observer, CognitiveMemory);
    expect(memory.social).toHaveLength(0);
    expect(memory.episodic).toHaveLength(0);
    sim.dispose();
  });

  it('SELF : un humain ne s’observe jamais lui-même', () => {
    const sim = makeSocialSimulation();
    const solo = makeHumanAt(sim, 0, 0);
    startAction(sim, solo, 'food.ingestion', 5, 'berry:red');
    sim.start();
    sim.step(5);
    const memory = sim.entities.getComponentOrThrow(solo, CognitiveMemory);
    expect(memory.social).toHaveLength(0);
    expect(memory.episodic).toHaveLength(0);
    sim.dispose();
  });

  it('ONE ACTION ONE OBSERVATION : action longue → un seul épisode côté observateur', () => {
    const sim = makeSocialSimulation();
    const actor = makeHumanAt(sim, 0, 0);
    const observer = makeHumanAt(sim, 5, 0);
    startAction(sim, actor, 'resource.gathering', 10, 'berry:red');
    sim.start();
    // Plusieurs passes medium consécutives sur la MÊME occurrence.
    sim.step(50);
    const memory = sim.entities.getComponentOrThrow(observer, CognitiveMemory);
    const observedEpisodes = memory.episodic.filter(
      (e) => e.eventType === 'social.actionObserved',
    );
    expect(observedEpisodes).toHaveLength(1);
    sim.dispose();
  });

  it('SECOND ACTION : une nouvelle occurrence après la première produit un deuxième épisode', () => {
    const sim = makeSocialSimulation();
    const actor = makeHumanAt(sim, 0, 0);
    const observer = makeHumanAt(sim, 5, 0);
    startAction(sim, actor, 'resource.gathering', 10, 'berry:red');
    sim.start();
    sim.step(5);
    // Nouvelle occurrence : startedAtTick DIFFÉRENT.
    startAction(sim, actor, 'resource.gathering', 25, 'berry:red');
    sim.step(5);
    const memory = sim.entities.getComponentOrThrow(observer, CognitiveMemory);
    const observedEpisodes = memory.episodic.filter(
      (e) => e.eventType === 'social.actionObserved',
    );
    expect(observedEpisodes).toHaveLength(2);
    const entry = memory.social.find((s) => s.humanId === actor)!;
    expect(entry.lastObservedActionStartedTick).toBe(25);
    sim.dispose();
  });

  it('OBSERVABLE ONLY : ne fuit pas Needs, NeedsState, HumanSkills, Knowledge', () => {
    // Deux mondes identiques SAUF Needs.hunger / NeedsState / HumanSkills / Knowledge
    // de l'acteur. Le contenu observé doit être bit-identique.
    const run = (config: {
      hunger: number;
      skillProficiency: number;
      belief: boolean;
    }): { episode: unknown; entry: unknown } => {
      const sim = makeSocialSimulation();
      const actor = makeHumanAt(sim, 0, 0);
      const observer = makeHumanAt(sim, 5, 0);
      // Perturbe l'état interne de l'acteur — aucune de ces mutations n'a le droit
      // de fuiter dans ce que voit l'observateur.
      sim.entities.getComponentOrThrow(actor, Needs).hunger = config.hunger;
      sim.entities.getComponentOrThrow(actor, HumanSkills).skills.push({
        kind: 'resource.gathering',
        proficiency01: config.skillProficiency,
        practiceCount: 500,
        lastPracticedTick: 0,
      });
      if (config.belief) {
        sim.entities.getComponentOrThrow(actor, CognitiveKnowledge).beliefs.push({
          id: 0,
          subjectConcept: 'berry:red',
          property: 'food.illnessRisk',
          value: { kind: 'probability', value01: 0.9 },
          confidence01: 0.9,
          evidenceCount: 5,
          lastUpdatedTick: 0,
        });
      }
      startAction(sim, actor, 'resource.gathering', 10, 'berry:red');
      sim.start();
      sim.step(5);
      const memory = sim.entities.getComponentOrThrow(observer, CognitiveMemory);
      const episode = memory.episodic.find((e) => e.eventType === 'social.actionObserved');
      const entry = memory.social.find((s) => s.humanId === actor);
      sim.dispose();
      return { episode: episode?.experience, entry };
    };
    const starving = run({ hunger: 0.02, skillProficiency: 0.05, belief: false });
    const expert = run({ hunger: 0.95, skillProficiency: 0.99, belief: true });
    expect(starving.episode).toEqual(expert.episode);
    expect(starving.entry).toEqual(expert.entry);
  });

  it("TRUST DOES NOT AUTO GROW : la confiance reste neutre malgré de multiples observations", () => {
    const sim = makeSocialSimulation();
    const actor = makeHumanAt(sim, 0, 0);
    const observer = makeHumanAt(sim, 5, 0);
    startAction(sim, actor, 'resource.gathering', 10, 'berry:red');
    sim.start();
    sim.step(5);
    // Beaucoup d'occurrences distinctes.
    for (let i = 0; i < 10; i++) {
      startAction(sim, actor, 'resource.gathering', 20 + i * 10, 'berry:red');
      sim.step(5);
    }
    const memory = sim.entities.getComponentOrThrow(observer, CognitiveMemory);
    const entry = memory.social.find((s) => s.humanId === actor)!;
    expect(entry.trust01).toBe(0.5);
    // Familiarity, elle, doit avoir monté.
    expect(entry.familiarity01).toBeGreaterThan(0);
    sim.dispose();
  });

  it("FAMILIARITY : monte à chaque NOUVELLE occurrence, jamais par simple présence prolongée", () => {
    const sim = makeSocialSimulation();
    const actor = makeHumanAt(sim, 0, 0);
    const observer = makeHumanAt(sim, 5, 0);
    startAction(sim, actor, 'resource.gathering', 10, 'berry:red');
    sim.start();
    sim.step(5);
    const memory = sim.entities.getComponentOrThrow(observer, CognitiveMemory);
    const entry = memory.social.find((s) => s.humanId === actor)!;
    const familiarityAfterFirst = entry.familiarity01;
    // Plusieurs ticks supplémentaires SANS nouvelle occurrence.
    sim.step(20);
    expect(entry.familiarity01).toBe(familiarityAfterFirst);
    // Une nouvelle occurrence doit incrémenter.
    startAction(sim, actor, 'food.ingestion', 100, 'berry:red');
    sim.step(5);
    expect(entry.familiarity01).toBeGreaterThan(familiarityAfterFirst);
    sim.dispose();
  });

  it("MANY OBSERVERS : chaque observateur produit son propre souvenir; les absents ne voient rien", () => {
    const sim = makeSocialSimulation();
    const actor = makeHumanAt(sim, 0, 0);
    const near1 = makeHumanAt(sim, 5, 0);
    const near2 = makeHumanAt(sim, 0, 8);
    const far = makeHumanAt(sim, 200, 0);
    startAction(sim, actor, 'resource.gathering', 10, 'berry:red');
    sim.start();
    sim.step(5);
    expect(sim.entities.getComponentOrThrow(near1, CognitiveMemory).episodic.length).toBe(1);
    expect(sim.entities.getComponentOrThrow(near2, CognitiveMemory).episodic.length).toBe(1);
    expect(sim.entities.getComponentOrThrow(far, CognitiveMemory).episodic.length).toBe(0);
    sim.dispose();
  });

  it("MANY ACTORS : un observateur mémorise séparément chaque acteur", () => {
    const sim = makeSocialSimulation();
    const observer = makeHumanAt(sim, 0, 0);
    const alice = makeHumanAt(sim, 5, 0);
    const bob = makeHumanAt(sim, 0, 5);
    startAction(sim, alice, 'resource.gathering', 10, 'berry:red');
    startAction(sim, bob, 'food.ingestion', 12, 'mushroom:brown');
    sim.start();
    sim.step(5);
    const memory = sim.entities.getComponentOrThrow(observer, CognitiveMemory);
    expect(memory.social).toHaveLength(2);
    expect(memory.social.find((s) => s.humanId === alice)?.lastObservedActionKind).toBe(
      'resource.gathering',
    );
    expect(memory.social.find((s) => s.humanId === bob)?.lastObservedActionKind).toBe(
      'food.ingestion',
    );
    sim.dispose();
  });

  it("SAME CONCEPT DIFFERENT DEFINITIONS : perceptualConceptId identique → observation identique", () => {
    // Deux "définitions moteur" différentes projetées avec le MÊME concept perceptif.
    // Le système ne connaît que le concept, il doit produire deux occurrences distinctes
    // (kind identique, mais startedAtTick différents) toutes deux sur berry:red.
    const sim = makeSocialSimulation();
    const alice = makeHumanAt(sim, -5, 0);
    const bob = makeHumanAt(sim, 5, 0);
    const observer = makeHumanAt(sim, 0, 0);
    startAction(sim, alice, 'resource.gathering', 10, 'berry:red');
    startAction(sim, bob, 'resource.gathering', 10, 'berry:red');
    sim.start();
    sim.step(5);
    const memory = sim.entities.getComponentOrThrow(observer, CognitiveMemory);
    // Deux acteurs distincts observés, même concept.
    expect(memory.social).toHaveLength(2);
    expect(
      memory.social.every((s) => s.lastObservedActionConceptId === 'berry:red'),
    ).toBe(true);
    sim.dispose();
  });

  it("SAVE MID ACTION : rechargement pendant une action ne produit pas de doublon", () => {
    const sim = makeSocialSimulation();
    const actor = makeHumanAt(sim, 0, 0);
    const observer = makeHumanAt(sim, 5, 0);
    startAction(sim, actor, 'resource.gathering', 10, 'berry:red');
    sim.start();
    sim.step(5);
    expect(
      sim.entities.getComponentOrThrow(observer, CognitiveMemory).episodic.length,
    ).toBe(1);
    // Snapshot après observation, restore dans une simulation fraîche.
    const snapshot = sim.captureSnapshot();
    const restored = makeSocialSimulation();
    restored.restoreSnapshot(snapshot);
    // L'action de l'acteur est toujours en cours.
    expect(restored.entities.getComponent(actor, ObservableAction)?.startedAtTick).toBe(10);
    restored.start();
    restored.step(20); // plusieurs passes supplémentaires
    // Aucun deuxième épisode ne doit être créé pour la même occurrence.
    expect(
      restored.entities.getComponentOrThrow(observer, CognitiveMemory).episodic.filter(
        (e) => e.eventType === 'social.actionObserved',
      ).length,
    ).toBe(1);
    sim.dispose();
    restored.dispose();
  });
});
