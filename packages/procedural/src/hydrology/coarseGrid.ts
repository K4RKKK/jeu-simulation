/**
 * Grille régulière grossière couvrant tout le monde.
 *
 * L'hydrologie est le seul aspect de la génération qui ne peut pas être purement local :
 * savoir où l'eau s'accumule suppose de connaître le relief alentour. Cette grille est donc
 * calculée une fois à la création du monde, à une résolution volontairement basse (quelques
 * mètres par cellule). Elle reste petite — quelques dizaines de milliers de cellules — et
 * une fois construite, la génération d'un chunk redevient purement locale.
 *
 * Pour un monde beaucoup plus vaste, cette même grille serait produite par régions ; rien
 * dans les algorithmes ne suppose qu'elle couvre le monde entier.
 */
export class CoarseGrid {
  readonly width: number;
  readonly height: number;
  readonly cellCount: number;

  constructor(
    readonly originX: number,
    readonly originZ: number,
    readonly sizeMeters: number,
    readonly cellMeters: number,
  ) {
    this.width = Math.max(1, Math.ceil(sizeMeters / cellMeters));
    this.height = this.width;
    this.cellCount = this.width * this.height;
  }

  /** Indice de colonne/ligne, borné à la grille. */
  columnAt(x: number): number {
    const column = Math.floor((x - this.originX) / this.cellMeters);
    return column < 0 ? 0 : column >= this.width ? this.width - 1 : column;
  }

  rowAt(z: number): number {
    const row = Math.floor((z - this.originZ) / this.cellMeters);
    return row < 0 ? 0 : row >= this.height ? this.height - 1 : row;
  }

  index(column: number, row: number): number {
    return row * this.width + column;
  }

  indexAt(x: number, z: number): number {
    return this.index(this.columnAt(x), this.rowAt(z));
  }

  centerX(column: number): number {
    return this.originX + (column + 0.5) * this.cellMeters;
  }

  centerZ(row: number): number {
    return this.originZ + (row + 0.5) * this.cellMeters;
  }

  isBoundary(column: number, row: number): boolean {
    return column === 0 || row === 0 || column === this.width - 1 || row === this.height - 1;
  }

  /** Interpolation bilinéaire d'un champ défini au centre des cellules. */
  sampleBilinear(field: ArrayLike<number>, x: number, z: number): number {
    const { column, row, tx, tz } = this.bilinearWeights(x, z);
    const c1 = Math.min(column + 1, this.width - 1);
    const r1 = Math.min(row + 1, this.height - 1);

    const v00 = field[this.index(column, row)] ?? 0;
    const v10 = field[this.index(c1, row)] ?? 0;
    const v01 = field[this.index(column, r1)] ?? 0;
    const v11 = field[this.index(c1, r1)] ?? 0;

    const top = v00 + (v10 - v00) * tx;
    const bottom = v01 + (v11 - v01) * tx;
    return top + (bottom - top) * tz;
  }

  /**
   * Interpolation bilinéaire pondérée par un masque (convolution normalisée).
   *
   * Indispensable pour la surface d'un plan d'eau : une bilinéaire classique mélangerait
   * l'altitude du terrain sec voisin et ferait pencher la surface du lac. Ici seules les
   * cellules en eau contribuent, la surface reste donc parfaitement plane à l'intérieur du
   * plan d'eau et se raccorde en douceur au rivage.
   *
   * Retourne `null` si aucune cellule du voisinage n'est marquée.
   */
  sampleMasked(
    field: ArrayLike<number>,
    mask: ArrayLike<number>,
    x: number,
    z: number,
  ): number | null {
    const { column, row, tx, tz } = this.bilinearWeights(x, z);
    const c1 = Math.min(column + 1, this.width - 1);
    const r1 = Math.min(row + 1, this.height - 1);

    const corners: readonly [number, number][] = [
      [this.index(column, row), (1 - tx) * (1 - tz)],
      [this.index(c1, row), tx * (1 - tz)],
      [this.index(column, r1), (1 - tx) * tz],
      [this.index(c1, r1), tx * tz],
    ];

    let total = 0;
    let weightSum = 0;
    for (const [index, weight] of corners) {
      const m = mask[index] ?? 0;
      if (m <= 0) continue;
      const w = weight * m;
      total += (field[index] ?? 0) * w;
      weightSum += w;
    }
    return weightSum > 0 ? total / weightSum : null;
  }

  private bilinearWeights(
    x: number,
    z: number,
  ): { column: number; row: number; tx: number; tz: number } {
    // Les valeurs sont définies au centre des cellules : on décale d'une demi-cellule.
    const fx = (x - this.originX) / this.cellMeters - 0.5;
    const fz = (z - this.originZ) / this.cellMeters - 0.5;
    const column = Math.max(0, Math.min(this.width - 1, Math.floor(fx)));
    const row = Math.max(0, Math.min(this.height - 1, Math.floor(fz)));
    return {
      column,
      row,
      tx: Math.max(0, Math.min(1, fx - column)),
      tz: Math.max(0, Math.min(1, fz - row)),
    };
  }
}

/** Décalages des 8 voisins, dans un ordre fixe : l'ordre participe au déterminisme. */
export const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];
