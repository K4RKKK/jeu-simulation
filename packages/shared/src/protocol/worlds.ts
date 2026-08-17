import { z } from 'zod';

/**
 * Gestion des mondes (HTTP, hors du protocole WebSocket temps réel).
 *
 * Un seul monde est actif à la fois côté serveur — le partager entre plusieurs
 * sauvegardes nommées ne fait pas tourner plusieurs simulations en parallèle. Le client
 * n'a jamais accès à `SaveMetadata` brute (`packages/simulation`) : `saveId`,
 * `snapshotHash`, `configFingerprint`, `formatVersion` sont des détails d'implémentation
 * serveur (intégrité de sauvegarde) sans intérêt ni sens côté client. Ce résumé est la
 * seule forme qui traverse la frontière réseau.
 */
export const worldSummarySchema = z.object({
  name: z.string(),
  seed: z.string(),
  tick: z.number().int().nonnegative(),
  humanCount: z.number().int().nonnegative(),
  savedAtIso: z.string(),
  label: z.string().optional(),
  /** Vrai pour le monde actuellement servi par le serveur — au plus un à la fois. */
  isActive: z.boolean(),
});
export type WorldSummary = z.infer<typeof worldSummarySchema>;

export const worldSummaryListSchema = z.array(worldSummarySchema);

/**
 * `seed`/`sizeChunks`/`population` restent optionnels : absent, le serveur choisit
 * (seed aléatoire, valeurs par défaut de sa config) — le client ne doit jamais inventer
 * une seed ou des valeurs par défaut qui pourraient diverger de celles du serveur.
 */
export const createWorldRequestSchema = z.object({
  name: z.string().min(1).max(64),
  seed: z.string().min(1).max(64).optional(),
  sizeChunks: z.number().int().positive().max(64).optional(),
  population: z.number().int().positive().max(500).optional(),
});
export type CreateWorldRequest = z.infer<typeof createWorldRequestSchema>;

export const renameWorldRequestSchema = z.object({
  newName: z.string().min(1).max(64),
});

export const duplicateWorldRequestSchema = z.object({
  newName: z.string().min(1).max(64),
});

/**
 * `image` est déjà un JPEG encodé en base64 (voir `HTMLCanvasElement.toDataURL`, préfixe
 * `data:image/jpeg;base64,` retiré côté client) — le serveur ne fait que le stocker tel
 * quel, jamais de décodage/réencodage.
 */
export const uploadThumbnailRequestSchema = z.object({
  // Borne large mais réelle : ~512 Ko décodés (miniature JPEG basse résolution) tiennent
  // sous 700 000 caractères base64. La validation fine (base64 bien formé, signature
  // JPEG) vit côté serveur (`InvalidThumbnailError`) — ceci n'est qu'un garde-fou de
  // taille avant même de tenter de décoder quoi que ce soit.
  image: z.string().min(1).max(700_000),
});
export type UploadThumbnailRequest = z.infer<typeof uploadThumbnailRequestSchema>;

/** Réponse d'erreur uniforme des routes `/api/worlds*` — jamais une trace de pile brute. */
export const worldsApiErrorSchema = z.object({
  error: z.string(),
});
export type WorldsApiError = z.infer<typeof worldsApiErrorSchema>;
