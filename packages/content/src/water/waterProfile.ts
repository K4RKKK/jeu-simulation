import { Registry } from '../registry.js';

export type WaterBodyType = 'river' | 'lake' | 'pond' | 'spring';

/**
 * Profil d'un type de point d'eau.
 *
 * Les propriétés d'une étendue d'eau ne sont **pas** recopiées depuis ces constantes : le
 * générateur les module avec la géométrie réelle (profondeur, surface, renouvellement).
 * Sans cela, tous les étangs d'un monde seraient identiques, ce qui rendrait plus tard la
 * décision « quelle eau boire ? » sans intérêt.
 */
export interface WaterProfileDefinition {
  readonly id: WaterBodyType;
  readonly displayName: string;
  readonly color: string;
  readonly baseContamination: number;
  readonly basePathogenLoad: number;
  readonly baseTurbidity: number;
  /** Renouvellement de l'eau : 0 = stagnante, 1 = fortement courante. */
  readonly flowRenewal: number;
  /** Écart de température par rapport à l'air ambiant, en °C. */
  readonly temperatureOffsetC: number;
  /** Profondeur en dessous de laquelle l'eau est franchissable à pied. */
  readonly wadeableDepthM: number;
}

export const DEFAULT_WATER_PROFILES: readonly WaterProfileDefinition[] = [
  {
    id: 'river',
    displayName: 'Rivière',
    color: '#4a7f9e',
    baseContamination: 0.05,
    basePathogenLoad: 0.08,
    baseTurbidity: 0.18,
    flowRenewal: 0.85,
    temperatureOffsetC: -2,
    wadeableDepthM: 0.7,
  },
  {
    id: 'lake',
    displayName: 'Lac',
    color: '#3f6f92',
    baseContamination: 0.1,
    basePathogenLoad: 0.16,
    baseTurbidity: 0.22,
    flowRenewal: 0.3,
    temperatureOffsetC: -1,
    wadeableDepthM: 0.5,
  },
  {
    id: 'pond',
    displayName: 'Étang',
    color: '#4b6d5c',
    baseContamination: 0.2,
    basePathogenLoad: 0.38,
    baseTurbidity: 0.45,
    flowRenewal: 0.08,
    temperatureOffsetC: 1,
    wadeableDepthM: 0.6,
  },
  {
    id: 'spring',
    displayName: 'Source',
    color: '#5f9bb5',
    baseContamination: 0.01,
    basePathogenLoad: 0.02,
    baseTurbidity: 0.05,
    flowRenewal: 1,
    temperatureOffsetC: -4,
    wadeableDepthM: 0.4,
  },
];

export class WaterProfileRegistry extends Registry<WaterProfileDefinition> {
  constructor() {
    super('WaterProfileRegistry');
  }
}
