import type { HashDomain } from '../core/seedUtils.js';

/**
 * Coordonnée d'une région dans la grille macroscopique — mêmes conventions que
 * `ChunkCoordinate`/`chunkKey`, une échelle plus grande.
 *
 * C'est l'identité CANONIQUE d'une région : un futur système de météo l'utiliserait comme
 * clé d'état (« il pleut dans la région (3,-2) »). Ne pas confondre avec
 * `regionColorByte`, qui n'est qu'un hash de coloration pour le debug visuel — deux
 * régions distinctes peuvent y collisionner sans conséquence, alors que deux
 * `RegionCoordinate` distincts sont toujours des régions distinctes par construction
 * (un simple découpage en grille, jamais un hachage).
 */
export interface RegionCoordinate {
  readonly x: number;
  readonly z: number;
}

/** Clé stable `"x:z"` — même convention que `chunkKey`. */
export function regionKey(coord: RegionCoordinate): string {
  return `${coord.x}:${coord.z}`;
}

/**
 * Région contenant une position monde. Grille rectangulaire grossière — la fondation
 * (« couche 0 »), pas un découpage organique (Voronoi) : suffisant pour donner à chaque
 * grande zone du monde une identité discrète et adressable, ce qu'un champ de bruit
 * climatique continu ne peut pas offrir. Améliorable plus tard sans rien casser en aval,
 * `RegionCoordinate` restant l'identité stable quelle que soit la forme du découpage.
 */
export function regionAt(worldX: number, worldZ: number, regionSizeMeters: number): RegionCoordinate {
  return {
    x: Math.floor(worldX / regionSizeMeters),
    z: Math.floor(worldZ / regionSizeMeters),
  };
}

/**
 * Octet [0, 255] dérivé de `coord`, déterministe pour une seed donnée — sert uniquement à
 * colorer le calque de debug « Régions » côté client. Deux régions distinctes peuvent
 * partager le même octet (256 valeurs, un monde peut compter bien plus de régions) : ce
 * n'est PAS un identifiant unique, seulement une teinte de coloration. Rien dans cette
 * itération ne s'en sert pour de la logique de jeu.
 */
export function regionColorByte(coord: RegionCoordinate, hash: HashDomain): number {
  return hash.int(256, coord.x, coord.z);
}
