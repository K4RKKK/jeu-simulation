# Civilisation émergente — moteur de simulation

Simulation de vie et de civilisation préhistorique **entièrement systémique**. Une petite
population humaine apparaît dans un monde sauvage, sans technologie et sans arbre
technologique. Le joueur n'incarne personne : il observe.

L'objectif n'est pas d'écrire les histoires, mais de construire les systèmes qui les font
émerger.

> Ce dépôt est au terme de la **phase 2** : les fondations du moteur et la génération
> procédurale du monde. Voir [État actuel](#état-actuel) pour ce qui existe réellement.

---

## Principes

| Principe                        | Conséquence concrète                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- |
| **Le serveur est autoritaire**  | Le monde tourne même sans navigateur ouvert. Le client n'est qu'un observateur.  |
| **Three.js ne fait que rendre** | `packages/simulation` ne connaît ni le rendu, ni le réseau (vérifié par ESLint). |
| **Déterminisme**                | Aucun `Math.random()` ni `Date.now()` dans la simulation. Une seed ⇒ un monde.   |
| **Aucun déblocage par palier**  | Pas de `if (level >= 3) unlockFire()`. Une découverte se mérite par ses causes.  |
| **Aucune connaissance globale** | Le savoir appartient aux individus, jamais au monde.                             |
| **Data-driven**                 | Des définitions et des registres, pas des chaînes de `if`.                       |
| **Pas de faux code**            | Un système annoncé fonctionne. Le reste reste hors du dépôt.                     |

Les règles complètes et contraignantes sont dans **[CLAUDE.md](CLAUDE.md)**.

---

## Architecture

```
SIMULATION (autoritaire, headless)
        ↓  world state
   SNAPSHOTS / DELTAS / EVENTS
        ↓  WebSocket
   CLIENT THREE.JS (observateur)
```

```
apps/
  server/       Fastify + WebSocket. Héberge le monde, diffuse snapshots, deltas et chunks.
  client/       Vite + Three.js. Rendu, caméra, sélection, debug. Zéro logique métier.
packages/
  shared/       Types réseau, IDs, schémas Zod. Seul contrat commun aux deux.
  simulation/   Le moteur : ECS, horloge, RNG, ordonnanceur, monde, besoins, systèmes.
  procedural/   Génération procédurale : terrain, biomes, hydrologie, ressources.
  content/      Définitions data-driven : biomes, ressources, profils d'eau.
  pathfinding/  Grille de navigation, A* à budget, file FIFO, cache LRU. Sans dépendance.
```

Règle de dépendance, vérifiée par `pnpm lint` :

```
client  →  shared
server  →  shared, simulation, procedural
simulation → shared, procedural, pathfinding
procedural → shared, content
pathfinding → (rien)
content  →  shared
shared  →  (rien)
```

La simulation n'importe jamais `content` : les définitions de contenu encodent ce que les
humains doivent découvrir ; elle n'en reçoit que la projection (ex. `foodKcal` /
`foodToxicity01` embarquées sur les individus de ressource).

---

## Installation

Prérequis : **Node ≥ 20.11** et **pnpm 9**.

```bash
pnpm install
```

PostgreSQL est décrit dans `docker-compose.yml` mais **n'est requis par rien** aujourd'hui :
la simulation tourne intégralement en mémoire, et la persistance existante écrit sur
disque (`FilePersistenceAdapter`) — pas de base de données pour l'instant.

---

## Commandes

```bash
pnpm dev
```

Lance le serveur de simulation **et** le client. Ouvrir <http://localhost:5173>.

| Commande                  | Effet                                                                |
| ------------------------- | -------------------------------------------------------------------- |
| `pnpm dev`                | Serveur + client en parallèle                                        |
| `pnpm dev:server`         | Serveur seul (`http://localhost:8787`)                               |
| `pnpm dev:client`         | Client seul (`http://localhost:5173`)                                |
| `pnpm sim:run`            | Simulation headless dans le terminal, sans navigateur                |
| `pnpm worldgen:test`      | Génère un monde et affiche les statistiques de chunks                |
| `pnpm worldgen:analyze`   | Analyse 20 seeds (20 chunks chacune)                                 |
| `pnpm stress:worldgen`    | Génération procédurale sous charge (déterminisme, NaN, doublons)     |
| `pnpm stress:pathfinding` | Service de chemins sous charge (chemins invalides, budgets)          |
| `pnpm stress:chunks`      | Cycle de vie `ChunkManager` sous charge (fuite mémoire, transitions) |
| `pnpm stress:persistence` | Cycles save/load répétés (divergence de hash, fuite mémoire)         |
| `pnpm stress:simulation`  | Long run headless surveillé (NaN, budgets de performance)            |
| `pnpm stress:benchmark`   | Benchmark stable (échauffement, répétitions, médiane)                |
| `pnpm test`               | Suite de tests (Vitest)                                              |
| `pnpm typecheck`          | TypeScript strict sur tous les packages                              |
| `pnpm lint`               | ESLint, y compris les règles d'architecture                          |
| `pnpm build`              | Typecheck + bundle serveur + build client                            |
| `pnpm format`             | Prettier                                                             |

