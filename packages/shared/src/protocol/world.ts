import { z } from 'zod';

/**
 * Contrat réseau du monde procédural.
 *
 * Principe directeur : **le client ne connaît aucun contenu**. Il ne sait pas ce qu'est une
 * « forêt » ni un « silex » ; il reçoit à la connexion la table des biomes et celle des
 * ressources, et les grilles de chunk n'y font référence que par indice. Ajouter une
 * ressource au catalogue la fait donc apparaître à l'écran sans modifier une seule ligne du
 * client.
 */

export const chunkCoordinateSchema = z.object({
  x: z.number().int(),
  z: z.number().int(),
});
export type ChunkCoordinatePayload = z.infer<typeof chunkCoordinateSchema>;

/** Grille encodée en base64 (voir `codec/binary.ts`). */
const encodedArray = z.string();

export const terrainFieldsSchema = z.object({
  elevation: encodedArray,
  slope: encodedArray,
  temperature: encodedArray,
  moisture: encodedArray,
  fertility: encodedArray,
  rockiness: encodedArray,
  vegetation: encodedArray,
  biome: encodedArray,
  /**
   * Octet de coloration de la région macroscopique — PAS un identifiant unique, voir
   * `TerrainFieldGrids.region`.
   */
  region: encodedArray,
  /** Praticabilité réelle par sommet (0/1) — voir `TerrainFieldGrids.walkable`. */
  walkable: encodedArray,
});
export type TerrainFieldsPayload = z.infer<typeof terrainFieldsSchema>;

export const chunkTerrainSchema = z.object({
  resolution: z.number().int().positive(),
  /** Hauteurs du sol, centimètres sur 16 bits. */
  heights: encodedArray,
  /** Hauteurs de la surface d'eau ; sentinelle là où il n'y a pas d'eau. */
  waterHeights: encodedArray,
  /** Couleur du sol par sommet, trois octets par sommet. */
  colors: encodedArray,
  fields: terrainFieldsSchema,
  minHeightM: z.number(),
  maxHeightM: z.number(),
  hasWater: z.boolean(),
});
export type ChunkTerrainPayload = z.infer<typeof chunkTerrainSchema>;

/**
 * Ressources d'un chunk, en colonnes plutôt qu'en objets.
 *
 * Un chunk peut porter plusieurs centaines d'individus ; un tableau d'objets JSON
 * multiplierait sa taille par dix. Chaque spawn porte un `localId` (16 bits) stable
 * pour une même (seed, generationVersion, coordinate) : c'est l'adresse compacte
 * utilisée par les deltas réseau (`resource:updated/added/removed`) — inutile de
 * transmettre l'identifiant complet (chaîne longue) à chaque événement.
 */
export const chunkResourcesSchema = z.object({
  count: z.number().int().nonnegative(),
  definitionIndex: encodedArray,
  /**
   * Identifiant local du spawn dans son chunk propriétaire (0..count-1, ordre stable
   * du générateur). Uint16Array.
   */
  localId: encodedArray,
  /** Position locale dans le chunk, centimètres non signés. */
  x: encodedArray,
  z: encodedArray,
  /** Altitude, centimètres signés. */
  y: encodedArray,
  /** Échelle × 100. */
  scale: encodedArray,
  /** Rotation, 256 pas sur un tour complet. */
  rotation: encodedArray,
});
export type ChunkResourcesPayload = z.infer<typeof chunkResourcesSchema>;

