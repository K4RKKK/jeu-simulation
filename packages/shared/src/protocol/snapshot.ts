import { z } from 'zod';

/**
 * Le snapshot est découpé en deux familles volontairement distinctes :
 *
 * - `HumanProfile`   : ce qui ne change pas (ou très lentement) — envoyé une seule fois.
 * - `HumanState`     : ce qui change à chaque tick — envoyé en delta.
 *
 * Cette séparation est la raison pour laquelle un delta réseau reste petit même quand un
 * humain porte beaucoup d'informations descriptives.
 */

export const sexSchema = z.enum(['male', 'female']);
export type Sex = z.infer<typeof sexSchema>;

export const personalitySchema = z.object({
  curiosity: z.number(),
  caution: z.number(),
  sociability: z.number(),
  aggression: z.number(),
  patience: z.number(),
  altruism: z.number(),
  courage: z.number(),
  perseverance: z.number(),
});
export type PersonalitySnapshot = z.infer<typeof personalitySchema>;

export const humanProfileSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  sex: sexSchema,
  ageYears: z.number(),
  heightM: z.number(),
  massKg: z.number(),
  /** Teinte de peau/vêtement, 0..1, pour différencier visuellement les individus. */
  tint: z.number(),
  /** Vitesse de marche de référence en m/s, dérivée de la morphologie. */
  walkSpeedMps: z.number(),
  personality: personalitySchema,
  bornAtTick: z.number().int().nonnegative(),
});
export type HumanProfile = z.infer<typeof humanProfileSchema>;

export const activityKindSchema = z.enum(['idle', 'walking', 'drink', 'eat', 'rest']);
export type ActivityKind = z.infer<typeof activityKindSchema>;

export const needsSnapshotSchema = z.object({
  /** Hydratation, 1 = pleine, 0 = déshydratation critique. */
  hydration: z.number(),
  /** Rassasiement, 1 = repu, 0 = affamé. */
  hunger: z.number(),
  /** Énergie, 1 = frais, 0 = épuisé. */
  energy: z.number(),
});
export type NeedsSnapshot = z.infer<typeof needsSnapshotSchema>;

export const humanStateSchema = z.object({
  id: z.number().int().positive(),
  x: z.number(),
  /** Altitude du sol sous l'individu : le client ne recalcule jamais le terrain. */
  y: z.number(),
  z: z.number(),
  /** Orientation en radians, 0 = +Z. */
  yaw: z.number(),
  /** Vitesse instantanée en m/s (0 quand immobile). */
  speed: z.number(),
  activity: activityKindSchema,
  /** Raison lisible du choix courant — support de la règle 12 (explicabilité). */
  reason: z.string(),
  /** Destination courante, si l'humain en a une. */
  targetX: z.number().nullable(),
  targetZ: z.number().nullable(),
  /** État des besoins vitaux, calculé par le métabolisme. */
  needs: needsSnapshotSchema,
});
export type HumanState = z.infer<typeof humanStateSchema>;

export const worldDescriptorSchema = z.object({
  worldId: z.string(),
  seed: z.string(),
  sizeMeters: z.number(),
  chunkSizeMeters: z.number(),
});
export type WorldDescriptor = z.infer<typeof worldDescriptorSchema>;

export const clockSnapshotSchema = z.object({
  tick: z.number().int().nonnegative(),
  year: z.number().int(),
  day: z.number().int(),
  hour: z.number().int(),
  minute: z.number().int(),
  /** Progression dans la journée, 0..1 — utilisée par le client pour le ciel. */
  dayProgress: z.number(),
  timeScale: z.number(),
  paused: z.boolean(),
});
export type ClockSnapshot = z.infer<typeof clockSnapshotSchema>;

export const environmentSnapshotSchema = z.object({
  ambientTemperatureC: z.number(),
  /** Élévation solaire normalisée, -1 (minuit) .. 1 (zénith). */
  sunElevation: z.number(),
  isDaytime: z.boolean(),
  /** Saison dérivée de la progression annuelle — affichée par le client. */
  season: z.enum(['hiver', 'printemps', 'été', 'automne']),
  weather: z
    .object({
      region: z.object({ x: z.number().int(), z: z.number().int() }),
      kind: z.enum(['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow']),
      precipitation01: z.number().min(0).max(1),
      cloudCover01: z.number().min(0).max(1),
      humidity01: z.number().min(0).max(1),
      windMps: z.number().nonnegative(),
      visibility01: z.number().min(0).max(1),
      temperatureDeltaC: z.number(),
      periodIndex: z.number().int().nonnegative(),
      transition01: z.number().min(0).max(1),
    })
    .optional(),
});
export type EnvironmentSnapshot = z.infer<typeof environmentSnapshotSchema>;

/** Santé du cache de chunks côté serveur — affichée dans le panneau de debug. */
export const chunkStatsSchema = z.object({
  cached: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  generatedTotal: z.number().int().nonnegative(),
  averageGenerationMs: z.number(),
  lastGenerationMs: z.number(),
});
export type ChunkStats = z.infer<typeof chunkStatsSchema>;

export const simulationStatsSchema = z.object({
  tick: z.number().int().nonnegative(),
  entityCount: z.number().int().nonnegative(),
  humanCount: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  /** Durée moyenne d'un tick en millisecondes (fenêtre glissante). */
  averageTickMs: z.number(),
  lastTickMs: z.number(),
  /** Percentiles de durée de tick (ms) sur la même fenêtre — pas seulement la moyenne. */
  tickMsP50: z.number(),
  tickMsP95: z.number(),
  tickMsP99: z.number(),
  tickMsMax: z.number(),
  ticksPerSecond: z.number(),
  systems: z.array(
    z.object({
      name: z.string(),
      averageMs: z.number(),
      runs: z.number().int().nonnegative(),
    }),
  ),
});
export type SimulationStats = z.infer<typeof simulationStatsSchema>;
