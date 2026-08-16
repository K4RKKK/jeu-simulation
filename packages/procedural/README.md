# @civ/procedural — génération procédurale (phase 2)

Terrain, biomes, hydrologie et peuplement en ressources, générés **par chunk et à la
demande** pour un monde de taille arbitraire.

- **Terrain** : sept champs échantillonnés aux sommets du maillage — altitude, pente,
  température, humidité, fertilité, roche, végétation — plus la couleur du sol par
  sommet.
- **Biomes** (`grassland`, `forest`, `rocky`, `wetland`) : dérivés des champs, à
  frontières non carrées.
- **Hydrologie** : écoulement (priority flood), distance aux cours d'eau, étendues d'eau
  (lacs, étangs, rivières) regroupées en corps d'eau identifiés.
- **Ressources** : peuplement des chunks depuis les définitions de `@civ/content`
  (position, échelle, rotation) avec la projection alimentaire `foodKcal` /
  `foodToxicity01` embarquée sur chaque individu — la simulation n'importe jamais
  `content` (CLAUDE.md règle 2).
- **Réseau** : `ChunkData` (pleine précision) traduite en `ChunkPayload` quantifiée sur
  des octets, seule forme que voient le serveur et le client.

Point d'entrée : `ProceduralGenerator` (bruit `NoiseProvider`, `TerrainSampler` en pleine
précision, `WorldBounds`, `SpawnFinder`).

Outils : `pnpm worldgen:test` (un monde, statistiques par chunk), `pnpm worldgen:analyze`
(20 seeds × 24 chunks).
