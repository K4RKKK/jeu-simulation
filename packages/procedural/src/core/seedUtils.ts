/**
 * Déterminisme par hachage de coordonnées.
 *
 * La génération procédurale n'utilise **pas** de générateur séquentiel : elle hache une
 * position et un nom de domaine. La différence est structurante :
 *
 * - un générateur séquentiel impose de produire le monde dans un ordre fixe ; générer le
 *   chunk (5, 3) exigerait d'avoir généré les précédents ;
 * - un hachage de coordonnées rend chaque point indépendant. `generateChunk(x, z)` est
 *   alors une fonction pure, calculable dans n'importe quel ordre, sur n'importe quel
 *   thread, et rejouable des années plus tard.
 *
 * Le nom de domaine (`stream`) joue le rôle des streams du `WorldRng` : changer le nombre
 * d'arbres ne peut pas déplacer les rivières, puisque les deux hachent des domaines
 * différents.
 */

/** Hachage 32 bits d'une chaîne (FNV-1a). */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mélange final de type MurmurHash3 : casse les corrélations entre entiers voisins. */
export function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Combine une base (déjà hachée) avec des entiers de coordonnées.
 * Les coordonnées négatives sont acceptées : elles sont ramenées en non signé par `>>> 0`.
 */
export function hashCoords(base: number, ...coords: readonly number[]): number {
  let h = base >>> 0;
  for (const coord of coords) {
    h = mix32((h ^ (Math.trunc(coord) | 0)) >>> 0);
    h = Math.imul(h, 0x27d4eb2d) >>> 0;
  }
  return mix32(h);
}

/** Valeur dans [0, 1) dérivée d'un hachage. */
export function unitFromHash(hash: number): number {
  return (hash >>> 0) / 0x100000000;
}

/**
 * Domaine de hachage : une base pré-calculée pour un couple (seed, nom de domaine).
 * Pré-calculer la base évite de re-hacher la seed des centaines de milliers de fois.
 */
export class HashDomain {
  readonly base: number;

  constructor(
    readonly seed: string,
    readonly stream: string,
  ) {
    this.base = hashString(`${seed}::${stream}`);
  }

  hash(...coords: readonly number[]): number {
    return hashCoords(this.base, ...coords);
  }

  /** Valeur déterministe dans [0, 1) pour ces coordonnées. */
  unit(...coords: readonly number[]): number {
    return unitFromHash(this.hash(...coords));
  }

  /**
   * Plusieurs valeurs indépendantes pour la même position — position, rotation, échelle
   * d'un même arbre par exemple. `salt` distingue les tirages.
   */
  unitSalted(salt: number, ...coords: readonly number[]): number {
    return unitFromHash(mix32(this.hash(...coords) ^ Math.imul(salt + 1, 0x9e3779b1)));
  }

  /** Entier dans [0, bound). */
  int(bound: number, ...coords: readonly number[]): number {
    if (bound <= 0) throw new RangeError(`int() requires a positive bound, received ${bound}`);
    return Math.floor(this.unit(...coords) * bound) % bound;
  }
}

/**
 * Petite séquence déterministe, pour les rares cas où l'on tire *plusieurs* valeurs sans
 * coordonnée naturelle (choix d'un site de campement parmi N candidats, par exemple).
 * Chaque appel avance un compteur qui entre dans le hachage : la séquence est donc
 * reproductible et n'a besoin d'aucun état 128 bits.
 */
export class HashSequence {
  private counter = 0;

  constructor(private readonly domain: HashDomain) {}

  next(): number {
    return this.domain.unit(this.counter++);
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}
