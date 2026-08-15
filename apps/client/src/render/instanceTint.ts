import * as THREE from 'three';

/**
 * Teinte visuelle d'une instance de ressource.
 *
 * Une forêt d'arbres tous identiques semble artificielle : chaque individu reçoit ici une
 * légère variation de luminosité et de chaleur, dérivée de sa rotation (valeur
 * déterministe produite par le serveur). Le rendu multiplie cette teinte par les couleurs
 * de la forme — rien n'est inventé, seule l'ambiance du feuillage varie.
 *
 * La fonction est une bijection stochastique de [0, 2π] : deux rotations différentes
 * donnent des teintes différentes, sans jamais sortir de la plage 0,85..1,15.
 */
export function instanceTint(rotationY: number): THREE.Color {
  const f = Math.sin(rotationY * 3.7 + 1.3);
  const luminance = 1 + f * 0.1;
  // Balance chromatique opposée à la luminance : un individu plus clair vire légèrement
  // au jaune, un plus sombre légèrement au bleu-vert.
  const warmth = 1 + f * 0.04;
  return new THREE.Color(luminance, luminance * warmth, luminance * (2 - warmth));
}
