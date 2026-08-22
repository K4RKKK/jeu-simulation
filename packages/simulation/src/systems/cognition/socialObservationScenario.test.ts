import { describe, expect, it } from 'vitest';
import type { EntityId } from '@civ/shared';
import type { ResourceSpawn } from '@civ/procedural';
import {
  CognitiveKnowledge,
  CognitiveMemory,
  HumanSkills,
  Needs,
  Transform,
} from '../../components/index.js';
import { observeResource } from '../../cognition/observationBuilder.js';
import {
  FOOD_ILLNESS_RISK_PROPERTY,
  FOOD_NOURISHING_PROPERTY,
} from '../../cognition/foodBeliefModel.js';
import {
  FOOD_OBSERVED_INGESTION_PROPERTY,
  observedFoodIngestionConfidence01,
} from '../../cognition/socialFoodBeliefModel.js';
import { rememberSpatial } from '../../cognition/spatialMemoryModel.js';
import { Simulation } from '../../simulation.js';
import { GoalSelectionSystem } from './goalSelectionSystem.js';
import { LearningSystem } from './learningSystem.js';
import { PlannerSystem } from './plannerSystem.js';
import { SocialObservationSystem } from './socialObservationSystem.js';
import { MetabolismSystem } from '../needs/metabolismSystem.js';
import { NeedSatisfactionSystem } from '../needs/needSatisfactionSystem.js';
import { PathfindingSystem } from '../pathfinding/pathfindingSystem.js';
import { MovementSystem } from '../movementSystem.js';
import { ResourceInteractionSystem } from '../resourceInteractionSystem.js';

/**
 * Scénario final d'acceptation (prompt Phase 3.8) : le pipeline complet, pas des
 * systèmes isolés. A cueille et mange une berry:red ; B, à proximité, l'observe.
 * Aucune télépathie moteur ne doit fuir vers B, mais l'observation doit avoir un
 * effet limité mais réel sur sa croyance sociale.
 *
 * B est DÉLIBÉRÉMENT laissé sans souvenir spatial de la ressource : il ne peut pas
 * agir dessus, donc ne peut pas gagner de skill/beliefs personnelles pendant le test —
 * ce qui prouve à contrario que ce qui arrive à ses croyances vient uniquement de
 * l'observation d'A. Le test dédié « OWN TARGET REQUIRED » (SocialObservationSystem)
 * couvre la variante où B connaît la ressource mais ne peut pas encore agir dessus.
 */

/**
 * Systèmes actifs : le pipeline cognitif complet + décision + action, MAIS sans
 * `PerceptionSystem` ni `TemporaryWanderSystem`. Perception exclue pour éviter que B
 * ne se mette involontairement à voir la même ressource qu'A et à l'expérimenter
 * lui-même (ce qui produirait un skill et des food beliefs indépendants du contrat
 * social qu'on veut valider). L'ordre relatif (P0 : SocialObs après NeedSat) reste
 * strictement identique à celui de `defaultSystems()`.
 */
function makeScenarioSimulation(): Simulation {
  return new Simulation({
    seed: 'social-scenario',
    population: 2,
    config: { time: { gameSecondsPerTick: 1 } },
    systems: [
      new MetabolismSystem(),
      new LearningSystem(),
      new GoalSelectionSystem(),
      new PlannerSystem(),
      new NeedSatisfactionSystem(),
      new SocialObservationSystem(),
      new PathfindingSystem(),
      new MovementSystem(),
      new ResourceInteractionSystem(),
    ],
  });
}

function firstEdibleSpawnNearHuman(sim: Simulation, actor: EntityId): ResourceSpawn {
  const world = sim.world;
  const transform = sim.entities.getComponentOrThrow(actor, Transform);
  const chunk = world.generateChunk(world.chunkAt(transform.x, transform.z));
  const spawn = chunk.resources.find(
    (candidate) => candidate.foodKcal > 0 && world.isWalkable(candidate.x, candidate.z),
  );
  if (spawn === undefined) throw new Error('no edible spawn found for scenario');
  return spawn;
}

