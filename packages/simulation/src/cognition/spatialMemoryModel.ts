import type {
  CognitiveMemoryComponent,
  SpatialMemoryEntry,
} from '../components/cognitiveMemory.js';
import { allocateMemoryId } from '../components/cognitiveMemory.js';
import type { CognitionConfig } from '../config/simulationConfig.js';
import type { Observation } from './observation.js';

/**
 * Logique pure de la mémoire spatiale générique (CLAUDE.md règle 8 : testable sans ECS).
 * `PerceptionSystem` produit des `Observation` (voir `observationBuilder.ts`) ; ici,
 * rien ne dépend ni du monde ni des entités.
 */

/**
 * Deux souvenirs désignent le même lieu si leur `worldRef` coïncide (le même individu de
 * ressource, par exemple). À défaut, ils tombent dans la même cellule grossière (4 m, la
 * mémoire spatiale n'est pas une carte au centimètre) — MAIS seulement si aucun des deux
 * concepts perçus ne les contredit : deux objets proches de concepts différents (un
 * danger et un abri dans la même cellule, par exemple) ne doivent jamais fusionner en un
 * seul souvenir sous prétexte de proximité.
 */
function sameSubject(a: SpatialMemoryEntry, b: Observation, cellM: number): boolean {
  if (a.kind !== b.kind) return false;
  if (a.worldRef && b.worldRef) {
    return (
      a.worldRef.type === b.worldRef.type &&
      a.worldRef.resourceId === b.worldRef.resourceId &&
      a.worldRef.ownerChunkKey === b.worldRef.ownerChunkKey &&
      a.worldRef.localId === b.worldRef.localId
    );
  }
  if (
    a.subjectConceptId !== undefined &&
    b.subjectConceptId !== undefined &&
    a.subjectConceptId !== b.subjectConceptId
  ) {
    return false;
  }
  const cellAx = Math.round(a.x / cellM);
  const cellAz = Math.round(a.z / cellM);
  const cellBx = Math.round(b.x / cellM);
  const cellBz = Math.round(b.z / cellM);
  return cellAx === cellBx && cellAz === cellBz;
}

/**
 * Enregistre une observation spatiale. Revoir le même lieu rafraîchit son souvenir
 * (position, confiance, précision remises à la valeur encodée par CETTE observation) au
 * lieu de le dupliquer — même principe que l'ancien `rememberFood`/`rememberWater`.
 *
 * `observation.confidence01`/`precisionM`, s'ils sont fournis, priment sur les valeurs
 * fraîches par défaut de `config` — c'est ainsi qu'une source moins fiable qu'une
 * perception directe (observation sociale, 3.8/3.9) encodera un souvenir à confiance
 * plus basse dès sa création, sans que `ForgettingSystem` ne la réhausse jamais.
 */
export function rememberSpatial(
  memory: CognitiveMemoryComponent,
  observation: Observation,
  config: Pick<
    CognitionConfig,
    'freshSpatialConfidence01' | 'freshSpatialPrecisionM' | 'maxSpatialEntries'
  >,
  cellM = 4,
): void {
  const encodedConfidence01 = observation.confidence01 ?? config.freshSpatialConfidence01;
  const encodedPrecisionM = observation.precisionM ?? config.freshSpatialPrecisionM;

  const existing = memory.spatial.find((entry) => sameSubject(entry, observation, cellM));
  if (existing) {
    existing.x = observation.x;
    existing.z = observation.z;
    existing.lastSeenTick = observation.tick;
    existing.confidence01 = encodedConfidence01;
    existing.precisionM = encodedPrecisionM;
    existing.encodedConfidence01 = encodedConfidence01;
    existing.encodedPrecisionM = encodedPrecisionM;
    existing.source = observation.source;
    if (observation.subjectConceptId !== undefined)
      existing.subjectConceptId = observation.subjectConceptId;
    if (observation.worldRef !== undefined) existing.worldRef = observation.worldRef;
    // Rafraîchissement : le souvenir le plus récent part en fin de tableau, comme
    // l'ancienne mémoire nourriture/eau — sert de tri implicite pour l'éviction FIFO.
    memory.spatial.splice(memory.spatial.indexOf(existing), 1);
    memory.spatial.push(existing);
    return;
  }

  const entry: SpatialMemoryEntry = {
    id: allocateMemoryId(memory),
    kind: observation.kind,
    x: observation.x,
    z: observation.z,
    lastSeenTick: observation.tick,
    confidence01: encodedConfidence01,
    precisionM: encodedPrecisionM,
    encodedConfidence01,
    encodedPrecisionM,
    source: observation.source,
    ...(observation.subjectConceptId !== undefined
      ? { subjectConceptId: observation.subjectConceptId }
      : {}),
    ...(observation.worldRef !== undefined ? { worldRef: observation.worldRef } : {}),
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
 * `lastSeenTick`, à partir de la valeur ENCODÉE de chaque souvenir
 * (`encodedConfidence01`/`encodedPrecisionM`) — jamais depuis la confiance fraîche par
 * défaut de `config` (voir la doc de `SpatialMemoryEntry`) et jamais un décrément
 * cumulatif (le calcul reste correct quelle que soit la fréquence effective des passes
 * de `ForgettingSystem`). Les souvenirs tombés sous `minSpatialConfidence01` sont
 * purgés. Mutation en place ; ne fait rien si la mémoire est déjà vide.
 */
export function decaySpatialMemory(
  memory: CognitiveMemoryComponent,
  nowTick: number,
  gameSecondsPerTick: number,
  config: Pick<
    CognitionConfig,
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
    const halfLives = elapsedSeconds / config.spatialConfidenceHalfLifeSeconds;
    const confidence01 = entry.encodedConfidence01 * 0.5 ** halfLives;
    if (confidence01 < config.minSpatialConfidence01) continue; // purgé, pas conservé flou.

    entry.confidence01 = confidence01;
    entry.precisionM = Math.min(
      config.maxSpatialPrecisionM,
      entry.encodedPrecisionM + elapsedSeconds * config.spatialPrecisionGrowthPerSecondM,
    );
    kept.push(entry);
  }
  memory.spatial = kept;
}
