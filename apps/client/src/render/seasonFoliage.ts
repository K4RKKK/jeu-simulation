import * as THREE from 'three';
import type { EnvironmentSnapshot } from '@civ/shared';

export type Season = EnvironmentSnapshot['season'];

const IDENTITY = new THREE.Color(1, 1, 1);

/**
 * Teintes saisonnières du feuillage caduc, en multiplicateur des couleurs de la forme.
 *
 * Été = identité (la définition contient la couleur d'été). Le printemps éclaircit et
 * jaunit, l'automne bascule vers le roux (le vert devient orange par multiplication des
 * canaux), l'hiver assombrit et désature : un arbre décidu semble dépouillé. Les
 * conifères, eux, ne changent jamais.
 */
const SEASONAL_TINTS: Readonly<Record<Season, THREE.Color>> = {
  printemps: new THREE.Color(1.12, 1.02, 0.84),
  été: IDENTITY,
  automne: new THREE.Color(1.5, 0.64, 0.28),
  hiver: new THREE.Color(0.55, 0.52, 0.45),
};

export function seasonFoliageTint(season: Season, deciduous: boolean): THREE.Color {
  if (!deciduous) return IDENTITY;
  return SEASONAL_TINTS[season] ?? IDENTITY;
}
