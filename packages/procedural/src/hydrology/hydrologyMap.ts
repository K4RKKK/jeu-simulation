import type { WaterBodyType } from '@civ/content';
import type { WorldGenerationConfig } from '../config/worldGenerationConfig.js';
import type { CoarseGrid } from './coarseGrid.js';
import type { RiverNetwork } from './riverNetwork.js';

/**
 * Une étendue d'eau identifiée.
 *
 * Les propriétés ne sont pas de simples constantes recopiées depuis le type : elles sont
 * modulées par la géométrie réelle (profondeur, surface, renouvellement). Un étang peu
 * profond et stagnant porte une charge pathogène nettement supérieure à celle d'un grand
 * lac, et une rivière reste la source la plus sûre. C'est la matière première de la future
 * décision « quelle eau boire ? ».
 */
export interface WaterBody {
  readonly id: string;
  readonly index: number;
  readonly type: WaterBodyType;
  readonly centerX: number;
  readonly centerZ: number;
  readonly areaM2: number;
  /** Volume en mètres cubes. */
  readonly volume: number;
  readonly meanDepthM: number;
  readonly maxDepthM: number;
  readonly surfaceHeightM: number;

  readonly contamination: number;
  readonly pathogenLoad: number;
  readonly turbidity: number;
  readonly temperatureC: number;
  /** Renouvellement effectif de l'eau, 0 = stagnante, 1 = fortement courante. */
  readonly flowRenewal: number;
  /** Profondeur en dessous de laquelle on traverse à pied. */
  readonly wadeableDepthM: number;
}

export interface WaterSample {
  readonly body: WaterBody;
  readonly surfaceHeightM: number;
  readonly depthM: number;
}

export interface HydrologyStats {
  readonly lakes: number;
  readonly ponds: number;
  readonly rivers: number;
  readonly springs: number;
  readonly waterCellRatio: number;
  /** Part de la surface du monde occupée par chaque type — sert au réglage. */
  readonly coverageByType: Readonly<Record<WaterBodyType, number>>;
}

export interface HydrologyMapData {
  grid: CoarseGrid;
  bodies: WaterBody[];
  /** Creusement du terrain, en altitude normalisée. */
  carve01: Float32Array;
  /** Surface de l'eau en altitude normalisée ; significative uniquement où `mask` vaut 1. */
  surface01: Float32Array;
  mask: Uint8Array;
  bodyIndex: Int32Array;
  distanceMeters: Float32Array;
  metersPerUnit: number;
  minMeters: number;
  stats: HydrologyStats;
  riverNetwork: RiverNetwork;
  hydrologyConfig: WorldGenerationConfig['hydrology'];
  sampleBase01: (x: number, z: number) => number;
}

/** En dessous de cette lame d'eau, on considère qu'il n'y a pas d'eau : évite les
 * flaques parasites nées de l'interpolation le long des rives. */
/**
 * Résultat interrogeable de la génération hydrologique.
 *
 * Une fois construite, cette carte rend la génération d'un chunk à nouveau purement locale :
 * il suffit de l'interroger point par point.
 */
export class HydrologyMap {
  readonly bodies: readonly WaterBody[];
  readonly stats: HydrologyStats;
  private readonly data: HydrologyMapData;

  constructor(data: HydrologyMapData) {
    this.data = data;
    this.bodies = data.bodies;
    this.stats = data.stats;
  }

  get grid(): CoarseGrid {
    return this.data.grid;
  }

  /** Creusement à appliquer au relief de base, en altitude normalisée. */
  carve01At(x: number, z: number): number {
    const rasterCarve = this.data.grid.sampleBilinear(this.data.carve01, x, z);
    const river = this.data.riverNetwork.sampleAt(x, z);
    if (!river) return rasterCarve;

    const config = this.data.hydrologyConfig;
    const edgeDistance = river.distanceMeters - river.halfWidthMeters;
    const base01 = this.data.sampleBase01(x, z);
    let riverCarve = 0;
    if (edgeDistance <= 0) {
      const centerRatio =
        river.halfWidthMeters > 0 ? 1 - river.distanceMeters / river.halfWidthMeters : 1;
      const edgeDepth01 = config.riverEdgeDepthMeters / this.data.metersPerUnit;
      const waterDepth01 =
        edgeDepth01 +
        Math.max(0, river.carveDepth01 * config.riverFillRatio - edgeDepth01) * centerRatio;
      // Le lit vise une altitude absolue : les détails fins du relief ne peuvent plus
      // couper le ruban d'eau entre deux cellules de drainage.
      riverCarve = Math.max(0, base01 - (river.surface01 - waterDepth01));
    } else {
      const blend = 1 - edgeDistance / config.riverBankBlendMeters;
      const requested = river.carveDepth01 * config.riverBankFalloff * Math.max(0, blend);
      // Une berge sèche reste au niveau ou au-dessus de l'eau voisine.
      riverCarve = Math.min(requested, Math.max(0, base01 - river.surface01));
    }
    return Math.max(rasterCarve, riverCarve);
  }

