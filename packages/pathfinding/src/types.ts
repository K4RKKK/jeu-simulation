/** Coordonnée d'une tuile de la grille de navigation. */
export interface TileCoord {
  x: number;
  z: number;
}

/** Point du monde en mètres. */
export interface MetersPoint {
  x: number;
  z: number;
}

/**
 * Mémo de coûts d'un calcul : le terrain coûte cher à échantillonner, chaque tuile n'est
 * interrogée qu'une fois par recherche. La mémo appartient à la requête, jamais au monde :
 * pas de cache global qui pourrait être contaminé entre deux recherches.
 */
export type CostMemo = Map<string, number | null>;

/**
 * Fournit le coût d'entrée d'une tuile : `null` = infranchissable (falaise, eau trop
 * profonde, hors du monde). La simulation implémente ce contrat à partir du terrain
 * procédural ; le package ne connaît que des nombres.
 */
export interface TileCostProvider {
  tileCost(x: number, z: number, memo: CostMemo): number | null;
}

export function tileKey(tile: TileCoord): string {
  return `${tile.x},${tile.z}`;
}