import { hashString, mix32 } from './seedUtils.js';

/**
 * Bruit simplex 2D déterministe.
 *
 * Le bruit est **toujours échantillonné en coordonnées monde**. C'est la règle qui garantit
 * la continuité entre chunks : deux chunks voisins interrogent la même fonction continue,
 * il n'y a donc aucune couture à recoller. Réinitialiser le bruit par chunk produirait des
 * motifs répétés et des discontinuités visibles.
 */

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const GRADIENTS: readonly (readonly [number, number])[] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export interface FbmOptions {
  /** Longueur d'onde de la première octave, en mètres. */
  scaleMeters: number;
  octaves: number;
  /** Facteur multiplicatif de fréquence entre octaves. */
  lacunarity?: number;
  /** Facteur multiplicatif d'amplitude entre octaves. */
  gain?: number;
  /** Transforme le bruit en crêtes : utile pour des reliefs de type arête. */
  ridged?: boolean;
}

export class Noise2D {
  private readonly permutation: Uint8Array;

  constructor(seed: string, stream: string) {
    this.permutation = buildPermutation(hashString(`${seed}::noise::${stream}`));
  }

  /** Bruit brut dans [-1, 1]. */
  sample(x: number, y: number): number {
    const perm = this.permutation;

    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);

    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let total = 0;
    total += corner(x0, y0, perm[(ii + perm[jj]!) & 255]! & 7);
    total += corner(x1, y1, perm[(ii + i1 + perm[(jj + j1) & 255]!) & 255]! & 7);
    total += corner(x2, y2, perm[(ii + 1 + perm[(jj + 1) & 255]!) & 255]! & 7);

    // 70 : facteur de normalisation usuel du simplex 2D, ramène l'amplitude dans [-1, 1].
    return 70 * total;
  }

  /** Bruit fractal (somme d'octaves) dans [-1, 1]. */
  fbm(x: number, y: number, options: FbmOptions): number {
    const lacunarity = options.lacunarity ?? 2;
    const gain = options.gain ?? 0.5;

    let frequency = 1 / options.scaleMeters;
    let amplitude = 1;
    let total = 0;
    let normalization = 0;

    for (let octave = 0; octave < options.octaves; octave++) {
      const raw = this.sample(x * frequency, y * frequency);
      const value = options.ridged ? 1 - 2 * Math.abs(raw) : raw;
      total += value * amplitude;
      normalization += amplitude;
      frequency *= lacunarity;
      amplitude *= gain;
    }

    return normalization === 0 ? 0 : total / normalization;
  }

  /** Bruit fractal ramené dans [0, 1]. */
  fbm01(x: number, y: number, options: FbmOptions): number {
    return this.fbm(x, y, options) * 0.5 + 0.5;
  }
}

/**
 * Fournisseur de bruits nommés.
 *
 * Chaque domaine possède sa propre permutation : ajouter un champ de bruit ne décale aucun
 * des champs existants, et deux champs différents ne se ressemblent jamais.
 */
export class NoiseProvider {
  private readonly cache = new Map<string, Noise2D>();

  constructor(readonly seed: string) {}

  get(stream: string): Noise2D {
    let noise = this.cache.get(stream);
    if (!noise) {
      noise = new Noise2D(this.seed, stream);
      this.cache.set(stream, noise);
    }
    return noise;
  }
}

function corner(x: number, y: number, gradientIndex: number): number {
  const t = 0.5 - x * x - y * y;
  if (t < 0) return 0;
  const gradient = GRADIENTS[gradientIndex] as readonly [number, number];
  const t2 = t * t;
  return t2 * t2 * (gradient[0] * x + gradient[1] * y);
}

/** Permutation de Fisher-Yates pilotée par un hachage : reproductible sur toute plateforme. */
function buildPermutation(seed: number): Uint8Array {
  const permutation = new Uint8Array(256);
  for (let i = 0; i < 256; i++) permutation[i] = i;

  let state = seed >>> 0;
  for (let i = 255; i > 0; i--) {
    state = mix32(state + 0x9e3779b9);
    const j = state % (i + 1);
    const a = permutation[i] as number;
    permutation[i] = permutation[j] as number;
    permutation[j] = a;
  }
  return permutation;
}