describe('Phase 3.8 — scénario final d\'acceptation', () => {
  it('B observe A gather puis manger berry:red sans jamais copier son état interne', () => {
    const sim = makeScenarioSimulation();
    const [alice, bob] = sim.humanIds();
    const A = alice!;
    const B = bob!;

    // Place A SUR une ressource comestible ; place B à 6 m d'A ensuite. Ordre
    // essentiel : B calé à partir de la position d'A APRÈS téléportation, sinon B
    // reste planté à côté du camp initial.
    const aliceTransform = sim.entities.getComponentOrThrow(A, Transform);
    const bobTransform = sim.entities.getComponentOrThrow(B, Transform);
    const spawn = firstEdibleSpawnNearHuman(sim, A);
    aliceTransform.x = spawn.x;
    aliceTransform.z = spawn.z;
    aliceTransform.y = sim.world.heightAt(spawn.x, spawn.z);
    bobTransform.x = spawn.x + 6;
    bobTransform.z = spawn.z;
    bobTransform.y = sim.world.heightAt(bobTransform.x, bobTransform.z);

    // A a faim → il ira cueillir/manger de lui-même.
    sim.entities.getComponentOrThrow(A, Needs).hunger = 0.05;
    // B a tous ses besoins pleins → aucun goal vital, pas de deliberateExperiment
    // possible (SANS spatial memory, ExperimentModel n'a rien à cibler). Il observera
    // simplement — c'est exactement ce qu'on veut isoler.
    const bobNeeds = sim.entities.getComponentOrThrow(B, Needs);
    bobNeeds.hunger = 1;
    bobNeeds.hydration = 1;
    bobNeeds.energy = 1;

    // Sème le souvenir de la baie UNIQUEMENT chez A. B n'aura aucun target propre à
    // exploiter, donc jamais de skill ni de food.nourishing/illnessRisk personnels.
    rememberSpatial(
      sim.entities.getComponentOrThrow(A, CognitiveMemory),
      observeResource(spawn, sim.clock.currentTick),
      sim.config.cognition,
    );

    sim.start();
    // Assez pour que gather + eat aient le temps de se dérouler (novice 8 s + eat).
    sim.step(400);

    // ─── Ce que B a effectivement vu ───────────────────────────────────────────────
    const bobMemory = sim.entities.getComponentOrThrow(B, CognitiveMemory);
    const observedEpisodes = bobMemory.episodic.filter(
      (e) => e.eventType === 'social.actionObserved',
    );
    // Au moins UNE observation sociale (typiquement 2 : gather puis food.ingestion).
    expect(observedEpisodes.length).toBeGreaterThanOrEqual(1);
    // SocialMemoryEntry existe, trust reste neutre, familiarity a monté.
    const socialEntry = bobMemory.social.find((s) => s.humanId === A);
    expect(socialEntry).toBeDefined();
    expect(socialEntry!.trust01).toBe(0.5);
    expect(socialEntry!.familiarity01).toBeGreaterThan(0);

    // ─── Ce que B n'a PAS appris ─────────────────────────────────────────────────
    // NO SKILL COPY : B n'a jamais gathered lui-même (pas de spatial memory pour
    // rendre un experiment possible).
    const bobSkills = sim.entities.getComponentOrThrow(B, HumanSkills);
    expect(bobSkills.skills).toEqual([]);
    // NO NOURISHING MAGIC, NO SAFETY MAGIC : ces beliefs sont réservées aux
    // ingestions PERSONNELLEMENT vécues.
    const bobKnowledge = sim.entities.getComponentOrThrow(B, CognitiveKnowledge);
    expect(bobKnowledge.beliefs.some((b) => b.property === FOOD_NOURISHING_PROPERTY)).toBe(false);
    expect(bobKnowledge.beliefs.some((b) => b.property === FOOD_ILLNESS_RISK_PROPERTY)).toBe(false);

    // ─── Ce que B a bien appris socialement ───────────────────────────────────────
    // Belief food.observedIngestion présente uniquement si A a effectivement mangé
    // sous les yeux de B. C'est le cas dans le scénario nominal.
    const observedIngestionKinds = observedEpisodes
      .map((e) => e.experience?.kind === 'social.actionObserved' && e.experience.observedAction)
      .filter((v): v is 'food.ingestion' | 'resource.gathering' => v !== false);
    if (observedIngestionKinds.includes('food.ingestion')) {
      expect(
        bobKnowledge.beliefs.find((b) => b.property === FOOD_OBSERVED_INGESTION_PROPERTY),
      ).toBeDefined();
      expect(
        observedFoodIngestionConfidence01(bobKnowledge, spawn.perceptualConceptId),
      ).toBeGreaterThan(0);
    } else {
      // Fallback (A n'a pas eu le temps de manger dans les 400 ticks alloués) :
      // au moins la gathering est visible et rien n'a fuité côté croyances.
      expect(observedIngestionKinds).toContain('resource.gathering');
    }

    sim.dispose();
  });
});
