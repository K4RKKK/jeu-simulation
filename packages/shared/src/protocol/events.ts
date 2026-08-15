import { z } from 'zod';

/**
 * Événements de simulation transportés vers le client.
 *
 * Le contrat réseau est volontairement plus pauvre que le bus interne : le client reçoit
 * un événement « aplati » (type + tick + entité concernée + description), suffisant pour
 * un journal, un historique et un futur mode replay, sans coupler l'UI à la forme exacte
 * des payloads internes du moteur.
 */
export const networkEventSchema = z.object({
  type: z.string(),
  tick: z.number().int().nonnegative(),
  /** Date de jeu au moment exact de l'événement, calculée par le serveur. */
  year: z.number().int().positive(),
  day: z.number().int().positive(),
  hour: z.number().int().nonnegative(),
  minute: z.number().int().min(0).max(59),
  entityId: z.number().int().nonnegative().nullable(),
  /** Résumé lisible, déjà formaté par le serveur. */
  message: z.string(),
});

export type NetworkEvent = z.infer<typeof networkEventSchema>;