### Simulation headless

```bash
pnpm sim:run --seed test --population 20 --days 10
```

```
Simulation complete

  Seed:                test
  Days:                10
  Ticks:               864 000
  Initial population:  20
  Final population:    20
  Deaths:              0
  Events:              377062
  Average tick:        0.0010 ms
  Wall clock:          1.55 s
  State hash:          e20d4a06
```

Dix jours de jeu, 864 000 ticks, en 1,5 s. Le mode headless utilise par défaut un tick
d'une seconde de jeu (`--tick-seconds`) : sans rendu, la finesse de 20 Hz du serveur n'a
aucun intérêt.

Options : `--seed`, `--population`, `--days`, `--tick-seconds`, `--inspect`, `--quiet`,
`--save-dir`, `--save-to`, `--load-from`, `--help`.

```bash
pnpm sim:run --load-from world-1 --days 5 --save-to world-1
```

Reprend une sauvegarde, simule cinq jours de plus, réécrit la même sauvegarde. La seed
effective devient celle de la sauvegarde chargée (prioritaire sur `--seed`).

### Variables d'environnement

Copier `.env.example`. Principales : `CIV_PORT`, `CIV_WORLD_SEED`, `CIV_POPULATION`,
`CIV_TICK_RATE_HZ`, `CIV_NET_RATE_HZ`, `VITE_SERVER_URL`, `CIV_SAVE_DIR` (dossier de
sauvegardes, vide = monde éphémère), `CIV_SAVE_SLOT`, `CIV_AUTOSAVE_INTERVAL_TICKS`
(0 = désactivé), `CIV_SAVE_ON_SHUTDOWN`.

---

## Notions du moteur

**ECS léger.** `Entity` = identifiant numérique jamais recyclé (donc persistable sans
risque de collision). `Component` = donnée pure. `System` = comportement. Aucun héritage.

**`WorldRng`.** Générateur déterministe cloisonné en _streams_ nommés
(`worldGeneration`, `humans`, `behavior`, `metabolism`, `discovery`, `disease`,
`language`). Ajouter un tirage dans le comportement ne décale pas la génération du
terrain.

**`SimulationClock`.** Ticks et temps de jeu, découplés du temps réel. `timeScale` change
la vitesse d'observation, jamais la physique du monde.

**`SimulationScheduler`.** Chaque système déclare une fréquence (`fast`, `medium`, `slow`,
`verySlow`) et reçoit le temps écoulé _depuis sa propre dernière exécution_. Les systèmes
de même fréquence sont décalés pour étaler la charge.

**`EventBus` + `EventRecorder`.** Bus typé, tampon borné. Base de l'historique, du réseau,
des statistiques et du futur replay.

**Configuration.** Toute valeur d'équilibrage vit dans `SimulationConfig`. Aucun littéral
d'équilibrage dans les systèmes.

**Explicabilité.** Chaque changement d'activité porte une `reason` propagée jusqu'à
l'inspecteur du client.

**Besoins et survie.** Chaque humain possède trois réserves — hydratation, faim, énergie —
drainées en continu par son métabolisme (la marche coûte, la chaleur assoiffe, la nuit
fait dormir). Un système dédié hiérarchise les urgences (épuisement > soif > faim) puis
agit : chercher l'eau la plus proche, une plante comestible, boire, manger, se reposer.
Manger retire la ressource du monde, qui devient rare. La toxicité d'un aliment se
découvre en le mangeant (conséquence physiologique immédiate) — elle n'est **ni
mémorisée ni apprise** : un humain peut remanger le même champignon toxique plus tard,
rien ne l'en empêche encore. Ce sera le rôle d'un futur système de connaissances.

**Persistance.** Le modèle est « état = seed + version de génération + configuration +
snapshot ». Une sauvegarde capture l'horloge, le RNG, les entités/composants,
l'ordonnanceur et `WorldDelta` (ressources modifiées/consommées, usure des sentiers) ;
elle est refusée au chargement si la seed, la version de génération ou une empreinte
canonique de la configuration ont changé depuis. Écriture atomique sur disque, autosave
serveur périodique, `sim:run --save-to`/`--load-from` en CLI.

**Chunks procéduraux.** Le terrain (altitude, pente, température, humidité, fertilité,
roche, végétation), les biomes, l'hydrologie (lacs, étangs, rivières) et le peuplement en
ressources sont générés par chunk, à la demande, en pleine précision pour la simulation
puis quantifiés sur des octets avant d'être diffusés au client.

