import { defineComponent } from '../core/componentType.js';

/* ---------------------------------------------------------------- */

/**
 * Souvenir d'une ressource comestible vue. La toxicité n'y figure **jamais** : elle n'est
 * pas visible, elle se découvre en mangeant (c'est le métabolisme qui la paie).
 */
export interface FoodMemoryEntry {
  resourceId: string;
  /** Type perçu : un buisson reste un buisson, même sans l'avoir goûté. */
  definitionId: string;
  /**
   * Chunk propriétaire de la ressource (celui qui l'a spawnée). Le stocker en mémoire
   * évite de le recalculer depuis la position physique — laquelle peut, avec le jitter,
   * appartenir géométriquement à un chunk voisin. Sans cette info, `findResourceById`
   * pouvait interroger le mauvais chunk et ne rien trouver.
   */
  ownerChunkKey: string;
  /**
   * Adresse compacte du spawn dans son chunk propriétaire (index dans la liste triée).
   * Recopiée depuis la ressource au moment de la perception : c'est l'adresse utilisée
   * par les messages réseau (`resource:removed { chunkKey, localId }`).
   */
  localId: number;
  x: number;
  z: number;
  /** Apparence de nourriture (kcal) : seule connaissance autorisée sur l'ingestion. */
  foodKcal: number;
  /** Tick auquel l'individu a vu la ressource pour la dernière fois. */
  lastSeenTick: number;
}

/** Souvenir d'un point de rive praticable, où l'on peut boire. */
export interface WaterMemoryEntry {
  x: number;
  z: number;
  lastSeenTick: number;
}

/**
 * Mémoire spatiale de l'individu (CLAUDE.md « Aucune connaissance globale ») : ce qu'il a
 * vu de ses yeux appartient à lui seul. Les entrées expirent (TTL configuré) et sont
 * bornées en nombre : un humain n'est pas une carte.
 *
 * Les positions de scan ne sont pas des souvenirs : elles servent au `PerceptionSystem`
 * pour ne rescanner la nourriture et l'eau qu'après un déplacement suffisant — jamais au
 * simple changement de chunk (bug corrigé : voir `PerceptionConfig.foodRescanMoveThresholdM`).
 */
export interface MemoryComponent {
  food: FoodMemoryEntry[];
  water: WaterMemoryEntry[];
  /** Dernière position depuis laquelle la nourriture a été scrutée. */
  lastFoodScanX: number | null;
  lastFoodScanZ: number | null;
  /** Dernière position depuis laquelle l'eau a été scrutée. */
  lastWaterScanX: number | null;
  lastWaterScanZ: number | null;
}

export const Memory = defineComponent<MemoryComponent>('Memory');