export const chunkPayloadSchema = z.object({
  key: z.string(),
  coordinate: chunkCoordinateSchema,
  terrain: chunkTerrainSchema,
  resources: chunkResourcesSchema,
  waterBodyIndices: z.array(z.number().int().nonnegative()),
  dominantBiomeIndex: z.number().int().nonnegative(),
  walkableRatio: z.number(),
  generationMs: z.number(),
  /**
   * Absent quand aucune cellule de ce chunk n'a d'usure visible — l'immense majorité
   * des chunks, qu'aucun humain n'a jamais foulés. Représentation creuse (`cells`),
   * pas une grille dense : un sentier n'occupe presque jamais toute la surface d'un
   * chunk, et c'est déjà le format qu'utilisent les deltas `trail:updated`.
   */
  trails: z
    .object({
      resolution: z.number().int().positive(),
      cells: z.array(
        z.object({
          index: z.number().int().nonnegative(),
          wear: z.number().int().min(0).max(255),
        }),
      ),
    })
    .optional(),
  /**
   * Absent quand aucune ressource de ce chunk ne porte de mutation `modified` — l'immense
   * majorité des chunks. Sans ceci, une ressource partiellement récoltée (voir
   * `harvestServings`) redevenait visuellement neuve après un rechargement de chunk
   * (éviction du cache, reconnexion) : `WorldDelta.apply()` filtre déjà les ressources
   * `depleted`/`removed` d'un chunk fraîchement généré, mais ne réappliquait jusqu'ici
   * jamais les `changedFields` d'une ressource `modified` — le payload ne les portait
   * simplement pas. C'est le même état que `resource:updated` diffuse en direct, transmis
   * ici pour un chunk qui vient d'être (re)chargé.
   */
  resourceStates: z
    .array(
      z.object({
        localId: z.number().int().nonnegative(),
        changedFields: z.record(z.union([z.number(), z.string(), z.boolean()])),
      }),
    )
    .optional(),
});
export type ChunkPayload = z.infer<typeof chunkPayloadSchema>;

/* ------------------------------------------------------------------ */
/* Métadonnées de génération                                           */
/* ------------------------------------------------------------------ */

export const biomeDescriptorSchema = z.object({
  index: z.number().int().nonnegative(),
  id: z.string(),
  displayName: z.string(),
  color: z.string(),
});
export type BiomeDescriptor = z.infer<typeof biomeDescriptorSchema>;

export const resourceVisualSchema = z.object({
  shape: z.string(),
  primaryColor: z.string(),
  secondaryColor: z.string().optional(),
  heightM: z.number(),
  radiusM: z.number(),
  detailOnly: z.boolean(),
  /** Feuillage caduc : le client module la teinte selon la saison. */
  deciduous: z.boolean().optional(),
});

export const resourceDescriptorSchema = z.object({
  index: z.number().int().nonnegative(),
  id: z.string(),
  displayName: z.string(),
  category: z.string(),
  interactive: z.boolean(),
  visual: resourceVisualSchema,
  food: z
    .object({
      nutritionKcal: z.number(),
      waterContent01: z.number(),
      toxicity01: z.number(),
    })
    .optional(),
});
export type ResourceDescriptor = z.infer<typeof resourceDescriptorSchema>;

export const waterBodyDescriptorSchema = z.object({
  index: z.number().int().nonnegative(),
  id: z.string(),
  type: z.string(),
  displayName: z.string(),
  color: z.string(),
  centerX: z.number(),
  centerZ: z.number(),
  areaM2: z.number(),
  volume: z.number(),
  meanDepthM: z.number(),
  maxDepthM: z.number(),
  surfaceHeightM: z.number(),
  contamination: z.number(),
  pathogenLoad: z.number(),
  turbidity: z.number(),
  temperatureC: z.number(),
  flowRenewal: z.number(),
});
export type WaterBodyDescriptor = z.infer<typeof waterBodyDescriptorSchema>;

export const worldGenerationMetadataSchema = z.object({
  /**
   * Version de l'algorithme ayant produit ce monde. Transmise et conservée : une
   * sauvegarde doit pouvoir dire avec quelle génération elle a été créée.
   */
  generationVersion: z.string(),
  seed: z.string(),
  sizeChunks: z.number().int().positive(),
  chunkSizeMeters: z.number().positive(),
  terrainResolution: z.number().int().positive(),
  minChunk: z.number().int(),
  maxChunk: z.number().int(),
  waterLevelM: z.number(),
  /**
   * Découpage en régions macroscopiques (voir `RegionCoordinate`, `@civ/procedural`) : le
   * client dérive `regionSizeMeters = sizeChunks * chunkSizeMeters` pour calculer
   * localement les coordonnées de région d'une position, sans dépendre d'un tableau de
   * descripteurs par région (aucune région n'a encore de nom/identité éditoriale).
   */
  regions: z.object({ sizeChunks: z.number().int().positive() }),
  biomes: z.array(biomeDescriptorSchema),
  resources: z.array(resourceDescriptorSchema),
  waterBodies: z.array(waterBodyDescriptorSchema),
});
export type WorldGenerationMetadata = z.infer<typeof worldGenerationMetadataSchema>;
