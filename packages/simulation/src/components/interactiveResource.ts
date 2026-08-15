import type { EntityId } from '@civ/shared';
import { defineComponent } from '../core/componentType.js';

/**
 * Représentation ECS temporaire d'une ressource procédurale pendant une interaction.
 *
 * La ressource statique reste définie par son spawn procédural. Ce composant porte
 * uniquement l'état vivant nécessaire pendant que des entités la manipulent ; toute
 * modification durable est consolidée immédiatement dans `WorldDelta`.
 */
export interface InteractiveResourceComponent {
  resourceId: string;
  definitionId: string;
  ownerChunkKey: string;
  localId: number;
  scale: number;
  rotationY: number;
  foodKcal: number;
  foodToxicity01: number;
  harvestServings: number;
  remainingServings: number;
  remainingFraction01: number;
  state: 'active' | 'depleted';
  /** Entités qui utilisent actuellement cette même ressource, triées par id. */
  interactingEntityIds: EntityId[];
  promotedAtTick: number;
  lastModifiedTick: number;
}

export const InteractiveResource =
  defineComponent<InteractiveResourceComponent>('InteractiveResource');
