import { describe, expect, it } from 'vitest';
import { Movement, ObservableAction, Transform } from '../components/index.js';
import { hashSnapshot, hashWorldState } from '../debug/stateHash.js';
import { Simulation } from '../simulation.js';

function makeSimulation(seed: string, population = 10): Simulation {
  return new Simulation({ seed, population, config: { time: { gameSecondsPerTick: 1 } } });
}

describe('Simulation snapshot — round-trip immédiat', () => {
  it('restaure exactement le même hash sans avoir avancé le temps', () => {
    const source = makeSimulation('snapshot-roundtrip', 8);
    source.start();
    source.step(500);
    const hashBefore = hashWorldState(source);

    const snapshot = source.captureSnapshot();
    const target = makeSimulation('snapshot-roundtrip', 8);
    target.restoreSnapshot(snapshot);

    expect(hashWorldState(target)).toBe(hashBefore);
    expect(target.clock.currentTick).toBe(source.clock.currentTick);
    expect(target.entities.entityCount).toBe(source.entities.entityCount);
    source.dispose();
    target.dispose();
  });

  it('refuse un snapshot dont la seed ne correspond pas au monde cible', () => {
    const source = makeSimulation('seed-a');
    source.step(10);
    const snapshot = source.captureSnapshot();

    const target = makeSimulation('seed-b');
    expect(() => target.restoreSnapshot(snapshot)).toThrow(/seed/);
    source.dispose();
    target.dispose();
  });

  it('refuse un snapshot dont la version ne correspond pas', () => {
    const source = makeSimulation('version-check');
    source.step(5);
    const snapshot = source.captureSnapshot();
    const tampered = { ...snapshot, version: snapshot.version + 999 };

    expect(() => source.restoreSnapshot(tampered)).toThrow(/version/);
    source.dispose();
  });

  /**
   * Scénario exact signalé en revue : une sauvegarde faite avec un rayon d'arrivée de
   * 1 m était acceptée sans broncher par une simulation reconfigurée à 3 m — même
   * seed, même generationVersion. Le modèle « seed + version + configuration »
   * promettait que la configuration comptait ; `configFingerprint` le garantit
   * maintenant pour toute section qui régit le comportement d'entités déjà vivantes
   * (`movement` ici — délibérément pas `humans`, qui ne sert qu'à la génération de la
   * population initiale, remplacée de toute façon par le snapshot).
   */
  it('refuse un snapshot dont la SimulationConfig a changé (ex: arrivalRadiusMeters)', () => {
    const seed = 'config-drift';
    const source = new Simulation({
      seed,
      population: 4,
      config: { time: { gameSecondsPerTick: 1 }, movement: { arrivalRadiusMeters: 1 } },
    });
    source.step(5);
    const snapshot = source.captureSnapshot();
    source.dispose();

    const target = new Simulation({
      seed,
      population: 4,
      config: { time: { gameSecondsPerTick: 1 }, movement: { arrivalRadiusMeters: 3 } },
    });
    expect(() => target.restoreSnapshot(snapshot)).toThrow(/configuration incompatible/);
    target.dispose();
  });

  it('rejects a current snapshot when procedural skill timing configuration changed', () => {
    const seed = 'skill-config-drift';
    const source = new Simulation({
      seed,
      population: 1,
      config: { skills: { resourceGathering: { noviceDurationSeconds: 8 } } },
    });
    const snapshot = source.captureSnapshot();
    source.dispose();

    const target = new Simulation({
      seed,
      population: 1,
      config: { skills: { resourceGathering: { noviceDurationSeconds: 9 } } },
    });
    expect(() => target.restoreSnapshot(snapshot)).toThrow(/configuration incompatible/);
    target.dispose();
  });

  it('refuse un snapshot v15 dont une règle de changement de but a changé', () => {
    const seed = 'goal-config-drift';
    const source = new Simulation({
      seed,
      population: 1,
      config: { time: { gameSecondsPerTick: 1 }, needs: { decision: { goalSwitchMargin01: 0.2 } } },
    });
    const snapshot = source.captureSnapshot();
    source.dispose();

    const target = new Simulation({
      seed,
      population: 1,
      config: { time: { gameSecondsPerTick: 1 }, needs: { decision: { goalSwitchMargin01: 0.3 } } },
    });
    expect(() => target.restoreSnapshot(snapshot)).toThrow(/configuration incompatible/);
    target.dispose();
  });

  /**
   * À l'inverse, une différence de config `humans` (génération de la population
   * initiale) ne doit PAS bloquer un chargement légitime : cette config n'a plus
   * d'effet une fois la population remplacée par `restoreEntities`.
   */
  it('accepte un snapshot malgré une config humans.* différente (sans effet après restore)', () => {
    const seed = 'humans-config-irrelevant';
    const source = new Simulation({
      seed,
      population: 4,
      config: { time: { gameSecondsPerTick: 1 }, humans: { baseWalkSpeedMps: 1.4 } },
    });
    source.step(5);
    const snapshot = source.captureSnapshot();
    source.dispose();

    const target = new Simulation({
      seed,
      population: 15,
      config: { time: { gameSecondsPerTick: 1 }, humans: { baseWalkSpeedMps: 1.8 } },
      spawnInitialPopulation: false,
    });
    expect(() => target.restoreSnapshot(snapshot)).not.toThrow();
    expect(target.humanCount).toBe(4);
    target.dispose();
  });

  it('refuse un snapshot dont la taille du monde a changé', () => {
    const seed = 'world-size-drift';
    const source = new Simulation({
      seed,
      population: 4,
      config: { time: { gameSecondsPerTick: 1 } },
      generation: { layout: { sizeChunks: 16 } },
    });
    source.step(5);
    const snapshot = source.captureSnapshot();
    source.dispose();

    const target = new Simulation({
      seed,
      population: 4,
      config: { time: { gameSecondsPerTick: 1 } },
      generation: { layout: { sizeChunks: 24 } },
    });
    expect(() => target.restoreSnapshot(snapshot)).toThrow(/configuration incompatible/);
    target.dispose();
  });

  /**
   * Depuis la v6 du snapshot, `configFingerprint` couvre aussi `WorldGenerationConfig`
   * (paramètres numériques de génération procédurale) — pas seulement `SimulationConfig`.
   * Avant, seul `generationVersion` (une chaîne bumpée à la main) aurait pu détecter cette
   * dérive, et seulement si quelqu'un y avait pensé.
   */
  it('refuse un snapshot dont un paramètre de génération procédurale a changé (ex: hydrology.waterLevel01)', () => {
    const seed = 'procedural-config-drift';
    const source = new Simulation({
      seed,
      population: 4,
      config: { time: { gameSecondsPerTick: 1 } },
      generation: { hydrology: { waterLevel01: 0.25 } },
    });
    source.step(5);
    const snapshot = source.captureSnapshot();
    source.dispose();

    const target = new Simulation({
      seed,
      population: 4,
      config: { time: { gameSecondsPerTick: 1 } },
      generation: { hydrology: { waterLevel01: 0.4 } },
    });
    expect(() => target.restoreSnapshot(snapshot)).toThrow(/configuration incompatible/);
    target.dispose();
  });

  it('accepte un snapshot dont la configuration est identique', () => {
    const seed = 'config-stable';
    const make = () =>
      new Simulation({
        seed,
        population: 4,
        config: { time: { gameSecondsPerTick: 1 }, humans: { baseWalkSpeedMps: 1.4 } },
      });
    const source = make();
    source.step(5);
    const snapshot = source.captureSnapshot();
    source.dispose();

    const target = make();
    expect(() => target.restoreSnapshot(snapshot)).not.toThrow();
    target.dispose();
  });

  /**
   * Bug corrigé : `restoreEntities` injectait les valeurs de composants du snapshot
   * PAR RÉFÉRENCE. Les systèmes mutent les composants en place (`transform.x = …`),
   * donc restaurer puis faire tourner une simulation A mutait silencieusement les
   * objets du snapshot lui-même — un second restore (B) du MÊME snapshot recevait
   * alors un état partiellement corrompu par A. Deux simulations restaurées depuis le
   * même snapshot doivent être totalement indépendantes l'une de l'autre.
   */
  it('deux simulations restaurées depuis le même snapshot sont indépendantes après mutation', () => {
    const source = makeSimulation('shared-reference-bug', 10);
    source.start();
    source.step(1000);
    const snapshot = source.captureSnapshot();
    source.dispose();

    const a = makeSimulation('shared-reference-bug', 10);
    a.restoreSnapshot(snapshot);
    a.step(500); // mute potentiellement les composants restaurés en place

    // Un second restore du MÊME snapshot doit reproduire l'état PRISTINE, pas celui
    // muté par `a` entre-temps.
    const b = makeSimulation('shared-reference-bug', 10);
    b.restoreSnapshot(snapshot);
    const c = makeSimulation('shared-reference-bug', 10);
    c.restoreSnapshot(snapshot);

    expect(hashWorldState(b)).toBe(hashWorldState(c));

    // Preuve directe : muter une entrée du snapshot lui-même (si jamais elle était
    // partagée) n'affecte aucune autre restauration.
    const firstEntity = b.humanIds()[0]!;
    const transformB = b.entities.getComponentOrThrow(firstEntity, Transform);
    const originalX = transformB.x;
    transformB.x += 999; // mutation directe du composant de b
    const transformC = c.entities.getComponentOrThrow(firstEntity, Transform);
    expect(transformC.x).toBe(originalX); // c n'a pas bougé

    a.dispose();
    b.dispose();
    c.dispose();
  });

  it('efface les requêtes de chemin en vol pour éviter un blocage indéfini', () => {
    const source = makeSimulation('pending-path-clear', 4);
    source.start();
    // Force une requête de chemin en cours pour tous les humains.
    for (const id of source.humanIds()) {
      const movement = source.entities.getComponentOrThrow(id, Movement);
      const transform = source.entities.getComponentOrThrow(id, Transform);
      movement.targetX = transform.x + 500;
      movement.targetZ = transform.z + 500;
      movement.pathPendingFor = { x: movement.targetX, z: movement.targetZ };
      movement.pathRequestId = 12345; // requête fictive, jamais résolue par un vrai service
    }

    const snapshot = source.captureSnapshot();
    const target = makeSimulation('pending-path-clear', 4);
    target.restoreSnapshot(snapshot);

    for (const id of target.humanIds()) {
      const movement = target.entities.getComponentOrThrow(id, Movement);
      expect(movement.pathPendingFor).toBeNull();
      expect(movement.pathRequestId).toBeNull();
      expect(movement.waypoints).toHaveLength(0);
      // La cible elle-même reste : le système la redemandera proprement au prochain tick.
      expect(movement.targetX).not.toBeNull();
    }
    source.dispose();
    target.dispose();
  });

  // Phase 3.8 — ObservableAction est persisté : une sauvegarde prise pendant qu'un
  // humain gather/mange doit préserver l'occurrence exacte au rechargement, sinon un
  // observateur voisin verrait la « même » action comme deux occurrences distinctes.
  it("préserve exactement l'ObservableAction en cours au rechargement (occurrence unique)", () => {
    const source = makeSimulation('observable-mid-action', 4);
    source.start();
    const actor = source.humanIds()[0]!;
    // On pose une action manuellement — pas besoin d'un vrai gather pour tester la
    // persistance du composant lui-même.
    source.entities.addComponent(actor, ObservableAction, {
      kind: 'resource.gathering',
      startedAtTick: 42,
      subjectConceptId: 'berry:red',
    });
    const hashBefore = hashWorldState(source);

    const snapshot = source.captureSnapshot();
    const target = makeSimulation('observable-mid-action', 4);
    target.restoreSnapshot(snapshot);

    const restored = target.entities.getComponentOrThrow(actor, ObservableAction);
    expect(restored).toEqual({
      kind: 'resource.gathering',
      startedAtTick: 42,
      subjectConceptId: 'berry:red',
    });
    // Le hash total (qui inclut ObservableAction depuis 3.8) est identique : preuve
    // que l'occurrence est bit-pour-bit préservée, y compris pour la dédup côté
    // SocialMemory qui utilisera (kind, startedAtTick, subjectConceptId).
    expect(hashWorldState(target)).toBe(hashBefore);
    expect(hashSnapshot(snapshot)).toBe(hashBefore);
    source.dispose();
    target.dispose();
  });
});

