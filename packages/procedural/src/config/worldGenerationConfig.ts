/**
 * Configuration de génération du monde.
 *
 * Séparée de `SimulationConfig` : celle-ci règle **comment le monde est fabriqué**, celle-là
 * **comment il se comporte**. Deux mondes peuvent partager les règles de simulation et
 * différer entièrement par leur génération.
 *
 * Aucune de ces valeurs ne doit être recopiée en dur ailleurs (CLAUDE.md règle 5).
 */

export interface WorldLayoutConfig {
  /** Côté du monde en chunks. Le monde est carré et centré sur l'origine. */
  sizeChunks: number;
  chunkSizeMeters: number;
  /** Segments par côté du maillage d'un chunk : `resolution + 1` sommets par côté. */
  terrainResolution: number;
  /**
   * Pas de la grille d'échantillonnage interne, en mètres.
   *
   * Les champs du terrain sont évalués une fois sur cette grille, puis réutilisés par le
   * maillage et par le placement des ressources. Sans cette mutualisation, générer un chunk
   * demanderait plusieurs milliers d'évaluations de bruit redondantes. Doit diviser à la
   * fois la taille du chunk et le pas du maillage.
   */
  sampleLatticeMeters: number;
}

export interface NoiseLayerConfig {
  scaleMeters: number;
  octaves: number;
  weight: number;
}

export interface ElevationConfig {
  minMeters: number;
  maxMeters: number;
  continental: NoiseLayerConfig;
  regional: NoiseLayerConfig;
  local: NoiseLayerConfig;
  detail: NoiseLayerConfig;
  /** Déformation du domaine : casse les motifs trop réguliers du bruit. */
  warpScaleMeters: number;
  warpStrengthMeters: number;
  /** Étire l'histogramme autour de 0,5 : sans cela tout le monde est à mi-hauteur. */
  contrast: number;
  /** En dessous de ce niveau, le relief reste plat (plaines et fonds de vallée). */
  lowlandCeiling01: number;
  /** Exposant appliqué au-dessus de `lowlandCeiling01` : > 1 accentue les hauteurs. */
  reliefExponent: number;
  /** Crêtes rocheuses : altitude à partir de laquelle elles apparaissent, et leur force. */
  ridgeStart01: number;
  ridgeStrength: number;
  ridgeScaleMeters: number;
  /** Distance d'échantillonnage utilisée pour dériver la pente, en mètres. */
  slopeSampleMeters: number;
  /** Pente (m/m) correspondant à une valeur normalisée de 1. */
  slopeNormalizationMeters: number;
}

export interface TemperatureConfig {
  scaleMeters: number;
  octaves: number;
  /** Amplitude du bruit autour de la moyenne. */
  amplitude: number;
  mean: number;
  /** Refroidissement par unité d'altitude normalisée au-dessus du niveau de l'eau. */
  lapseRate: number;
}

export interface MoistureConfig {
  scaleMeters: number;
  octaves: number;
  amplitude: number;
  mean: number;
  /** Apport d'humidité au bord de l'eau. */
  waterBonus: number;
  /** Distance au-delà de laquelle l'eau n'humidifie plus, en mètres. */
  waterInfluenceMeters: number;
  /** Assèchement par unité d'altitude normalisée. */
  altitudeDrying: number;
}

export interface DerivedFieldConfig {
  scaleMeters: number;
  octaves: number;
  noiseWeight: number;
}

export interface FertilityConfig extends DerivedFieldConfig {
  moistureWeight: number;
  temperatureWeight: number;
  /** Température idéale pour la végétation, en valeur normalisée. */
  idealTemperature: number;
  temperatureTolerance: number;
  slopePenalty: number;
  rockinessPenalty: number;
}

export interface RockinessConfig extends DerivedFieldConfig {
  slopeWeight: number;
  altitudeWeight: number;
  moisturePenalty: number;
}

export interface VegetationConfig extends DerivedFieldConfig {
  fertilityWeight: number;
  moistureWeight: number;
  slopePenalty: number;
  rockinessPenalty: number;
}

