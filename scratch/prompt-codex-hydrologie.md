# Refonte complète du système hydrologique (rivières, lacs, étangs)

## Contexte du projet

Moteur de simulation serveur-autoritaire d'une civilisation préhistorique procédurale
(monorepo pnpm, TypeScript strict). Le fichier `CLAUDE.md` à la racine est le contrat
architectural du projet — **le lire intégralement avant de commencer**, ses règles priment
sur tout le reste. Points les plus pertinents pour cette tâche :

- `packages/simulation` n'importe **jamais** Three.js, ni réseau, ni serveur.
- `packages/procedural` (où vit l'hydrologie) n'importe que `packages/shared` et
  `packages/content` — jamais `packages/simulation`.
- **Aucun `Math.random()`/`Date.now()`** : tout aléa passe par le `NoiseProvider`
  déterministe existant (bruit simplex nommé par seed+stream).
- **Toutes les valeurs de réglage viennent de la configuration**
  (`packages/procedural/src/config/worldGenerationConfig.ts`), jamais de constantes
  magiques éparpillées dans le code.
- Pas de fichiers géants (~300 lignes, au-delà se demander pourquoi).
- Une responsabilité par module/fonction.
- Tout doit rester **testable isolément** et **headless** (`pnpm sim:run`, aucun
  navigateur requis).
- Fin de tâche = pipeline vert : `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Pas de faux code : une fonctionnalité annoncée terminée doit fonctionner réellement,
  pas de `// TODO` en guise d'implémentation.

## Mission

Refaire **entièrement** le système de génération et de rendu de l'eau (rivières, lacs,
étangs, sources) : actuellement fonctionnel mais limité, avec des défauts visuels connus
détaillés ci-dessous. L'objectif est un système **plus complet, plus robuste et plus
performant** — pas un simple correctif ponctuel. Tu es libre de repenser l'architecture
interne (structures de données, résolution, pipeline de génération) tant que les
contraintes ci-dessous sont respectées.

## État actuel — architecture existante

Fichiers concernés (`packages/procedural/src/hydrology/`) :

- `coarseGrid.ts` — grille régulière grossière (actuellement 6 m/cellule) couvrant tout
  le monde, avec échantillonnage bilinéaire (`sampleBilinear`, `sampleMasked`).
- `drainageGenerator.ts` / `flowField.ts` — calcul du relief remplissable
  (priority-flood, `priorityFlood.ts`) puis du champ d'écoulement D8 (direction +
  accumulation par cellule), en une passe déterministe triée par altitude décroissante.
- `waterBodiesGenerator.ts` — identifie les cuvettes noyées (lacs/étangs) par
  composantes connexes, creuse le terrain fin d'une marge garantie sous leur surface
  (`standingWaterCarveMarginMeters`).
- `riverGenerator.ts` — marque les cellules dépassant un seuil d'accumulation comme
  rivière (`markRivers`), étend vers l'amont (`growRivers`), construit les entités
  rivière/source par composantes connexes (`buildRivers`), lisse le raccord berge/terrain
  (`smoothCarve`, un flou max-avec-voisins atténué par un facteur de chute).
- `hydrologyGenerator.ts` — orchestre les phases ci-dessus, expose `HydrologyMap`.
- `hydrologyMap.ts` — API interrogée point par point (`sampleWater`, `carve01At`,
  `bodyAt`, `distanceToWaterMeters`) par le reste de la génération (couleur du terrain,
  praticabilité, placement de ressources) et par la simulation (boire, traverser à gué).

Côté rendu (`apps/client/src/render/`) :
- `waterGeometry.ts` — construit un maillage d'eau par chunk en clippant chaque triangle
  du maillage de terrain contre la ligne de rivage (déjà correct : gère un coin mouillé
  sur quatre sans "coin bleu" grossier).
- `waterShader.ts` — shader stylisé (écume de rive, transparence, depth buffer
  logarithmique pour éviter le z-fighting avec le terrain).
- `sceneRenderer.ts` — lumière/ciel, sans lien direct avec l'eau sauf la couleur du ciel
  utilisée pour le brouillard.

