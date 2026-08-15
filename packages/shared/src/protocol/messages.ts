import { z } from 'zod';
import { networkEventSchema } from './events.js';
import {
  chunkStatsSchema,
  clockSnapshotSchema,
  environmentSnapshotSchema,
  humanProfileSchema,
  humanStateSchema,
  simulationStatsSchema,
  worldDescriptorSchema,
} from './snapshot.js';
import {
  chunkCoordinateSchema,
  chunkPayloadSchema,
  worldGenerationMetadataSchema,
} from './world.js';

/* ------------------------------------------------------------------ */
/* Serveur → Client                                                    */
/* ------------------------------------------------------------------ */

/** Envoyé une fois à la connexion : tout ce qui décrit le monde statique. */
export const serverInitSchema = z.object({
  t: z.literal('init'),
  protocolVersion: z.number().int(),
  world: worldDescriptorSchema,
  /** Tables de contenu et paramètres du monde : le client n'en connaît aucun en dur. */
  generation: worldGenerationMetadataSchema,
  clock: clockSnapshotSchema,
  environment: environmentSnapshotSchema,
  /**
   * Point de départ de la séquence `snapshot`/`delta` pour CETTE session : le premier
   * message séquencé qui suit doit porter `sequenceNumber + 1`. Sans ceci, le tout
   * premier `delta` après connexion n'avait aucune référence à comparer — un message
   * perdu juste après l'`init` passait inaperçu.
   */
  sequenceNumber: z.number().int().nonnegative(),
  /** Historique majeur borné du monde, y compris pendant l'absence d'observateur. */
  history: z.array(networkEventSchema),
  profiles: z.array(humanProfileSchema),
  humans: z.array(humanStateSchema),
});

/** Un chunk généré, envoyé parce que le client a déclaré s'y intéresser. */
export const serverChunkSchema = z.object({
  t: z.literal('chunk'),
  chunk: chunkPayloadSchema,
});

/** Chunks sortis de la zone d'intérêt : le client peut libérer ses ressources graphiques. */
export const serverChunkUnloadSchema = z.object({
  t: z.literal('chunkUnload'),
  keys: z.array(z.string()),
});

/**
 * Resource Network Deltas.
 *
 * Une ressource est adressée par `(chunkKey, localId)`. `localId` est un entier 16 bits
 * stable pour une même (seed, generationVersion, coordonnée de chunk) : c'est l'index du
 * spawn dans la liste triée du `ResourceSpawner`, transmis avec le payload initial du
 * chunk. Bénéfice réseau : pas de chaîne `id` complète à chaque événement.
 *
 * Le serveur reste autoritaire. En cas de désynchronisation (saut de séquence détecté
 * côté client), le client peut demander un resync du chunk concerné.
 */
export const serverResourceUpdatedSchema = z.object({
  t: z.literal('resource:updated'),
  chunkKey: z.string(),
  localId: z.number().int().nonnegative(),
  sequenceNumber: z.number().int().nonnegative(),
  /**
   * Champs modifiés uniquement — pas l'état complet. Générique pour supporter
   * de futurs champs (harvestProgress, burnState, disease…) sans modifier le protocole.
   */
  changedFields: z.record(z.union([z.number(), z.string(), z.boolean()])),
  state: z.enum(['modified', 'depleted', 'removed']).optional(),
});

export const serverResourceAddedSchema = z.object({
  t: z.literal('resource:added'),
  chunkKey: z.string(),
  localId: z.number().int().nonnegative(),
  sequenceNumber: z.number().int().nonnegative(),
  /** Snapshot complet de la ressource ajoutée dynamiquement (ressource interactive). */
  fields: z.record(z.union([z.number(), z.string(), z.boolean()])),
});

export const serverResourceRemovedSchema = z.object({
  t: z.literal('resource:removed'),
  chunkKey: z.string(),
  localId: z.number().int().nonnegative(),
  sequenceNumber: z.number().int().nonnegative(),
});

/** Cellules de sentier dont l'usure visuelle a changé depuis la dernière diffusion. */
export const serverTrailUpdatedSchema = z.object({
  t: z.literal('trail:updated'),
  chunkKey: z.string(),
  resolution: z.number().int().positive(),
  cells: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      wear: z.number().int().min(0).max(255),
    }),
  ),
});

/** État complet. Envoyé à la connexion et périodiquement pour resynchroniser. */
export const serverSnapshotSchema = z.object({
  t: z.literal('snapshot'),
  /** Numéro de séquence croissant — le client détecte un saut = désync applicative. */
  sequenceNumber: z.number().int().nonnegative(),
  clock: clockSnapshotSchema,
  environment: environmentSnapshotSchema,
  /** Fiches de tous les humains présents dans la zone d'intérêt de cette session. */
  profiles: z.array(humanProfileSchema),
  humans: z.array(humanStateSchema),
});

