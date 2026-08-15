/**
 * Variante de forme d'une instance de ressource.
 *
 * La rotation d'une instance (déterministe côté serveur) désigne sa variante : même seed,
 * mêmes variantes. La répartition est uniforme par construction, sans ajouter aucun octet
 * au protocole.
 */
export function variantForRotation(rotationY: number, variantCount: number): number {
  if (variantCount <= 1) return 0;
  const index = Math.floor((rotationY / (Math.PI * 2)) * variantCount);
  return Math.min(variantCount - 1, Math.max(0, index));
}