export interface HydrologyConfig {
  /** Côté d'une cellule de la grille hydrologique grossière, en mètres. */
  coarseCellMeters: number;
  /** Niveau de l'eau en altitude normalisée : tout ce qui est en dessous est immergé. */
  waterLevel01: number;
  /** Surface minimale, en cellules, pour qu'une dépression compte comme étang puis lac. */
  minPondCells: number;
  minLakeCells: number;
  /**
   * Profondeur moyenne minimale d'une eau stagnante.
   *
   * Sans ce filtre, chaque micro-cuvette du bruit devient un étang et le monde se couvre de
   * flaques : c'est une conséquence directe du remplissage des dépressions, qui repère
   * jusqu'aux creux de quelques centimètres.
   */
  minStandingDepthMeters: number;
  /**
   * Altitude normalisée maximale d'une surface d'eau dormante.
   *
   * Le remplissage des dépressions repère aussi les cuvettes perchées, qui deviendraient
   * d'immenses lacs d'altitude. À l'échelle de temps du monde, l'érosion a entaillé leur
   * seuil : au-dessus de cette altitude, l'eau s'écoule au lieu de s'accumuler.
   */
  maxStandingSurface01: number;
  /** Accumulation d'écoulement à partir de laquelle une cellule devient rivière. */
  riverAccumulationThreshold: number;
  /**
   * Accumulation minimale d'une cellule **amont d'une rivière** pour être absorbée dans
   * son cours. Une fois qu'un écoulement est établi, il faut un seuil bien plus bas pour
   * le continuer : sans cela, l'accumulation oscillant autour du seuil principal éparpille
   * les rivières en segments isolés et en sources de deux cellules.
   */
  riverContinuationRatio: number;
  /** Taille minimale d'un cours d'eau, en cellules : en dessous, le lit est creusé mais sec. */
  minRiverCells: number;
  /** Taille minimale d'une source : les têtes plus petites se fondent dans la rivière. */
  minSpringCells: number;
  minRiverWidthMeters: number;
  maxRiverWidthMeters: number;
  /** Pas maximal entre deux points de la ligne centrale lissée. */
  riverCenterlineSampleMeters: number;
  /** Nombre de passes de lissage de la trajectoire, sans déplacer sources ni confluences. */
  riverCenterlineSmoothingPasses: number;
  /** Taille des cases de l'index spatial utilisé par les requêtes point par point. */
  riverSpatialIndexCellMeters: number;
  /** Accumulation correspondant à la largeur maximale. */
  riverFullWidthAccumulation: number;
  /** Profondeur de creusement du lit, en altitude normalisée. */
  riverCarveDepth01: number;
  /**
   * Part de la profondeur du lit effectivement occupée par l'eau ; le reste forme les berges.
   * La surface de l'eau doit rester sous les berges voisines (cf. `riverBankFalloff`).
   */
  riverFillRatio: number;
  /**
   * Atténuation du creusement à chaque cellule d'éloignement du lit.
   *
   * Elle doit rester inférieure à `1 - riverFillRatio` : sinon les berges, creusées plus
   * profond que la surface de l'eau, sont inondées par le maillage d'eau et donnent une eau
   * qui semble flotter au-dessus du sol.
   */
  riverBankFalloff: number;
  /** Largeur du raccord entre le lit creusé et le terrain environnant, en mètres. */
  riverBankBlendMeters: number;
  /** Profondeur minimale conservée au bord mouillé d'une rivière. */
  riverEdgeDepthMeters: number;
  /** Lame d'eau minimale reconnue par l'échantillonnage et le rendu. */
  minRenderedWaterDepthMeters: number;
  /** Seuil du masque interpolé réservé aux lacs et étangs. */
  standingWaterMaskThreshold: number;
  /** Profondeur d'eau au-delà de laquelle un lac n'est plus franchissable, en mètres. */
  wadeableDepthMeters: number;
  /**
   * Marge de creusement garantie sous la surface d'un plan d'eau STAGNANT (lac, étang),
   * en mètres — contrairement au lit d'une rivière (`riverCarveDepth01`), rien ne
   * creusait jusqu'ici le terrain fin sous un lac : sa présence dépendait entièrement de
   * la cuvette que le bruit du relief formait par hasard à la résolution grossière de la
   * grille hydrologique (`coarseCellMeters`). Comme le maillage de terrain fin (résolu à
   * `sampleLatticeMeters`) porte son propre détail à plus haute fréquence que cette
   * grille, le sol pouvait localement remonter au-dessus du niveau d'eau calculé — d'où
   * une eau qui semble posée sur le terrain plutôt que nichée dedans. Cette marge est
   * soustraite du terrain sur tout plan d'eau stagnant, avec le même raccord progressif
   * (`smoothCarve`) que les berges de rivière, pour garantir un bassin visuellement
   * cohérent quelle que soit la variation fine du bruit.
   */
  standingWaterCarveMarginMeters: number;
}

