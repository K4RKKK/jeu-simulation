# CLAUDE.md — Règles de développement du moteur

Ce fichier est le contrat architectural du projet. Toute contribution (humaine ou assistée)
doit le respecter. Les règles marquées **[lint]** sont vérifiées automatiquement par
`pnpm lint` (voir `eslint.config.js`).

---

## Vision en une phrase

Nous construisons un **moteur de simulation serveur autoritaire** qui fait émerger une
civilisation préhistorique. Three.js n'est qu'un observateur.

---

## Les 12 règles

### Règle 1 — Aucune logique métier dans `apps/client` **[lint]**

Le client affiche l'état reçu du serveur. Il ne décide jamais qu'un humain a soif, se
déplace, apprend ou meurt. Il ne peut importer que `@civ/shared`.
Interpolation, LOD, caméra, sélection : oui. Règles de survie : jamais.

### Règle 2 — `packages/simulation` n'importe jamais Three.js **[lint]**

Le cœur de simulation ne connaît ni le rendu, ni le réseau, ni le serveur. Il ne dépend
que de `@civ/shared` (types/protocole), de `@civ/procedural` (terrain, hydrologie,
ressources), de `@civ/pathfinding` (grille de navigation, A*) et de la bibliothèque
standard. `@civ/content` reste interdit : les définitions de contenu encodent la matière
des découvertes, et la simulation n'en reçoit que la projection dont elle a besoin
(ex. `foodKcal` / `foodToxicity01` embarquées sur les individus de ressource par
`resourceSpawner`).

### Règle 3 — Le moteur doit tourner headless

`pnpm sim:run` simule un monde entier dans un terminal, sans navigateur, sans WebSocket,
sans base de données. Si une fonctionnalité casse ce mode, elle est mal placée.

### Règle 4 — Jamais `Math.random()` ni `Date.now()` dans la simulation **[lint]**

Toute source d'aléatoire passe par `WorldRng` et un **stream nommé** :

```ts
ctx.rng.behavior.float();
ctx.rng.humans.gaussian(1.7, 0.07);
```

Toute notion de temps passe par `SimulationClock` (`currentTick`, `totalGameSeconds`…).
Seules exceptions autorisées (et isolées dans `runtime/` et `cli/`) : le cadencement
temps-réel de la boucle et l'instrumentation de performance.

### Règle 5 — Toutes les valeurs d'équilibrage viennent de la configuration

Interdit :

```ts
if (hydration > 73) { ... }
```

Obligatoire :

```ts
if (hydration > ctx.config.needs.hydration.criticalThreshold) { ... }
```

La configuration est typée dans `packages/simulation/src/config/simulationConfig.ts` et
fusionnée depuis des overrides partiels.

### Règle 6 — Pas de fichiers géants

Un fichier = une idée. Si un fichier devient difficile à parcourir, il est découpé.
Repère pratique : au-delà de ~300 lignes, se demander sérieusement pourquoi.

### Règle 7 — Une responsabilité par système

`MovementSystem` déplace. Il ne décide pas _où_ aller. `TemporaryWanderSystem` décide où
aller. Il ne déplace pas. Une responsabilité floue est un bug futur.

### Règle 8 — Tout système important est testable isolément

Un système reçoit un `SystemUpdateContext` et n'a aucun état global. Un test doit pouvoir
instancier un `EntityManager`, un `WorldRng`, une `SimulationClock`, appeler `update()` et
observer le résultat.

### Règle 9 — Vérifier avant d'ajouter

Avant d'écrire un nouveau système, vérifier qu'il ne duplique pas un système existant
(mémoire vs connaissances, perception vs mémoire spatiale, besoins vs santé…).

### Règle 10 — Fin de phase = pipeline vert

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

### Règle 11 — Jamais `as any` pour faire taire TypeScript **[lint]**

`@typescript-eslint/no-explicit-any` est en `error`. Une erreur de type signale un modèle
de données incorrect : corriger le modèle, pas le typage.

### Règle 12 — Toute décision doit être explicable

Chaque changement d'activité d'un humain porte une `reason` lisible, propagée jusqu'au
client (`ActivitySnapshot.reason`). Quand l'IA utilitaire arrivera, les scores devront
être inspectables de la même manière.

---

## Règles de contenu supplémentaires

### Pas de faux code

Un système annoncé comme terminé fonctionne. Un `// TODO later` ne compte pas comme une
implémentation. Une fonctionnalité future reste **hors du code** plutôt que simulée.

### Aucune connaissance globale

