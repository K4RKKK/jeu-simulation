import * as THREE from 'three';
import type { DecodedTerrain, WorldGenerationMetadata } from '@civ/shared';

/**
 * Calques de visualisation du terrain.
 *
 * `natural` affiche la couleur transmise par le serveur — le mélange de biomes calculé à la
 * génération. Les autres modes recolorent le même maillage à partir des champs reçus : ce
 * sont des outils de réglage, pas des rendus. Pouvoir basculer instantanément entre
 * « humidité » et « biomes » est la seule façon raisonnable de comprendre pourquoi une
 * forêt pousse là plutôt qu'ailleurs.
 */
export const TERRAIN_COLOR_MODES = [
  'natural',
  'biome',
  'region',
  'elevation',
  'slope',
  'temperature',
  'moisture',
  'fertility',
  'rockiness',
  'vegetation',
  'water',
] as const;

export type TerrainColorMode = (typeof TERRAIN_COLOR_MODES)[number];

export const TERRAIN_COLOR_MODE_LABELS: Record<TerrainColorMode, string> = {
  natural: 'Naturel',
  biome: 'Biomes',
  region: 'Régions',
  elevation: 'Altitude',
  slope: 'Pente',
  temperature: 'Température',
  moisture: 'Humidité',
  fertility: 'Fertilité',
  rockiness: 'Rocaille',
  vegetation: 'Végétation',
  water: 'Eau',
};

const COLD = new THREE.Color('#2c5f9e');
const MID = new THREE.Color('#d9c76b');
const HOT = new THREE.Color('#b3402f');
const DRY = new THREE.Color('#7d6a44');
const WET = new THREE.Color('#2f7f8f');

export function colorForMode(
  mode: TerrainColorMode,
  terrain: DecodedTerrain,
  vertexIndex: number,
  metadata: WorldGenerationMetadata,
  target: THREE.Color,
): THREE.Color {
  switch (mode) {
    case 'natural':
      return target.setRGB(
        (terrain.colors[vertexIndex * 3] ?? 0) / 255,
        (terrain.colors[vertexIndex * 3 + 1] ?? 0) / 255,
        (terrain.colors[vertexIndex * 3 + 2] ?? 0) / 255,
      );

    case 'biome': {
      const biome = metadata.biomes[terrain.fields.biome[vertexIndex] ?? 0];
      return target.set(biome?.color ?? '#888888');
    }

    case 'region': {
      // Aucune région n'a encore de nom/couleur curée (voir `TerrainFieldGrids.region`) :
      // une teinte dérivée directement de l'octet suffit à distinguer visuellement les
      // régions adjacentes, sans inventer une liste de descripteurs pour ce calque de debug.
      const hue = byte01(terrain.fields.region[vertexIndex]);
      return target.setHSL(hue, 0.55, 0.5);
    }

    case 'elevation':
      return gradient(target, byte01(terrain.fields.elevation[vertexIndex]));
    case 'slope':
      return gradient(target, byte01(terrain.fields.slope[vertexIndex]));
    case 'temperature':
      return gradient(target, byte01(terrain.fields.temperature[vertexIndex]));
    case 'fertility':
      return gradient(target, byte01(terrain.fields.fertility[vertexIndex]));
    case 'rockiness':
      return gradient(target, byte01(terrain.fields.rockiness[vertexIndex]));
    case 'vegetation':
      return gradient(target, byte01(terrain.fields.vegetation[vertexIndex]));

    case 'moisture':
      return target.copy(DRY).lerp(WET, byte01(terrain.fields.moisture[vertexIndex]));

    case 'water': {
      const height = terrain.waterHeights[vertexIndex] as number;
      if (Number.isNaN(height)) return target.set('#3a3f36');
      const depth = height - (terrain.heights[vertexIndex] as number);
      return target.set('#7fd4ff').lerp(new THREE.Color('#0b2c4a'), Math.min(1, depth / 4));
    }

    default: {
      const exhaustive: never = mode;
      throw new Error(`Unhandled terrain color mode: ${String(exhaustive)}`);
    }
  }
}

/** Rampe bleu → jaune → rouge, lisible et sans ambiguïté sur la valeur médiane. */
function gradient(target: THREE.Color, value: number): THREE.Color {
  if (value < 0.5) return target.copy(COLD).lerp(MID, value * 2);
  return target.copy(MID).lerp(HOT, (value - 0.5) * 2);
}

function byte01(value: number | undefined): number {
  return (value ?? 0) / 255;
}