  /**
   * Eau présente à cette position, connaissant l'altitude du terrain déjà creusé.
   *
   * La surface est interpolée en ne pondérant que les cellules en eau : à l'intérieur d'un
   * lac elle reste rigoureusement plane, et elle se raccorde progressivement au rivage.
   */
  sampleWater(x: number, z: number, terrainHeightM: number): WaterSample | null {
    const river = this.data.riverNetwork.sampleAt(x, z);
    if (river && river.distanceMeters <= river.halfWidthMeters) {
      const body = this.bodies[river.bodyIndex];
      if (body) {
        const surfaceHeightM = this.data.minMeters + river.surface01 * this.data.metersPerUnit;
        const depthM = surfaceHeightM - terrainHeightM;
        if (depthM >= this.data.hydrologyConfig.minRenderedWaterDepthMeters) {
          return { body, surfaceHeightM, depthM };
        }
      }
    }

    const maskValue = this.data.grid.sampleBilinear(this.data.mask, x, z);
    if (maskValue < this.data.hydrologyConfig.standingWaterMaskThreshold) return null;

    const surface01 = this.data.grid.sampleMasked(this.data.surface01, this.data.mask, x, z);
    if (surface01 === null) return null;

    const surfaceHeightM = this.data.minMeters + surface01 * this.data.metersPerUnit;
    const depthM = surfaceHeightM - terrainHeightM;
    if (depthM < this.data.hydrologyConfig.minRenderedWaterDepthMeters) return null;

    const body = this.bodyAt(x, z);
    if (!body) return null;
    return { body, surfaceHeightM, depthM };
  }

  /** Étendue d'eau de la cellule la plus proche, si elle en porte une. */
  bodyAt(x: number, z: number): WaterBody | null {
    const river = this.data.riverNetwork.sampleAt(x, z);
    if (river && river.distanceMeters <= river.halfWidthMeters) {
      return this.bodies[river.bodyIndex] ?? null;
    }
    const index = this.data.bodyIndex[this.data.grid.indexAt(x, z)] ?? -1;
    if (index >= 0) return this.bodies[index] ?? null;

    // En bordure de rive, la cellule la plus proche peut être sèche : on prend la première
    // cellule en eau du voisinage immédiat plutôt que de nier la présence d'eau.
    const grid = this.data.grid;
    const column = grid.columnAt(x);
    const row = grid.rowAt(z);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nc = column + dc;
        const nr = row + dr;
        if (nc < 0 || nr < 0 || nc >= grid.width || nr >= grid.height) continue;
        const candidate = this.data.bodyIndex[grid.index(nc, nr)] ?? -1;
        if (candidate >= 0) return this.bodies[candidate] ?? null;
      }
    }
    return null;
  }

  /** Distance à l'eau la plus proche, en mètres. */
  distanceToWaterMeters(x: number, z: number): number {
    const rasterDistance = this.data.grid.sampleBilinear(this.data.distanceMeters, x, z);
    const river = this.data.riverNetwork.sampleAt(x, z);
    if (!river) return rasterDistance;
    return Math.min(rasterDistance, Math.max(0, river.distanceMeters - river.halfWidthMeters));
  }

  /** Proximité normalisée : 1 au bord de l'eau, 0 au-delà de `influenceMeters`. */
  waterProximity01(x: number, z: number, influenceMeters: number): number {
    if (influenceMeters <= 0) return 0;
    const distance = this.distanceToWaterMeters(x, z);
    const proximity = 1 - distance / influenceMeters;
    return proximity < 0 ? 0 : proximity > 1 ? 1 : proximity;
  }

  bodyById(id: string): WaterBody | undefined {
    return this.bodies.find((body) => body.id === id);
  }
}