/**
 * Le test déterministe ultime (cahier des charges) :
 *
 *     A → 10k ticks → save → load → hash égal → +5k ticks → hash toujours égal
 *
 * Interprétation retenue : deux simulations indépendantes, même seed, tournent
 * jusqu'à 10 000 ticks, sont chacune sauvegardées puis rechargées dans une instance
 * fraîche (symétrie : les deux passent par EXACTEMENT la même procédure — sinon
 * comparer contre une simulation jamais interrompue serait fragile, la file interne
 * du `PathfindingSystem` étant volontairement réinitialisée au chargement). Le hash
 * doit être identique juste après le chargement, puis rester identique après 5 000
 * ticks supplémentaires sur les deux branches.
 */
describe('Simulation determinism — cycle save/load à 10k ticks', () => {
  /**
   * Le test « deux branches rechargées comparées entre elles » (ci-dessous) a un angle
   * mort méthodologique : les deux branches passent par EXACTEMENT la même procédure
   * (`restoreSnapshot`), donc un bug systématique de rechargement — par exemple si
   * `restoreSnapshot` décalait subtilement un stream RNG ou la synchronisation de
   * l'ordonnanceur — biaiserait les deux instances de façon identique et resterait
   * invisible : elles resteraient d'accord l'une avec l'autre tout en ayant toutes les
   * deux dérivé de ce qu'aurait produit une simulation jamais interrompue.
   *
   * Celui-ci compare contre une VRAIE référence indépendante : une branche qui tourne
   * sans jamais passer par save/load, contre une branche rechargée à mi-chemin. C'est
   * en écrivant CE test qu'un vrai bug de `restoreSnapshot` a été trouvé et corrigé :
   * la purge post-chargement effaçait `Movement.waypoints` pour TOUTE entité, y compris
   * celles dont le chemin était déjà entièrement résolu (`pathRequestId === null`) —
   * pas seulement celles avec une requête réellement en vol. Un chemin résolu est une
   * donnée pure, entièrement capturée par le snapshot ; l'effacer forçait un recalcul
   * inutile et désynchronisait le mouvement dès le tick suivant le rechargement (voir
   * `Simulation.restoreSnapshot`).
   *
   * Portée volontairement limitée à UN humain avec UNE cible fixée à la main, plutôt
   * que la population complète sur des milliers de ticks : au-delà de cette échelle,
   * une limite distincte et déjà documentée entre en jeu — le cache LRU et la file à
   * budget internes du `PathFindingService` ne sont PAS persistés (voir la doc de
   * `SimulationSnapshot`). Une simulation qui tourne longtemps développe un cache chaud
   * qu'une branche rechargée n'a pas ; une requête qui aurait été résolue immédiatement
   * (cache chaud) devient une requête différée de plusieurs ticks (cache froid), ce qui
   * démontre la MÊME classe de désynchronisation temporelle, mais pour une raison
   * distincte du bug corrigé ici et hors du périmètre de cette empreinte. Un seul
   * humain avec une cible jamais répétée élimine ce facteur et isole précisément la
   * régression visée.
   */
  it('un chemin déjà résolu au moment de la sauvegarde continue d’être suivi sans interruption après rechargement', () => {
    const seed = 'resolved-path-survives-reload';
    const make = () =>
      new Simulation({ seed, population: 1, config: { time: { gameSecondsPerTick: 1 } } });

    const source = make();
    source.start();
    const human = source.humanIds()[0]!;
    const movement = source.entities.getComponentOrThrow(human, Movement);
    const transform = source.entities.getComponentOrThrow(human, Transform);
    movement.targetX = transform.x + 150;
    movement.targetZ = transform.z + 150;

    // Avance jusqu'à ce que le chemin soit ENTIÈREMENT résolu — condition du bug corrigé.
    let resolved = false;
    for (let i = 0; i < 300 && !resolved; i++) {
      source.step(1);
      resolved = movement.waypoints.length > 0 && movement.pathRequestId === null;
    }
    expect(resolved).toBe(true);

    const hashAtCapture = hashWorldState(source);
    const snapshot = source.captureSnapshot();
    expect(hashSnapshot(snapshot)).toBe(hashAtCapture);

    source.step(1);
    const hashOneTickLaterContinuous = hashWorldState(source);
    source.dispose();

    const target = make();
    target.restoreSnapshot(snapshot);
    target.step(1);

    expect(hashWorldState(target)).toBe(hashOneTickLaterContinuous);
    target.dispose();
  });

  it('10k ticks → save → load (deux instances) → hash égal → +5k ticks → hash toujours égal', () => {
    const seed = 'ultimate-determinism';
    const population = 12;
    const make = () => makeSimulation(seed, population);

    const source = make();
    source.start();
    source.step(10_000);
    const hashAtSave = hashWorldState(source);
    const snapshot = source.captureSnapshot();
    source.dispose();

    const a = make();
    a.restoreSnapshot(snapshot);
    const b = make();
    b.restoreSnapshot(snapshot);

    // Le rechargement seul, sans avancer, doit reproduire exactement l'état sauvegardé.
    expect(hashWorldState(a)).toBe(hashAtSave);
    expect(hashWorldState(b)).toBe(hashAtSave);
    expect(hashWorldState(a)).toBe(hashWorldState(b));

    a.step(5_000);
    b.step(5_000);

    // Même procédure de bout en bout ⇒ même état, cinq mille ticks plus tard.
    expect(hashWorldState(a)).toBe(hashWorldState(b));

    a.dispose();
    b.dispose();
  }, 60_000);

  /**
   * Vérifie que le `WorldDelta` (ressources consommées) traverse lui aussi le cycle
   * save/load sans perte : sans quoi une ressource cueillie avant la sauvegarde
   * réapparaîtrait après le chargement — un bug de persistance classique.
   */
  it('conserve les ressources consommées (WorldDelta) à travers le cycle save/load', () => {
    const seed = 'delta-persistence';
    const source = makeSimulation(seed, 10);
    source.start();
    source.step(3000); // assez pour que plusieurs cueillettes aient eu lieu

    const deletedBefore = source.world.delta.depletedOrRemovedCount;

    const snapshot = source.captureSnapshot();
    const target = makeSimulation(seed, 10);
    target.restoreSnapshot(snapshot);

    expect(target.world.delta.depletedOrRemovedCount).toBe(deletedBefore);
    expect(target.world.delta.size).toBe(source.world.delta.size);

    // Contenu identique, pas seulement le compte.
    for (const [resourceId, delta] of source.world.delta.entries()) {
      const restored = target.world.delta.get(resourceId);
      expect(restored).toBeDefined();
      expect(restored?.state).toBe(delta.state);
    }
    source.dispose();
    target.dispose();
  });

  /**
   * Répétition du cycle save/load (deux fois de suite) : le déterminisme ne doit pas
   * se dégrader avec des rechargements successifs, condition nécessaire pour un monde
   * qui vivra des années avec des sauvegardes automatiques périodiques.
   */
  it('reste déterministe après deux cycles successifs de save/load', () => {
    const seed = 'repeated-cycles';
    const make = () => makeSimulation(seed, 8);

    const a = make();
    a.start();
    a.step(2000);
    let snapshot = a.captureSnapshot();
    a.dispose();

    const b = make();
    b.restoreSnapshot(snapshot);
    b.step(2000);
    snapshot = b.captureSnapshot();
    b.dispose();

    const c1 = make();
    c1.restoreSnapshot(snapshot);
    c1.step(2000);
    const hash1 = hashWorldState(c1);
    c1.dispose();

    const c2 = make();
    c2.restoreSnapshot(snapshot);
    c2.step(2000);
    const hash2 = hashWorldState(c2);
    c2.dispose();

    expect(hash1).toBe(hash2);
  }, 30_000);
});
