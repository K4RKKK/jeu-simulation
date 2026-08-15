import { describe, expect, it } from 'vitest';
import { registeredComponentNames } from '../core/componentType.js';
// Importés pour leur EFFET DE BORD : chaque module appelle `defineComponent` à son
// chargement. Sans ces imports, `registeredComponentNames()` ne verrait que les
// composants déjà chargés par d'autres tests exécutés avant celui-ci dans le même
// process — un ordre fragile. On importe explicitement TOUS les modules connus qui
// définissent des composants ECS, pour rendre ce test indépendant de l'ordre.
import '../components/index.js';
import '../systems/temporary/temporaryWanderSystem.js';
import {
  INTENTIONALLY_UNPERSISTED_COMPONENT_NAMES,
  PERSISTED_COMPONENTS,
} from './simulationSnapshot.js';

/**
 * Filet de sécurité anti-oubli (CLAUDE.md règle 8 : testable isolément — ici, testable
 * qu'un oubli silencieux est impossible).
 *
 * Le danger concret : demain, quelqu'un ajoute `KnowledgeComponent` (ou `Health`,
 * `Skills`, `Inventory`…) dans `components/index.ts`, l'utilise partout, tout
 * fonctionne en test headless… et huit mois plus tard, le premier redémarrage réel du
 * serveur 24/7 efface silencieusement les connaissances de tous les humains, parce que
 * personne n'a pensé à l'ajouter à `PERSISTED_COMPONENTS` dans
 * `persistence/simulationSnapshot.ts`. Aucun test existant n'aurait rien détecté avant
 * ce moment — précisément parce que le bug n'est observable qu'après un cycle
 * save/load, jamais dans une simulation qui tourne sans interruption.
 *
 * Ce test rend cet oubli impossible : chaque composant enregistré via `defineComponent`
 * doit apparaître soit dans `PERSISTED_COMPONENTS` (persisté), soit dans
 * `INTENTIONALLY_UNPERSISTED_COMPONENT_NAMES` (exclu avec une raison écrite) — jamais
 * dans aucun des deux.
 */
describe('Couverture de persistance des composants ECS', () => {
  it('chaque composant enregistré a une politique de persistance explicite', () => {
    const registered = registeredComponentNames();
    // Composants créés par des fichiers de test (entityManager.test.ts, etc.) : ils
    // ne font pas partie du catalogue réel du jeu, et ce fichier ne les importe pas —
    // s'ils apparaissent, un autre test les a déjà chargés dans le même process.
    // On ne les exige d'aucune des deux listes.
    const gameComponents = registered.filter((name) => !name.startsWith('Test'));

    const persistedNames = new Set(PERSISTED_COMPONENTS.map((type) => type.name));
    const undecided = gameComponents.filter(
      (name) => !persistedNames.has(name) && !INTENTIONALLY_UNPERSISTED_COMPONENT_NAMES.has(name),
    );

    expect(
      undecided,
      `Composant(s) sans politique de persistance explicite : ${undecided.join(', ')}. ` +
        `Ajoute-les à PERSISTED_COMPONENTS (persistence/simulationSnapshot.ts) s'ils doivent ` +
        `survivre à un redémarrage, ou à INTENTIONALLY_UNPERSISTED_COMPONENT_NAMES avec une ` +
        `justification écrite sinon.`,
    ).toEqual([]);
  });

  it('aucun composant n’est déclaré à la fois persisté et intentionnellement exclu', () => {
    const persistedNames = new Set(PERSISTED_COMPONENTS.map((type) => type.name));
    const overlap = [...INTENTIONALLY_UNPERSISTED_COMPONENT_NAMES].filter((name) =>
      persistedNames.has(name),
    );
    expect(overlap).toEqual([]);
  });
});