export interface ResourceGenerationConfig {
  /** Multiplicateur global : un seul levier pour densifier ou vider le monde. */
  globalDensity: number;
  /** Nombre maximum de ressources retenues par chunk, garde-fou anti-explosion. */
  maxPerChunk: number;
  /**
   * Fraction de la cellule dans laquelle un individu peut se décaler, dans [0, 1].
   * Plus la valeur est basse, plus l'espacement minimal réel est proche de la cellule ;
   * plus elle est haute, plus la répartition paraît naturelle. C'est le compromis entre
   * « rangé en grille » et « troncs qui se chevauchent ».
   */
  jitterRatio: number;
}

export interface WalkabilityConfig {
  maxSlope01: number;
  maxWaterDepthMeters: number;
}

export interface SpawnSearchConfig {
  /** Nombre de sites candidats évalués pour le campement initial. */
  candidateCount: number;
  maxSlope01: number;
  /** Fenêtre de distance à l'eau jugée viable, en mètres. */
  idealWaterDistanceMinMeters: number;
  idealWaterDistanceMaxMeters: number;
  /** Rayon dans lequel le site doit rester majoritairement praticable. */
  clearanceRadiusMeters: number;
  clearanceSamples: number;
}

/**
 * Découpage du monde en régions — grille macroscopique bien plus grossière que les chunks
 * (voir `regions/regionGrid.ts`). Fondation pour une future variation climatique/météo par
 * zone, sans effet de jeu à ce stade.
 */
export interface RegionLayoutConfig {
  /** Côté d'une région, en nombre de chunks. */
  sizeChunks: number;
}

export interface WorldGenerationConfig {
  seed: string;
  /**
   * Version de l'algorithme de génération. Une sauvegarde doit savoir avec quelle version
   * elle a été produite : changer la génération sans changer cette valeur rendrait un monde
   * sauvegardé incohérent avec sa propre seed.
   */
  generationVersion: string;

  layout: WorldLayoutConfig;
  regions: RegionLayoutConfig;
  elevation: ElevationConfig;
  temperature: TemperatureConfig;
  moisture: MoistureConfig;
  fertility: FertilityConfig;
  rockiness: RockinessConfig;
  vegetation: VegetationConfig;
  hydrology: HydrologyConfig;
  resources: ResourceGenerationConfig;
  walkability: WalkabilityConfig;
  spawn: SpawnSearchConfig;
}

export const WORLD_GENERATION_VERSION = 'worldgen-v3';