Interdit à jamais :

```ts
world.technologies.fire = true;
```

La connaissance appartient aux individus (`KnowledgeComponent`). Un agrégat collectif ne
peut être qu'une **statistique dérivée**, jamais une source de vérité.

### Aucun déblocage par palier

Interdit :

```ts
if (level >= 3) unlockFire();
if (rng.float() < 0.01) discoverFire();
```

Une découverte est la conséquence de : connaissances existantes + matériaux + observations

- expérimentations + compétences + conditions environnementales + personnalité + temps +
  échecs précédents.

### Data-driven avant tout

Matériaux, objets, maladies, ressources, concepts, compétences : des **définitions**
enregistrées dans des registres, pas des chaînes de `if`.

### Ordre de priorité des décisions techniques

1. correction — 2. architecture — 3. déterminisme — 4. performance — 5. testabilité —
2. maintenabilité — 7. fonctionnalités — 8. rendu graphique

---

## Cartographie des responsabilités

| Package                | Rôle                                                 | Peut importer                         |
| ---------------------- | ---------------------------------------------------- | ------------------------------------- |
| `packages/shared`      | Types réseau, IDs, schémas Zod, protocole            | (rien)                                |
| `packages/content`     | Définitions : biomes, ressources, profils d'eau      | `shared`                              |
| `packages/procedural`  | Terrain, biomes, hydrologie, ressources              | `shared`, `content`                   |
| `packages/pathfinding` | Grille de navigation, A*, file à budget, cache LRU   | (rien)                                |
| `packages/simulation`  | Cœur : ECS, horloge, RNG, systèmes, monde, besoins   | `shared`, `procedural`, `pathfinding` |
| `apps/server`          | Hébergement, boucle temps-réel, WebSocket, snapshots | `shared`, `simulation`, `procedural`  |
| `apps/client`          | Rendu Three.js, caméra, sélection, debug             | `shared`                              |

`packages/pathfinding` ne connaît ni le terrain ni les humains : il pose une grille de
tuiles carrées et délègue le coût de chaque tuile à un `TileCostProvider`. Le coût réel
(ce qui est franchissable, ce que ça coûte) vient du `PathfindingSystem` de la simulation.

---

## Conventions de code

- Commentaires : expliquer **pourquoi**, jamais **ce que fait la ligne**.
- `import type` obligatoire pour les imports de type (`verbatimModuleSyntax`).
- Nommage : `PascalCase` pour types/classes, `camelCase` pour valeurs, fichiers en
  `camelCase.ts`.
- Tout code temporaire est préfixé `Temporary` et porte un bloc `@temporary` expliquant
  la condition de suppression.

---

## État actuel : Phase 2 terminée, pathfinding + persistance en place

