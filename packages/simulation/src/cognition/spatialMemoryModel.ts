import type {
  CognitiveMemoryComponent,
  SpatialMemoryEntry,
  WorldRef,
} from '../components/cognitiveMemory.js';
import { allocateMemoryId } from '../components/cognitiveMemory.js';
import type { CognitionConfig } from '../config/simulationConfig.js';
import type { ConceptId } from './ids.js';
import type { ObservationSource } from './observation.js';

/**
 * Logique pure de la mémoire spatiale générique (CLAUDE.md règle 8 : testable sans ECS).
 * `PerceptionSystem` fait le lien avec le monde ; ici, rien ne dépend ni du monde ni des
 * entités.
 */

export interface FreshSpatialSighting {
  readonly kind: SpatialMemoryEntry['kind'];
  readonly x: number;
  readonly z: number;
  readonly subjectConceptId?: ConceptId;
  readonly worldRef?: WorldRef;
  readonly source: ObservationSource;
}

/**
 * Deux souvenirs désignent le même lieu si leur `worldRef` coïncide (le même individu de
 * ressource, par exemple), ou — à défaut — s'ils tombent dans la même cellule grossière
 * (4 m, comme l'ancien `rememberWater`) : la mémoire spatiale n'est pas une carte au
 * centimètre.
 */
function sameSubject(a: SpatialMemoryEntry, b: FreshSpatialSighting, cellM: number): boolean {
  if (a.kind !== b.kind) return false;
  if (a.worldRef && b.worldRef) {
    return (
      a.worldRef.type === b.worldRef.type &&
      a.worldRef.resourceId === b.worldRef.resourceId &&
      a.worldRef.ownerChunkKey === b.worldRef.ownerChunkKey &&
      a.worldRef.localId === b.worldRef.localId
    );
  }
  const cellAx = Math.round(a.x / cellM);
  const cellAz = Math.round(a.z / cellM);
  const cellBx = Math.round(b.x / cellM);
  const cellBz = Math.round(b.z / cellM);
  return cellAx === cellBx && cellAz === cellBz;
}

/**
 * Enregistre une observation spatiale fraîche. Revoir le même lieu rafraîchit son
 * souvenir (position, confiance, précision remises à neuf) au lieu de le dupliquer —
 * même principe que l'ancien `rememberFood`/`rememberWater`.
 */
export function rememberSpatial(
  memory: CognitiveMemoryComponent,
  sighting: FreshSpatialSighting,
  nowTick: number,
  config: Pick<
    CognitionConfig,
    'freshSpatialConfidence01' | 'freshSpatialPrecisionM' | 'maxSpatialEntries'
  >,
  cellM = 4,
): void {
  const existing = memory.spatial.find((entry) => sameSubject(entry, sighting, cellM));
  if (existing) {
    existing.x = sighting.x;
    existing.z = sighting.z;
    existing.lastSeenTick = nowTick;
    existing.confidence01 = config.freshSpatialConfidence01;
    existing.precisionM = config.freshSpatialPrecisionM;
    existing.source = sighting.source;
    if (sighting.subjectConceptId !== undefined)
      existing.subjectConceptId = sighting.subjectConceptId;
    if (sighting.worldRef !== undefined) existing.worldRef = sighting.worldRef;
    // Rafraîchissement : le souvenir le plus récent part en fin de tableau, comme
    // l'ancienne mémoire nourriture/eau — sert de tri implicite pour l'éviction FIFO.
    memory.spatial.splice(memory.spatial.indexOf(existing), 1);
    memory.spatial.push(existing);
    return;
  }

  const entry: SpatialMemoryEntry = {
    id: allocateMemoryId(memory),
    kind: sighting.kind,
    x: sighting.x,
    z: sighting.z,
    lastSeenTick: nowTick,
    confidence01: config.freshSpatialConfidence01,
    precisionM: config.freshSpatialPrecisionM,
    source: sighting.source,
    ...(sighting.subjectConceptId !== undefined
      ? { subjectConceptId: sighting.subjectConceptId }
      : {}),
    ...(sighting.worldRef !== undefined ? { worldRef: sighting.worldRef } : {}),
  };
  memory.spatial.push(entry);
  if (memory.spatial.length > config.maxSpatialEntries) {
    evictLeastConfident(memory);
  }
}

/** Retire le souvenir spatial le moins fiable — appelé quand la capacité est dépassée. */
function evictLeastConfident(memory: CognitiveMemoryComponent): void {
  let worstIndex = 0;
  let worstConfidence = Number.POSITIVE_INFINITY;
  for (let i = 0; i < memory.spatial.length; i++) {
    const confidence = memory.spatial[i]!.confidence01;
    if (confidence < worstConfidence) {
      worstConfidence = confidence;
      worstIndex = i;
    }
  }
  memory.spatial.splice(worstIndex, 1);
}

/**
 * Fait vieillir la mémoire spatiale d'un humain : `confidence01`/`precisionM` sont
 * recalculés comme une fonction ABSOLUE des secondes de jeu écoulées depuis
 * `lastSeenTick` (jamais un décrément cumulatif — voir la doc de `CognitionConfig`),
 * puis les souvenirs tombés sous `minSpatialConfidence01` sont purgés. Mutation en
 * place ; ne fait rien si la mémoire est déjà vide (évite tout travail sur la
 * population qui n'a encore rien perçu).
 */
export function decaySpatialMemory(
  memory: CognitiveMemoryComponent,
  nowTick: number,
  gameSecondsPerTick: number,
  config: Pick<
    CognitionConfig,
    | 'freshSpatialConfidence01'
    | 'freshSpatialPrecisionM'
    | 'spatialConfidenceHalfLifeSeconds'
    | 'spatialPrecisionGrowthPerSecondM'
    | 'maxSpatialPrecisionM'
    | 'minSpatialConfidence01'
  >,
): void {
  if (memory.spatial.length === 0) return;

  const kept: SpatialMemoryEntry[] = [];
  for (const entry of memory.spatial) {
    const elapsedSeconds = Math.max(0, (nowTick - entry.lastSeenTick) * gameSecondsPerTick);
    // Recalculé depuis la valeur FRAÎCHE (jamais depuis `entry.confidence01`/`precisionM`,
    // déjà dérivés d'une passe précédente) : sinon un second appel décroîtrait un souvenir
    // déjà décru par le temps déjà compté dans le premier — non idempotent, une passe de
    // plus multiplierait un décalage déjà appliqué. Recalculer depuis l'observation fraîche
    // et le temps total écoulé donne toujours la même valeur, quel que soit le nombre de
    // fois où `ForgettingSystem` est passé entre-temps.
    const halfLives = elapsedSeconds / config.spatialConfidenceHalfLifeSeconds;
    const confidence01 = config.freshSpatialConfidence01 * 0.5 ** halfLives;
    if (confidence01 < config.minSpatialConfidence01) continue; // purgé, pas conservé flou.

    entry.confidence01 = confidence01;
    entry.precisionM = Math.min(
      config.maxSpatialPrecisionM,
      config.freshSpatialPrecisionM + elapsedSeconds * config.spatialPrecisionGrowthPerSecondM,
    );
    kept.push(entry);
  }
  memory.spatial = kept;
}
