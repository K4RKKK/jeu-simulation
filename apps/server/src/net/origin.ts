/**
 * Une origine est de confiance si elle figure explicitement dans la liste configurée,
 * ou si elle correspond exactement à l'hôte servant la requête (`Host`) — le cas normal
 * du client de production, servi par ce même Fastify : il ne doit jamais dépendre d'une
 * liste à maintenir à jour pour continuer à fonctionner sur lui-même.
 */
export function isTrustedOrigin(
  origin: string | undefined,
  requestHost: string | undefined,
  trustedOrigins: ReadonlySet<string>,
): boolean {
  if (!origin) return false;
  if (trustedOrigins.has(origin)) return true;
  if (!requestHost) return false;
  try {
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}