/** Différence depuis le dernier message envoyé à CE client et dans sa zone d'intérêt. */
export const serverDeltaSchema = z.object({
  t: z.literal('delta'),
  /** Numéro de séquence : doit être exactement `snapshot.sequenceNumber + N` sans saut. */
  sequenceNumber: z.number().int().nonnegative(),
  clock: clockSnapshotSchema,
  environment: environmentSnapshotSchema,
  /** Nouveaux profils apparus depuis le dernier message (naissances, arrivées). */
  profiles: z.array(humanProfileSchema),
  /** Uniquement les humains dont l'état a changé. */
  humans: z.array(humanStateSchema),
  removed: z.array(z.number().int().positive()),
});

export const serverEventsSchema = z.object({
  t: z.literal('events'),
  events: z.array(networkEventSchema),
});

export const serverStatsSchema = z.object({
  t: z.literal('stats'),
  stats: simulationStatsSchema,
  clientCount: z.number().int().nonnegative(),
  chunks: chunkStatsSchema,
});

export const serverPongSchema = z.object({
  t: z.literal('pong'),
  /** Horodatage client renvoyé tel quel pour mesurer un aller-retour. */
  clientTime: z.number(),
});

export const serverErrorSchema = z.object({
  t: z.literal('error'),
  code: z.enum(['protocol_mismatch', 'bad_message', 'internal', 'forbidden']),
  message: z.string(),
});

export const serverMessageSchema = z.discriminatedUnion('t', [
  serverInitSchema,
  serverSnapshotSchema,
  serverDeltaSchema,
  serverChunkSchema,
  serverChunkUnloadSchema,
  serverResourceUpdatedSchema,
  serverResourceAddedSchema,
  serverResourceRemovedSchema,
  serverTrailUpdatedSchema,
  serverEventsSchema,
  serverStatsSchema,
  serverPongSchema,
  serverErrorSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type ServerInitMessage = z.infer<typeof serverInitSchema>;
export type ServerDeltaMessage = z.infer<typeof serverDeltaSchema>;
export type ServerSnapshotMessage = z.infer<typeof serverSnapshotSchema>;
export type ServerChunkMessage = z.infer<typeof serverChunkSchema>;
export type ServerResourceUpdatedMessage = z.infer<typeof serverResourceUpdatedSchema>;
export type ServerResourceAddedMessage = z.infer<typeof serverResourceAddedSchema>;
export type ServerResourceRemovedMessage = z.infer<typeof serverResourceRemovedSchema>;
export type ServerTrailUpdatedMessage = z.infer<typeof serverTrailUpdatedSchema>;

/* ------------------------------------------------------------------ */
/* Client → Serveur                                                    */
/* ------------------------------------------------------------------ */

export const clientHelloSchema = z.object({
  t: z.literal('hello'),
  protocolVersion: z.number().int(),
});

export const clientPingSchema = z.object({
  t: z.literal('ping'),
  clientTime: z.number(),
});

/**
 * Contrôles d'observation. Ce ne sont PAS des ordres de jeu : le client n'agit jamais sur
 * les humains, il ne fait que piloter la vitesse d'observation du monde.
 */
export const clientControlSchema = z.object({
  t: z.literal('control'),
  action: z.enum(['pause', 'resume', 'setTimeScale']),
  timeScale: z.number().positive().max(64).optional(),
});

/**
 * Zone du monde que l'observateur regarde.
 *
 * Le client ne *demande* pas des chunks nommés : il déclare où il se trouve, et le serveur
 * décide de ce qui est pertinent. C'est le serveur qui reste maître de ce qu'il divulgue,
 * et le client n'a pas à connaître les limites du monde pour éviter de réclamer le vide.
 */
export const clientChunkInterestSchema = z.object({
  t: z.literal('chunkInterest'),
  center: chunkCoordinateSchema,
  radius: z.number().int().nonnegative().max(16),
});

/**
 * Régénère le monde avec une nouvelle seed. Réservé au développement : le serveur refuse
 * cette requête si elle n'est pas explicitement autorisée par sa configuration.
 */
export const clientRegenerateSchema = z.object({
  t: z.literal('regenerate'),
  seed: z.string().min(1).max(64).optional(),
});

/**
 * Demande de resynchronisation : le client a détecté un saut dans la séquence des
 * `snapshot`/`delta` reçus (un message perdu en route) et signale que son miroir local
 * de l'état n'est plus fiable. Aucune donnée à joindre : le serveur sait déjà, via la
 * session WebSocket, de qui vient la demande — il répond en forçant un `snapshot`
 * complet à cette session précise dès la prochaine diffusion, sans attendre son tour.
 */
export const clientResyncSchema = z.object({
  t: z.literal('resync'),
});

export const clientMessageSchema = z.discriminatedUnion('t', [
  clientHelloSchema,
  clientPingSchema,
  clientControlSchema,
  clientChunkInterestSchema,
  clientRegenerateSchema,
  clientResyncSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

/* ------------------------------------------------------------------ */
/* Helpers de (dé)sérialisation                                        */
/* ------------------------------------------------------------------ */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseWith<T>(schema: z.ZodType<T>, raw: string): ParseResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  return { ok: true, value: parsed.data };
}

export function parseServerMessage(raw: string): ParseResult<ServerMessage> {
  return parseWith(serverMessageSchema, raw);
}

export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  return parseWith(clientMessageSchema, raw);
}

export function encodeMessage(message: ServerMessage | ClientMessage): string {
  return JSON.stringify(message);
}
