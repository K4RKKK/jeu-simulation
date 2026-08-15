# @civ/content — définitions data-driven

Définitions enregistrées du monde, jamais des chaînes de `if` (CLAUDE.md, « Data-driven
avant tout ») :

- **Biomes** (6) : `grassland`, `sparse_forest`, `forest`, `rocky`, `wetland`,
  `riverbank` — plages sur les champs du terrain (`temperature`, `moisture`, `slope`,
  `rockiness`, `elevation`, `waterProximity`) avec poids et priorités. Les deux biomes de
  transition (`sparse_forest`, `riverbank`) évitent les contacts brutaux entre milieux.
- **Ressources** (16) : arbres, buissons, plantes, champignons, minéraux — densité,
  rareté, agrégation, préférences de biome, contraintes de terrain, apparence
  (forme, couleurs, taille), comestibilité (`food`) et interactivité.
- **Profils d'eau** (4) : `river`, `lake`, `pond`, `spring` — propriétés de base
  (contamination, pathogènes, turbidité, renouvellement, température, franchissabilité).
- **Registres** : `BiomeRegistry`, `ResourceRegistry`, `WaterProfileRegistry` +
  `ContentCatalog` construit à la demande (pas de singleton — un test instancie un
  catalogue réduit).

**Frontière du contenu.** Une définition dit ce qu'une chose **est** et où elle se
trouve, jamais ce qu'un humain peut en faire ni ce qu'il en sait : le silex est décrit
comme une pierre rare des zones rocheuses ; qu'il produise un éclat tranchant sera une
découverte, pas une propriété déclarée ici. Aucune connaissance n'est encodée (une
`MaterialDefinition` décrit une propriété physique ; savoir que le bois sec brûle reste
une connaissance individuelle).

`@civ/procedural` consomme ces définitions pour générer le monde. La simulation n'y a
**pas** accès (CLAUDE.md règle 2) : elle ne reçoit que la projection embarquée sur les
individus de ressource (`foodKcal`, `foodToxicity01`).

Registres à venir : matériaux, objets, maladies, concepts, compétences.