Le maillage de terrain (fin, ~2 m/sommet) et la grille hydrologique (grossière, 6 m) sont
**deux résolutions indépendantes** : le terrain interroge l'hydrologie point par point
via `sampleWater()`/`carve01At()`, jamais l'inverse.

## Défauts connus et confirmés (diagnostics effectués, à corriger)

1. **Tracé anguleux vu de loin.** Le squelette d'une rivière est une chaîne de cellules
   voisines sur la grille grossière (connectivité 8-directions) : les virages ne peuvent
   se faire qu'à 45°/90°, ce qui donne un tracé en escalier/zig-zag plutôt qu'un
   méandre naturel, très visible en vue aérienne. Aucun lissage de type spline n'existe
   sur la ligne centrale elle-même (seul le *raccord berge/terrain* est lissé, pas la
   *trajectoire*).

2. **Fragmentation visuelle des rivières étroites.** Diagnostic confirmé sur plusieurs
   seeds : la donnée hydrologique elle-même est saine (chaque rivière logique = une seule
   composante connexe de cellules réellement mouillées, taille exacte). Le problème est
   dans l'interpolation entre la grille grossière (6 m) et le maillage fin de rendu (2 m) :
   `carve01At()` fait une bilinéaire classique entre une cellule mouillée et ses voisines
   sèches (`carve01 ≈ 0`), ce qui dilue la profondeur d'eau interpolée sous le seuil
   minimal (`MIN_WATER_DEPTH_METERS = 0.05` dans `hydrologyMap.ts`) dès qu'on s'écarte du
   centre d'une cellule. Mesuré : ~45 % seulement des sommets du maillage fin dans
   l'emprise d'un ruisseau étroit sont effectivement rendus comme eau → ruban d'eau
   visiblement pointillé. Baisser le seuil de masque (`MIN_WATER_MASK`) n'apporte quasi
   aucun gain (45→47 %) : le vrai verrou est la dilution de la *profondeur*, pas du
   masque de présence.

3. **Résolution unique, non adaptative.** La grille grossière est à 6 m partout, aussi
   bien pour un grand fleuve que pour un ruisseau de tête de bassin — pas de raffinement
   local là où la largeur réelle de l'eau serait plus fine que la cellule.

4. **Pas de représentation vectorielle de la ligne centrale.** Tout est dérivé d'un champ
   scalaire (mask/carve/surface par cellule) ; il n'existe aucune polyligne/spline
   explicite du cours d'eau qui pourrait servir à la fois au rendu (largeur variable
   lissée) et à la simulation (ex. suivre le courant, un radeau plus tard).

## Objectifs de la refonte

- **Rivières visuellement continues et naturelles**, y compris vues de loin/en aérien :
  méandres crédibles, largeur qui varie progressivement avec le débit, pas de zig-zag ni
  de segments qui disparaissent.
- **Garantie de continuité au rendu** : si la donnée dit qu'un tronçon est rivière, il
  doit être visuellement rendu comme tel sur toute sa longueur, quelle que soit la
  résolution du maillage de terrain qui l'interroge — plus de dépendance fragile à la
  coïncidence entre pas de grille grossière et pas de maillage fin.
- **Performance** : la génération d'un monde doit rester dans un budget raisonnable
  (regarder `packages/simulation/src/config/performanceBudgets.ts` et les scripts
  `stress:*` existants — `packages/procedural`/`apps/server` en ont un pour la
  génération). Un monde de taille par défaut ne doit pas voir son temps de génération
  exploser par rapport à l'existant.
- **Déterminisme strict conservé** : même seed ⇒ même monde, bit pour bit, y compris
  après sauvegarde/rechargement (voir `packages/simulation/src/persistence/`, le test de
  déterminisme save/load à 10k ticks fait foi).
- **Toutes les invariantes physiques déjà établies restent vraies** (et si tu changes le
  modèle, migre-les plutôt que de les supprimer) :
  - une berge ne doit jamais être creusée plus profond que la surface d'eau voisine
    (l'eau ne doit jamais "flotter" au-dessus du sol) ;
  - un plan d'eau stagnant (lac/étang) garde une marge de creusement garantie sous sa
    surface à son propre centre ;
  - aucune rivière ne remonte une pente ;
  - aucun repli en ligne droite dans le pathfinding à travers l'eau (déjà géré côté
    simulation, à ne pas casser).