Implémenté : monorepo, ECS, `EventBus`, `WorldRng`, `SimulationClock`,
`SimulationScheduler`, `Simulation`, génération procédurale (sept champs de terrain,
biomes non carrés, hydrologie, ressources), `World` (chunks + environnement, cache LRU
borné de chunks, `WorldDelta` comme source de vérité unique des ressources modifiées/
consommées et de l'usure des sentiers, `WorldChangeJournal` pour le flux réseau
volatile), cycle de vie des ressources `StaticResource → InteractiveResource` ECS au
contact → modification consolidée dans `WorldDelta` → rétrogradation, `HumanFactory`,
`RegionAggregator` (relief/climat/biomes/eau/ressources statiques en cache ; population,
ressources restantes et sentiers dynamiques dérivés sans seconde source de vérité),
météo régionale déterministe et continue (fonction seed + région + horloge,
observable sur le réseau et l'UI, sans état supplémentaire à persister),
`MovementSystem` (waypoints, arrive exactement sur la
cible), `TemporaryWanderSystem`, `MetabolismSystem`, `PerceptionSystem` + `Memory`
(mémoire individuelle des rives et ressources vues, jamais omnisciente ; population
répartie en cohortes déterministes sur plusieurs ticks, cache de ressources comestibles
partagé uniquement pendant le scan courant),
`NeedSatisfactionSystem` (décide depuis la mémoire, raisons « se souvient… » ; une
ingestion met à jour une croyance individuelle sur l'apparence alimentaire, jamais une
vérité globale sur la toxicité),
`PathfindingSystem` (grille de tuiles en coordonnées monde correctement converties,
requêtes appariées par id — jamais par cible partagée —, A* incrémental dont la frontière
est reprise entre les ticks, file FIFO à budget lissé, annulation des recherches
orphelines, cache LRU de chemins et mémo bornée des coûts du terrain partagée entre les
recherches (terrain/hydrologie immuables),
échec → « chemin introuvable » + retenue `pathFailedAtTick` pour les cibles vitales ;
jamais de repli en ligne droite — un humain ne traverse pas une rivière par erreur),
ressources adressées par `(chunkKey, localId)` compact plutôt que par identifiant
complet dans les deltas réseau.

**Persistance** (`packages/simulation/src/persistence/`) : `Simulation.captureSnapshot`/
`restoreSnapshot`, `FilePersistenceAdapter` (écriture atomique, deux fichiers par
sauvegarde), `SaveMetadata` versionnée (`formatVersion`, `SIMULATION_SNAPSHOT_VERSION`,
seed, `generationVersion`, `configFingerprint` — empreinte canonique de la
`SimulationConfig` + géométrie du monde, refuse un chargement dont les règles de jeu ont
dérivé depuis la sauvegarde), test de couverture qui échoue si un composant ECS n'a pas
de politique de persistance explicite. CLI (`sim:run --save-to`/`--load-from`) et
serveur (chargement au démarrage, autosave périodique, sauvegarde à l'arrêt) branchés.
Test de déterminisme save/load : 10k ticks → save → chargé dans deux instances → hash
identique → +5k ticks → hash toujours identique, avec `hashWorldState` couvrant RNG,
`Memory`, `NeedsState`, `WorldDelta`, ordonnanceur, `Personality`, pas seulement
position/besoins. Ce test prouve que deux branches RECHARGÉES depuis le même snapshot
évoluent identiquement — pas qu'une branche jamais interrompue égale sa version
rechargée (voir « Limite de scope connue » plus bas : le cache de pathfinding, non
persisté, fait diverger les deux de quelques ticks).

Serveur Fastify + WebSocket (init/snapshot/delta/events/stats/chunks/resource deltas),
`EntityInterestManager` (états et actions ordinaires limités aux chunks observés, marge
anti-clignotement, plafond stable de 500 humains par client ; naissances/morts mondiales),
`ChunkManager` (transition Active correcte pour un chunk généré après coup, cache de
payload invalidé par révision — ressources et sentiers suivis séparément —, hystérésis
de démotion), client Three.js (terrain, eau animée, saisons, feuillage, ressources,
sentiers d'usure, humains procéduraux, caméra, sélection, inspecteur avec besoins,
panneau de développement F2 réellement branché — calques, métriques p50/p95/p99,
réseau —, inspecteur de terrain F3 avec praticabilité réelle transmise par le serveur),
CLI headless, scripts `stress:*` (génération, pathfinding, chunks, persistance,
simulation longue) avec `PerformanceBudgets` mesurés et `stress:benchmark` reproductible
(échauffement exclu, répétitions indépendantes, médiane). Suite de tests couvrant le
déterminisme (`pnpm test` fait foi pour le compte exact — volontairement pas figé ici,
il dérive à chaque ajout).

**Volontairement absent** (ne pas « compléter » sans plan) : santé, blessures, maladies,
poison, IA utilitaire complète, planificateur d'actions,
compétences, expérimentation, feu, enseignement, relations, langage, inventaire,
artisanat, construction, apparition de nouvelles familles de ressources.

**Limite de scope connue — déterminisme post-rechargement à long terme** : le cache LRU
et la file à budget de `PathFindingService` (`@civ/pathfinding`) ne sont pas persistés
dans `SimulationSnapshot` (voir `packages/simulation/src/persistence/simulationSnapshot.ts`).
Un rechargement à mi-parcours démarre avec un cache froid ; une requête résolue
immédiatement dans une branche continue devient différée de quelques ticks dans la
branche rechargée, ce qui décale le tick de mise en mouvement de l'entité concernée —
et, les streams `WorldRng` étant consommés séquentiellement à travers `entities.each()`,
ce décalage se propage à toutes les entités traitées après elle dans le même tick.
Mesuré empiriquement : le hash `hashWorldState` d'une branche rechargée diverge de celui
de la branche continue en quelques ticks, même à un point de quiescence. Ce n'est pas un
bug de correction (chemins toujours valides, humains toujours arrivés à destination) :
le déterminisme garanti par le snapshot est le hash au tick de sauvegarde, pas la
trajectoire exacte au-delà. Combler ceci demanderait de sérialiser des structures
internes de `@civ/pathfinding`, ce que la Règle 2 décourage — accepté comme limite de
scope, pas planifié.
