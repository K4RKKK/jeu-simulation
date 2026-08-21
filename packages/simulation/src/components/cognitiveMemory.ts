import type { EntityId } from '@civ/shared';
import type { ConceptId, MemoryId } from '../cognition/ids.js';
import type { ObservationSource } from '../cognition/observation.js';
import type { WorldRef } from '../cognition/worldRef.js';
import { defineComponent } from '../core/componentType.js';

export type { WorldRef };

/**
 * Souvenir d'un lieu — eau, ressource, abri, humain, danger, endroit notable.
 *
 * `subjectConceptId` est optionnel : un lieu peut être mémorisé sans qu'aucun concept
 * ne lui soit encore associé (par exemple un point d'eau perçu avant que le concept
 * `water` ne soit consolidé côté croyances — 3.3). `precisionM` reflète l'incertitude du
 * souvenir, pas une position GPS parfaite : elle est censée croître avec le temps écoulé
 * depuis `lastSeenTick` (logique de décroissance ajoutée en 3.2, `ForgettingSystem`).
 *
 * `confidence01`/`precisionM` sont les valeurs COURANTES (déjà décrues par
 * `ForgettingSystem` le cas échéant) — c'est ce que lisent les futurs consommateurs.
 * `encodedConfidence01`/`encodedPrecisionM` sont la valeur de BASE au moment de la
 * (re)perception, à laquelle `decaySpatialMemory` revient à chaque recalcul. Bug évité
 * par cette séparation : sans elle, décroître systématiquement depuis la confiance
 * fraîche PAR DÉFAUT (`CognitionConfig.freshSpatialConfidence01`) aurait artificiellement
 * REHAUSSÉ un souvenir encodé à une confiance plus basse (ex. une information sociale
 * reçue à confiance 0,4 — 3.9) jusqu'à la confiance d'une perception directe.
 */
export interface SpatialMemoryEntry {
  readonly id: MemoryId;
  readonly kind: 'water' | 'resource' | 'shelter' | 'human' | 'danger' | 'place';
  x: number;
  z: number;
  lastSeenTick: number;
  decayAnchorTick?: number;
  confidence01: number;
  precisionM: number;
  encodedConfidence01: number;
  encodedPrecisionM: number;
  source: ObservationSource;
  subjectConceptId?: ConceptId;
  worldRef?: WorldRef;
  foodCandidate?: boolean;
}

/**
 * Événement vécu ou observé, daté et localisé.
 *
 * `eventType`/`outcome` sont des CODES machine stables (ex. `"food.eaten"`,
 * `"physiology.satiety_increased"`), jamais des phrases destinées à l'affichage — même
 * principe que `DecisionReason` (`humanCognition.ts`) : la simulation ne connaît que du
 * sémantique, la traduction en texte lisible est un problème de la couche présentation.
 */
export interface EpisodicMemoryEntry {
  readonly id: MemoryId;
  readonly tick: number;
  readonly eventType: string;
  readonly actors: EntityId[];
  readonly subjectConcept?: ConceptId;
  readonly x?: number;
  readonly z?: number;
  readonly outcome: string;
  readonly emotionalStrength01: number;
}

/** Ce qu'un humain retient d'un autre humain — primitives sociales minimales (P3.4 texte). */
export interface SocialMemoryEntry {
  readonly id: MemoryId;
  readonly humanId: EntityId;
  trust01: number;
  familiarity01: number;
  lastContactTick: number;
}

/**
 * Mémoire cognitive générique — distincte de l'ancien `MemoryComponent` (`memory.ts`),
 * un cache spatial étroit spécifique nourriture/eau consommé par `PerceptionSystem`/
 * `NeedSatisfactionSystem`. Les deux coexistent volontairement le temps de la migration
 * progressive (sous-phase 3.2, voir P3.21) : ne pas fusionner ni faire disparaître
 * `MemoryComponent` avant que `CognitiveMemoryComponent` couvre réellement le même besoin.
 *
 * `nextMemoryId` est le compteur LOCAL qui alloue les `MemoryId` de cet humain (voir
 * `allocateMemoryId` ci-dessous et la doc de `cognition/ids.ts`) — jamais d'aléa.
 *
 * Toujours créée vide à la naissance (`HumanFactory.create`) ; remplie par les systèmes
 * de perception à partir de 3.2. Le nombre maximal d'entrées est contrôlé par
 * `CognitionConfig.maxSpatialEntries` et appliqué par `rememberSpatial`.
 */
export interface CognitiveMemoryComponent {
  nextMemoryId: MemoryId;
  spatial: SpatialMemoryEntry[];
  episodic: EpisodicMemoryEntry[];
  social: SocialMemoryEntry[];
}

export const CognitiveMemory = defineComponent<CognitiveMemoryComponent>('CognitiveMemory');

export function createEmptyCognitiveMemory(): CognitiveMemoryComponent {
  return { nextMemoryId: 0, spatial: [], episodic: [], social: [] };
}

/** Alloue un `MemoryId` déterministe et met à jour le compteur du composant en place. */
export function allocateMemoryId(component: CognitiveMemoryComponent): MemoryId {
  const id = component.nextMemoryId;
  component.nextMemoryId += 1;
  return id;
}
