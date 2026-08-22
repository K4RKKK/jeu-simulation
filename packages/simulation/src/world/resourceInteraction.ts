import type { EntityId } from '@civ/shared';
import {
  InteractiveResource,
  Transform,
  type InteractiveResourceComponent,
} from '../components/index.js';
import type { EntityManager } from '../core/entityManager.js';
import type { World } from './world.js';

export type ResourceGatherCommitResult =
  | { readonly committed: false; readonly reason: 'missing' | 'depleted' }
  | {
      readonly committed: true;
      readonly foodKcal: number;
      readonly foodToxicity01: number;
      readonly harvestServings: number;
      readonly remainingServings: number;
    };

/**
 * Promeut une ressource procédurale en entité ECS au premier contact.
 *
 * Deux acteurs qui arrivent au même tick partagent l'entité déjà promue : il ne
 * peut donc jamais exister deux états interactifs concurrents pour le même spawn.
 */
export function beginResourceInteraction(
  entities: EntityManager,
  world: World,
  actor: EntityId,
  resourceId: string,
  ownerChunkKey: string,
  tick: number,
): EntityId | null {
  const existing = findInteractiveResource(entities, resourceId);
  if (existing !== null) {
    const resource = entities.getComponentOrThrow(existing, InteractiveResource);
    if (resource.state === 'depleted') return null;
    addInteractor(resource, actor);
    return existing;
  }

  if (world.delta.isDepleted(resourceId)) return null;
  const spawn = world.findResourceById(resourceId, ownerChunkKey);
  if (!spawn) return null;

  const previousFraction = world.delta.get(resourceId)?.changedFields.remainingFraction01;
  const remainingFraction01 = typeof previousFraction === 'number' ? clamp01(previousFraction) : 1;
  const remainingServings = Math.max(1, Math.round(remainingFraction01 * spawn.harvestServings));

  const entity = entities.createEntity();
  entities.addComponent(entity, Transform, {
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    yaw: spawn.rotationY,
  });
  entities.addComponent(entity, InteractiveResource, {
    resourceId: spawn.id,
    definitionId: spawn.definitionId,
    ownerChunkKey: spawn.ownerChunkKey,
    localId: spawn.localId,
    scale: spawn.scale,
    rotationY: spawn.rotationY,
    foodKcal: spawn.foodKcal,
    foodToxicity01: spawn.foodToxicity01,
    harvestServings: spawn.harvestServings,
    remainingServings,
    remainingFraction01,
    state: 'active',
    interactingEntityIds: [actor],
    promotedAtTick: tick,
    lastModifiedTick: tick,
  });
  return entity;
}

/**
 * Récolte une portion via l'entité interactive puis consolide aussitôt le résultat
 * dans `WorldDelta`, source durable unique du monde.
 */
export function harvestInteractiveResource(
  entities: EntityManager,
  world: World,
  resourceEntity: EntityId,
  tick: number,
): number {
  const resource = entities.getComponent(resourceEntity, InteractiveResource);
  const transform = entities.getComponent(resourceEntity, Transform);
  if (!resource || !transform || resource.state === 'depleted') return 0;

  const remaining = world.harvestResource(
    resource.resourceId,
    resource.ownerChunkKey,
    resource.localId,
    resource.harvestServings,
    transform.x,
    transform.z,
    tick,
  );
  resource.remainingServings = remaining;
  resource.remainingFraction01 = remaining / resource.harvestServings;
  resource.lastModifiedTick = tick;
  if (remaining === 0) resource.state = 'depleted';
  return remaining;
}

/**
 * Commits one detached portion after a timed gather. Physical payload is captured before
 * the world mutation so the final portion remains edible after its spawn disappears.
 */
export function commitResourceGathering(
  entities: EntityManager,
  world: World,
  resourceEntity: EntityId,
  actor: EntityId,
  tick: number,
): ResourceGatherCommitResult {
  const resource = entities.getComponent(resourceEntity, InteractiveResource);
  const transform = entities.getComponent(resourceEntity, Transform);
  if (!resource || !transform || !resource.interactingEntityIds.includes(actor)) {
    return { committed: false, reason: 'missing' };
  }
  if (resource.state === 'depleted' || world.delta.isDepleted(resource.resourceId)) {
    return { committed: false, reason: 'depleted' };
  }
  const spawn = world.findResourceById(resource.resourceId, resource.ownerChunkKey);
  if (!spawn || spawn.localId !== resource.localId) {
    return { committed: false, reason: 'missing' };
  }

  const payload = {
    foodKcal: spawn.foodKcal,
    foodToxicity01: spawn.foodToxicity01,
    harvestServings: spawn.harvestServings,
  };
  const remainingServings = harvestInteractiveResource(entities, world, resourceEntity, tick);
  return { committed: true, ...payload, remainingServings };
}

/**
 * Termine l'interaction d'un acteur. La coquille ECS est rétrogradée dès que le
 * dernier utilisateur la libère ; le spawn procédural + `WorldDelta` redeviennent alors
 * l'unique représentation de la ressource.
 */
export function endResourceInteraction(
  entities: EntityManager,
  actor: EntityId,
  resourceId: string,
): boolean {
  const entity = findInteractiveResource(entities, resourceId);
  if (entity === null) return false;
  const resource = entities.getComponentOrThrow(entity, InteractiveResource);
  resource.interactingEntityIds = resource.interactingEntityIds.filter((id) => id !== actor);
  if (resource.interactingEntityIds.length > 0) return false;
  entities.destroyEntity(entity);
  return true;
}

export function findInteractiveResource(
  entities: EntityManager,
  resourceId: string,
): EntityId | null {
  let found: EntityId | null = null;
  entities.each([InteractiveResource], (entity, resource) => {
    if (found === null && resource.resourceId === resourceId) found = entity;
  });
  return found;
}

function addInteractor(resource: InteractiveResourceComponent, actor: EntityId): void {
  if (resource.interactingEntityIds.includes(actor)) return;
  resource.interactingEntityIds.push(actor);
  resource.interactingEntityIds.sort((a, b) => a - b);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