---

## État actuel

### Implémenté et fonctionnel

Monorepo et outillage · ECS (`EntityManager`, `ComponentStore`, composants typés) ·
`EventBus` / `EventRecorder` · `WorldRng` (streams cloisonnés) · `SimulationClock` ·
`SimulationScheduler` · `SimulationMetrics` (percentiles p50/p95/p99) · `Simulation` ·
génération procédurale (terrain à sept champs + praticabilité réelle transmise au
client, biomes à frontières non carrées, hydrologie — lacs, étangs, rivières —,
peuplement en ressources adressées par `(chunkKey, localId)` compact) · `World` (chunks

- environnement jour/nuit, saisons, température, cache LRU borné de chunks,
  `WorldDelta` comme source de vérité unique — ressources et sentiers avec des révisions
  de fraîcheur séparées, `WorldChangeJournal` pour le réseau) ·
  `RegionAggregator` (statistiques régionales statiques en cache + population, ressources
  restantes et sentiers dynamiques dérivés de l'ECS/`WorldDelta`) · écologie régionale
  légère (pression de récolte et des sentiers, eau,
  fertilité, résilience) avec repousse déterministe, bornée, persistante et visible
  par tous les clients · météo régionale déterministe (pluie, neige, orage,
  brouillard, vent, transitions continues, affichage UI)
  · **persistance**
  (`Simulation.captureSnapshot`/`restoreSnapshot`, `FilePersistenceAdapter` atomique,
  `SaveMetadata` versionnée avec empreinte de configuration, autosave serveur, CLI
  `--save-to`/`--load-from`) · promotion **StaticResource → InteractiveResource ECS** au
  premier contact (instance unique partagée entre acteurs, modification consolidée dans
  `WorldDelta`, rétrogradation après la dernière interaction) · `HumanFactory`
  (morphologie et personnalité dérivées, noms
  procéduraux) · `MovementSystem` (waypoints, arrivée exacte) · `TemporaryWanderSystem`
  _(temporaire)_ · besoins et métabolisme (hydratation, faim, énergie ; boire, manger, se
  reposer ; ressources finies) · `PerceptionSystem` + `Memory` (chaque humain ne connaît
  que ce qu'il a vu : rives et ressources en mémoire individuelle ; scans répartis en
  cohortes déterministes sur plusieurs ticks et ressources comestibles filtrées une fois
  par chunk partagé ; la toxicité se découvre en mangeant, sans être mémorisée ni apprise ;
  décisions « se souvient… ») ·
  `PathfindingSystem` (grille de navigation 2 m en coordonnées monde correctement
  converties, requêtes appariées par identifiant — jamais par cible partagée entre
  plusieurs humains —, A* incrémental à budget étalé par tick, frontière reprise sans
  recalcul, annulation des recherches orphelines, file FIFO déterministe, cache LRU de
  chemins et mémo terrain bornée partagée entre recherches ; échec → « chemin
  introuvable » + retenue `pathFailedAtTick` ; jamais de repli en ligne droite, dernier
  point de passage jamais forcé dans une cible non praticable) · `ChunkManager` (bascule
  Active correcte, cache de payload par révision) · `EntityInterestManager` (index spatial
  par chunk, marge de stabilité et plafond de 500 humains visibles par observateur) ·
  serveur Fastify + WebSocket (init / snapshot / delta / events / stats / ping / chunks /
  deltas de ressources, états humains limités à la zone réellement observée) ·
  client Three.js (terrain coloré, eau animée, saisons, feuillage, ressources, sentiers
  d'usure, humains procéduraux, caméra libre, sélection, inspecteur, panneau de
  développement F2 branché) · CLI headless · scripts `stress:*` (worldgen, pathfinding,
  chunks, persistance, simulation longue) avec budgets de performance mesurés ·
  tests fonctionnels et de performance (`pnpm test` fait foi pour le compte exact), dont
  le déterminisme.

### Volontairement absent

Santé, blessures, maladies, poison, IA utilitaire, planificateur d'actions,
connaissances (apprentissage durable — la toxicité n'est aujourd'hui qu'une conséquence
immédiate, jamais retenue), compétences, expérimentation, feu, enseignement, relations,
langage, inventaire, artisanat, construction, apparition de nouvelles familles de ressources.

Ce n'est pas un oubli : une excellente fondation vaut mieux que trente systèmes
incomplets.

### Code temporaire

`TemporaryWanderSystem` fait errer les humains **sans aucune raison** — et ne s'approche
jamais de ceux qui boivent, mangent ou se reposent. Il n'existe que pour valider la chaîne
entités → tick → réseau → rendu, et sera supprimé dès l'arrivée de `UtilityAI` +
`ActionPlanner`.
