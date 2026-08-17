/**
 * Une origine est de confiance uniquement si elle figure dans la liste FIXE configurée
 * (`ServerConfig.trustedOrigins`, calculée une fois au démarrage — voir sa doc).
 *
 * Volontairement PAS de repli « correspond à l'en-tête `Host` de la requête » : ce
 * dernier est choisi par le navigateur d'après l'URL visitée, donc falsifiable par un
 * DNS rebinding — comparer `Origin` à `Host` reviendrait à demander à l'attaquant de
 * confirmer sa propre requête.
 */
export function isTrustedOrigin(
  origin: string | undefined,
  trustedOrigins: ReadonlySet<string>,
): boolean {
  if (!origin) return false;
  return trustedOrigins.has(origin);
}