export const DEFAULT_WORLD_GENERATION_CONFIG: WorldGenerationConfig = {
  seed: 'prehistory-01',
  generationVersion: WORLD_GENERATION_VERSION,

  layout: {
    sizeChunks: 24,
    chunkSizeMeters: 64,
    terrainResolution: 32,
    sampleLatticeMeters: 2,
  },

  // 6 chunks de côté (384 m avec chunkSizeMeters=64) : ~4×4 régions sur le monde par
  // défaut de 24 chunks — assez grossier pour qu'une future météo régionale se distingue
  // clairement du bruit climatique continu déjà existant.
  regions: {
    sizeChunks: 6,
  },

  elevation: {
    // Le niveau de l'eau (0,32) tombe ainsi autour de y = 0 : les altitudes lues restent
    // intuitives, les fonds de lac sont négatifs et les crêtes montent à ~66 m.
    minMeters: -30,
    maxMeters: 66,
    continental: { scaleMeters: 1500, octaves: 2, weight: 0.5 },
    regional: { scaleMeters: 380, octaves: 3, weight: 0.28 },
    local: { scaleMeters: 95, octaves: 3, weight: 0.15 },
    detail: { scaleMeters: 28, octaves: 2, weight: 0.07 },
    warpScaleMeters: 240,
    warpStrengthMeters: 46,
    contrast: 1.45,
    lowlandCeiling01: 0.46,
    reliefExponent: 1.65,
    ridgeStart01: 0.62,
    ridgeStrength: 0.16,
    ridgeScaleMeters: 210,
    slopeSampleMeters: 3,
    slopeNormalizationMeters: 1.1,
  },

  temperature: {
    scaleMeters: 900,
    octaves: 2,
    amplitude: 0.3,
    mean: 0.58,
    lapseRate: 0.55,
  },

  moisture: {
    scaleMeters: 520,
    octaves: 3,
    amplitude: 0.34,
    mean: 0.46,
    waterBonus: 0.32,
    waterInfluenceMeters: 45,
    altitudeDrying: 0.3,
  },

  fertility: {
    scaleMeters: 160,
    octaves: 2,
    noiseWeight: 0.14,
    moistureWeight: 0.46,
    temperatureWeight: 0.26,
    idealTemperature: 0.62,
    temperatureTolerance: 0.3,
    slopePenalty: 0.32,
    rockinessPenalty: 0.3,
  },

  rockiness: {
    scaleMeters: 130,
    octaves: 3,
    noiseWeight: 0.3,
    slopeWeight: 0.54,
    altitudeWeight: 0.28,
    moisturePenalty: 0.2,
  },

  vegetation: {
    scaleMeters: 110,
    octaves: 2,
    noiseWeight: 0.2,
    fertilityWeight: 0.6,
    moistureWeight: 0.28,
    slopePenalty: 0.3,
    rockinessPenalty: 0.28,
  },

  hydrology: {
    coarseCellMeters: 6,
    waterLevel01: 0.25,
    minPondCells: 10,
    minLakeCells: 80,
    minStandingDepthMeters: 0.35,
    maxStandingSurface01: 0.33,
    riverAccumulationThreshold: 420,
    riverContinuationRatio: 0.55,
    minRiverCells: 4,
    minSpringCells: 2,
    minRiverWidthMeters: 4,
    maxRiverWidthMeters: 9,
    riverCenterlineSampleMeters: 2,
    riverCenterlineSmoothingPasses: 3,
    riverSpatialIndexCellMeters: 18,
    riverFullWidthAccumulation: 3000,
    riverCarveDepth01: 0.014,
    riverFillRatio: 0.62,
    // Doit rester < 1 - riverFillRatio (0.38) — voir la doc du champ. 0.5 violait cette
    // invariante : les berges, creusées plus profond que la surface de l'eau voisine,
    // étaient inondées par le maillage d'eau, qui semblait alors flotter au-dessus du sol
    // au lieu d'être nichée dans son lit.
    riverBankFalloff: 0.3,
    riverBankBlendMeters: 13,
    riverEdgeDepthMeters: 0.12,
    minRenderedWaterDepthMeters: 0.05,
    standingWaterMaskThreshold: 0.25,
    wadeableDepthMeters: 0.6,
    standingWaterCarveMarginMeters: 1.2,
  },

  resources: {
    globalDensity: 1,
    maxPerChunk: 700,
    jitterRatio: 0.6,
  },

  walkability: {
    maxSlope01: 0.55,
    maxWaterDepthMeters: 0.6,
  },

  spawn: {
    candidateCount: 160,
    maxSlope01: 0.16,
    idealWaterDistanceMinMeters: 18,
    idealWaterDistanceMaxMeters: 95,
    clearanceRadiusMeters: 18,
    clearanceSamples: 12,
  },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type WorldGenerationOverrides = DeepPartial<WorldGenerationConfig>;

function merge<T extends object>(base: T, override: DeepPartial<T> | undefined): T {
  if (!override) return { ...base };
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const value = override[key];
    if (value === undefined) continue;
    const current = base[key];
    if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
      result[key] = merge(current as unknown as object, value as DeepPartial<object>) as T[keyof T];
    } else {
      result[key] = value as T[keyof T];
    }
  }
  return result;
}

export function createWorldGenerationConfig(
  overrides: WorldGenerationOverrides = {},
): WorldGenerationConfig {
  return merge(DEFAULT_WORLD_GENERATION_CONFIG, overrides);
}

/** Côté du monde en mètres, dérivé de la disposition. */
export function worldSizeMeters(config: WorldGenerationConfig): number {
  return config.layout.sizeChunks * config.layout.chunkSizeMeters;
}
