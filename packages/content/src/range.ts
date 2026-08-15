/**
 * Plage d'aptitude à bords doux.
 *
 * Employée partout où un contenu déclare « je préfère telles conditions » : biomes,
 * ressources, et plus tard plantes ou maladies. À l'intérieur de `[min, max]`
 * l'appartenance vaut 1 ; elle décroît linéairement sur `tolerance` puis vaut 0.
 *
 * Le bord doux n'est pas un détail esthétique : c'est lui qui empêche les frontières
 * rectilignes et les apparitions de ressources en damier.
 */
export interface SuitabilityRange {
  min: number;
  max: number;
  tolerance: number;
  /** Poids de cet axe quand plusieurs plages sont combinées. */
  weight?: number;
}

export function rangeMembership(value: number, range: SuitabilityRange): number {
  if (value >= range.min && value <= range.max) return 1;
  if (range.tolerance <= 0) return 0;
  const distance = value < range.min ? range.min - value : value - range.max;
  const membership = 1 - distance / range.tolerance;
  return membership < 0 ? 0 : membership;
}
