/**
 * Interpolation réseau.
 *
 * Le serveur envoie ~10 messages par seconde, le client rend à 60 fps. Sans interpolation
 * les humains avanceraient par saccades. On affiche donc volontairement le passé récent :
 * une position à l'instant `now - renderDelay`, encadrée par deux états reçus.
 *
 * Ces fonctions sont pures et sans dépendance à Three.js : c'est ce qui les rend testables.
 */

const TAU = Math.PI * 2;

/**
 * Position temporelle entre deux échantillons, dans [0, 1].
 * Retourne 1 si les deux échantillons portent le même horodatage (rien à interpoler).
 */
export function computeAlpha(previousAt: number, currentAt: number, renderTime: number): number {
  const span = currentAt - previousAt;
  if (span <= 0) return 1;
  const alpha = (renderTime - previousAt) / span;
  return alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolation d'angle par le plus court chemin : évite un tour complet à ±PI. */
export function lerpAngle(a: number, b: number, t: number): number {
  let delta = (b - a) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return a + delta * t;
}