- **Rester data-driven et config-driven** (règle 5 de `CLAUDE.md`) : tout paramètre de
  réglage (seuils, largeurs, résolutions, forces de lissage…) dans
  `WorldGenerationConfig`, jamais en dur.
- **API `HydrologyMap` stable ou migrée proprement** : la simulation
  (`packages/simulation`) et le reste de `packages/procedural` consomment
  `sampleWater()`, `carve01At()`, `bodyAt()`, `distanceToWaterMeters()`. Si tu changes la
  représentation interne, ces points d'entrée doivent continuer à fournir une réponse
  cohérente point par point (le reste du moteur ne doit pas avoir à changer, ou alors de
  façon minime et justifiée).

## Pistes possibles (à toi de choisir/combiner, pas une prescription)

- Représentation vectorielle explicite de la ligne centrale d'une rivière (polyligne ou
  spline Catmull-Rom lissée à partir de la chaîne de cellules), avec largeur portée le
  long de cette ligne plutôt que déduite d'un champ scalaire par cellule — le rendu
  redevient une distance signée à cette ligne plutôt qu'une bilinéaire entre cellules
  voisines.
- Résolution adaptative de la grille hydrologique (plus fine près des cours d'eau
  étroits, grossière ailleurs) ou passage direct à un échantillonnage indépendant de
  toute grille (fonction continue de distance à la ligne centrale + largeur interpolée
  le long de la ligne, dans l'esprit du bruit continu déjà utilisé pour le relief).
- Lissage explicite de la trajectoire (relaxation/spline) en plus du lissage déjà
  existant du raccord berge/terrain.
- Séparer clairement *tracé/largeur* (déterministe, dérivé du relief et du débit) de
  *rendu* (comment le client construit son maillage), pour que la fragmentation
  actuelle — un problème d'échantillonnage au rendu — ne puisse plus se reproduire quelle
  que soit la résolution du maillage de terrain choisie plus tard.

## Contraintes de mise en œuvre

- Découpe le travail en modules clairs à responsabilité unique (règle 7), fichiers courts
  (règle 6).
- Chaque nouveau module significatif doit être testable isolément (règle 8) — inspire-toi
  du style de tests déjà en place dans `packages/procedural/src/hydrology/*.test.ts`
  (construction d'un générateur avec seed fixe, assertions sur invariantes physiques
  plutôt que sur des positions exactes fragiles).
- Vérifie qu'il n'existe pas déjà un mécanisme équivalent avant d'en ajouter un (règle 9)
  — relis `hydrologyGenerator.ts`/`riverGenerator.ts`/`waterBodiesGenerator.ts` en entier
  avant de commencer.
- Pas de `as any` (règle 11) ; une erreur de type = corriger le modèle de données.
- Ajoute des tests couvrant explicitement les défauts listés plus haut (ex. : un test qui
  génère un monde réel et vérifie que **chaque** rivière logique correspond à une seule
  composante connexe de sommets *effectivement rendus comme eau* au pas du maillage fin,
  pas seulement au centre des cellules grossières — c'est exactement le diagnostic qui a
  révélé le bug #2, formalise-le en test de non-régression).

## Definition of Done

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` intégralement verts.
- Un monde généré avec une seed fixe donne, visuellement, des rivières continues sans
  segment manquant même en vue aérienne éloignée, et des méandres crédibles plutôt qu'un
  tracé en escalier — à vérifier en lançant le jeu réellement (`pnpm dev` ou les scripts
  `dev:server`/`dev:client`), pas seulement par les tests.
- Aucune régression sur les invariantes physiques listées plus haut (garder ou migrer les
  tests existants qui les couvrent dans `hydrology.test.ts`).
- Aucune régression de déterminisme (les tests de `packages/simulation` couvrant
  save/load doivent rester verts sans modification de leur seuil/tolérance).
- Documente dans le code (commentaires qui expliquent le *pourquoi*, pas le *quoi* —
  convention du projet) les nouvelles invariantes introduites, sur le modèle des
  commentaires déjà présents dans `waterBodiesGenerator.ts`/`riverGenerator.ts`.
