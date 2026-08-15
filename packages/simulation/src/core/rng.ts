/**
 * Générateur pseudo-aléatoire déterministe du monde (CLAUDE.md règle 4).
 *
 * Le point important n'est pas l'algorithme mais le **cloisonnement en streams** : chaque
 * domaine tire dans sa propre séquence, dérivée de `hash(seed + ':' + streamName)`.
 * Conséquence recherchée : ajouter un tirage dans le comportement des humains ne décale
 * pas la génération du terrain, et une même seed produit toujours le même monde même si
 * de nouveaux systèmes consomment de l'aléatoire.
 */

const UINT32 = 0x100000000;

/** cyrb128 — dérive 4 mots de 32 bits à partir d'une chaîne. */
function hashSeed(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
    // Les quatre valeurs ne peuvent pas être toutes nulles : h1 est mélangé partout.
  ];
}

export type RandomStreamState = readonly [number, number, number, number];

/**
 * Une séquence pseudo-aléatoire indépendante et sérialisable.
 * Algorithme sfc32 : rapide, période très longue, état de 128 bits entiers — donc
 * reproductible à l'identique sur toutes les plateformes (aucun flottant dans l'état).
 */
export class RandomStream {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(
    readonly name: string,
    state: RandomStreamState,
  ) {
    this.a = state[0] >>> 0;
    this.b = state[1] >>> 0;
    this.c = state[2] >>> 0;
    this.d = state[3] >>> 0;
  }

  static fromSeed(seed: string, streamName: string): RandomStream {
    return new RandomStream(streamName, hashSeed(`${seed}::${streamName}`));
  }

  /** Entier non signé 32 bits. Primitive dont tout le reste dérive. */
  nextUint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Flottant dans [0, 1). */
  float(): number {
    return this.nextUint32() / UINT32;
  }

  /** Flottant dans [min, max). */
  range(min: number, max: number): number {
    return min + this.float() * (max - min);
  }

  /** Entier dans [min, max] inclus. */
  int(min: number, max: number): number {
    if (max < min) throw new RangeError(`int(${min}, ${max}): max < min`);
    return min + Math.floor(this.float() * (max - min + 1));
  }

  bool(probability = 0.5): boolean {
    return this.float() < probability;
  }

  /** Tirage gaussien (Box-Muller). Le second échantillon est volontairement jeté pour
   * garder l'état du stream entièrement contenu dans les 128 bits sérialisés. */
  gaussian(mean = 0, standardDeviation = 1): number {
    let u = this.float();
    while (u === 0) u = this.float(); // log(0) interdit
    const v = this.float();
    return mean + standardDeviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Gaussienne bornée : utile pour des grandeurs physiques (taille, masse…). */
  clampedGaussian(mean: number, standardDeviation: number, min: number, max: number): number {
    const value = this.gaussian(mean, standardDeviation);
    return value < min ? min : value > max ? max : value;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick() on an empty array');
    const item = items[this.int(0, items.length - 1)];
    // `noUncheckedIndexedAccess` : l'index est borné, mais on reste explicite.
    if (item === undefined) throw new RangeError('pick() produced an out-of-range index');
    return item;
  }

  /** Mélange en place (Fisher-Yates). */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const a = items[i] as T;
      const b = items[j] as T;
      items[i] = b;
      items[j] = a;
    }
    return items;
  }

  /**
   * Crée un sous-stream déterministe dérivé de l'état courant.
   * Utile pour donner à une entité sa propre séquence stable (ex. `fork('human:42')`).
   */
  fork(label: string): RandomStream {
    const key = `${this.name}::${label}::${this.a}:${this.b}:${this.c}:${this.d}`;
    return new RandomStream(`${this.name}/${label}`, hashSeed(key));
  }

  getState(): RandomStreamState {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }

  setState(state: RandomStreamState): void {
    this.a = state[0] >>> 0;
    this.b = state[1] >>> 0;
    this.c = state[2] >>> 0;
    this.d = state[3] >>> 0;
  }
}

/** Domaines de tirage. Ajouter un domaine ici plutôt que de réutiliser un stream voisin. */
export const RNG_STREAMS = [
  'worldGeneration',
  'humans',
  'behavior',
  'metabolism',
  'discovery',
  'disease',
  'language',
] as const;

export type RngStreamName = (typeof RNG_STREAMS)[number];

export type WorldRngState = Record<RngStreamName, RandomStreamState>;

export class WorldRng {
  private readonly streams: Map<RngStreamName, RandomStream>;

  constructor(readonly seed: string) {
    this.streams = new Map(
      RNG_STREAMS.map((name) => [name, RandomStream.fromSeed(seed, name)] as const),
    );
  }

  stream(name: RngStreamName): RandomStream {
    const stream = this.streams.get(name);
    if (!stream) throw new Error(`Unknown RNG stream: ${name}`);
    return stream;
  }

  get worldGeneration(): RandomStream {
    return this.stream('worldGeneration');
  }
  get humans(): RandomStream {
    return this.stream('humans');
  }
  get behavior(): RandomStream {
    return this.stream('behavior');
  }
  get metabolism(): RandomStream {
    return this.stream('metabolism');
  }
  get discovery(): RandomStream {
    return this.stream('discovery');
  }
  get disease(): RandomStream {
    return this.stream('disease');
  }
  get language(): RandomStream {
    return this.stream('language');
  }

  /** Sérialisation complète — prérequis pour sauvegarder/restaurer un monde. */
  getState(): WorldRngState {
    const state = {} as WorldRngState;
    for (const name of RNG_STREAMS) {
      state[name] = this.stream(name).getState();
    }
    return state;
  }

  setState(state: WorldRngState): void {
    for (const name of RNG_STREAMS) {
      this.stream(name).setState(state[name]);
    }
  }
}
