import type { BiomeDefinition } from './biomeDefinition.js';

/**
 * Biomes de la V1.
 *
 * Les plages sont exprimées dans les unités normalisées produites par le `TerrainSampler`
 * (toutes dans [0, 1], `elevation` incluse). `waterProximity` vaut 1 au bord de l'eau et
 * décroît avec la distance.
 *
 * Deux biomes de transition (`sparse_forest`, `riverbank`) existent parce qu'ils évitent le
 * contact brutal entre une forêt dense et une prairie, et entre une berge et l'intérieur
 * des terres. Ce sont des biomes de plein droit, pas des artifices de rendu.
 */
export const DEFAULT_BIOMES: readonly BiomeDefinition[] = [
  {
    id: 'grassland',
    displayName: 'Prairie',
    color: '#7fa04f',
    threshold: 0.5,
    priority: 1,
    temperature: { min: 0.3, max: 0.85, tolerance: 0.25 },
    moisture: { min: 0.25, max: 0.6, tolerance: 0.25, weight: 1.4 },
    slope: { min: 0, max: 0.28, tolerance: 0.22, weight: 1.2 },
    rockiness: { min: 0, max: 0.4, tolerance: 0.3 },
    elevation: { min: 0.27, max: 0.62, tolerance: 0.2 },
  },
  {
    id: 'sparse_forest',
    displayName: 'Forêt clairsemée',
    color: '#6f9448',
    threshold: 0.55,
    priority: 2,
    temperature: { min: 0.32, max: 0.82, tolerance: 0.2 },
    moisture: { min: 0.45, max: 0.68, tolerance: 0.14, weight: 1.5 },
    slope: { min: 0, max: 0.38, tolerance: 0.22 },
    rockiness: { min: 0, max: 0.45, tolerance: 0.25 },
    elevation: { min: 0.27, max: 0.68, tolerance: 0.18 },
  },
  {
    id: 'forest',
    displayName: 'Forêt',
    color: '#4d7a3c',
    threshold: 0.55,
    priority: 3,
    temperature: { min: 0.3, max: 0.8, tolerance: 0.2 },
    moisture: { min: 0.6, max: 0.92, tolerance: 0.16, weight: 1.6 },
    slope: { min: 0, max: 0.4, tolerance: 0.25 },
    rockiness: { min: 0, max: 0.4, tolerance: 0.25 },
    elevation: { min: 0.27, max: 0.72, tolerance: 0.18 },
  },
  {
    id: 'rocky',
    displayName: 'Zone rocheuse',
    color: '#8a8378',
    threshold: 0.55,
    priority: 4,
    rockiness: { min: 0.48, max: 1, tolerance: 0.22, weight: 2 },
    slope: { min: 0.28, max: 1, tolerance: 0.25, weight: 1.6 },
    elevation: { min: 0.5, max: 1, tolerance: 0.28 },
    moisture: { min: 0, max: 0.65, tolerance: 0.3 },
  },
  {
    id: 'wetland',
    displayName: 'Zone humide',
    color: '#5d7f52',
    threshold: 0.6,
    priority: 5,
    moisture: { min: 0.72, max: 1, tolerance: 0.14, weight: 2 },
    elevation: { min: 0.23, max: 0.36, tolerance: 0.07, weight: 1.6 },
    slope: { min: 0, max: 0.12, tolerance: 0.1, weight: 1.4 },
    waterProximity: { min: 0.55, max: 1, tolerance: 0.25, weight: 1.5 },
  },
  {
    id: 'riverbank',
    displayName: 'Berge',
    color: '#93916a',
    threshold: 0.68,
    priority: 6,
    waterProximity: { min: 0.88, max: 1, tolerance: 0.08, weight: 2.5 },
    slope: { min: 0, max: 0.3, tolerance: 0.2 },
    elevation: { min: 0.23, max: 0.64, tolerance: 0.2 },
  },
];
