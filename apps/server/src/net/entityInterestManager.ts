import { chunkKey, chunksInRadius, worldToChunk, type ChunkCoordinate } from '@civ/procedural';
import type { EntityId, HumanProfile, HumanState, NetworkEvent } from '@civ/shared';

export interface EntityInterestSelection {
  readonly profiles: HumanProfile[];
  readonly humans: HumanState[];
  readonly entityIds: ReadonlySet<EntityId>;
}

export interface EntityInterestManagerOptions {
  /** Même plafond que le streamer de chunks : une demande hostile ne révèle pas le monde entier. */
  readonly maxRadiusChunks?: number;
  /** Petite couronne anti-clignotement autour de la zone rendue. */
  readonly paddingChunks?: number;
  /** Plafond de rendu par observateur, même dans un rassemblement extrêmement dense. */
  readonly maxEntitiesPerSession?: number;
}

/**
 * Index spatial reconstruit une fois par tour réseau, puis interrogé pour chaque client.
 *
 * Les humains restent tous simulés côté serveur. Seule leur représentation réseau est
 * limitée à la zone réellement observée : sortir de la zone produit un `removed`, y
 * revenir produit à nouveau fiche + état via le delta normal de `ClientSession`.
 */
export class EntityInterestManager {
  private readonly statesByChunk = new Map<string, HumanState[]>();
  private readonly profilesById = new Map<EntityId, HumanProfile>();
  private readonly maxRadiusChunks: number;
  private readonly paddingChunks: number;
  private readonly maxEntitiesPerSession: number;

  constructor(
    private readonly chunkSizeMeters: number,
    options: EntityInterestManagerOptions = {},
  ) {
    if (!Number.isFinite(chunkSizeMeters) || chunkSizeMeters <= 0) {
      throw new RangeError(`Invalid chunk size for entity interest: ${chunkSizeMeters}`);
    }
    this.maxRadiusChunks = Math.max(0, Math.floor(options.maxRadiusChunks ?? 7));
    this.paddingChunks = Math.max(0, Math.floor(options.paddingChunks ?? 1));
    this.maxEntitiesPerSession = Math.max(1, Math.floor(options.maxEntitiesPerSession ?? 500));
  }

  rebuild(profiles: readonly HumanProfile[], states: readonly HumanState[]): void {
    this.statesByChunk.clear();
    this.profilesById.clear();
    for (const profile of profiles) this.profilesById.set(profile.id, profile);
    for (const state of states) {
      const key = chunkKey(worldToChunk(state.x, state.z, this.chunkSizeMeters));
      const bucket = this.statesByChunk.get(key) ?? [];
      bucket.push(state);
      this.statesByChunk.set(key, bucket);
    }
  }

  select(center: ChunkCoordinate | null, requestedRadius: number): EntityInterestSelection {
    if (center === null) return emptySelection();
    const safeRequested = Number.isFinite(requestedRadius) ? Math.floor(requestedRadius) : 0;
    const radius = Math.min(this.maxRadiusChunks, Math.max(0, safeRequested)) + this.paddingChunks;
    const humans: HumanState[] = [];
    const entityIds = new Set<EntityId>();

    for (const coordinate of chunksInRadius(center, radius)) {
      for (const state of this.statesByChunk.get(chunkKey(coordinate)) ?? []) {
        humans.push(state);
        entityIds.add(state.id);
      }
    }

    if (humans.length > this.maxEntitiesPerSession) {
      // `chunksInRadius` fournit déjà les chunks du plus proche au plus lointain, et les
      // états gardent l'ordre stable des entités. Ne pas retrier par distance exacte :
      // dans une foule en mouvement, la 500e et la 501e personne s'échangeraient à chaque
      // image et créeraient un coûteux cycle retrait/réintroduction réseau.
      humans.length = this.maxEntitiesPerSession;
      entityIds.clear();
      for (const state of humans) entityIds.add(state.id);
    }

    const profiles: HumanProfile[] = [];
    for (const state of humans) {
      const profile = this.profilesById.get(state.id);
      if (profile) profiles.push(profile);
    }
    return { profiles, humans, entityIds };
  }
}

/** Les événements majeurs restent mondiaux ; les actions ordinaires suivent leur humain. */
export function eventsForInterest(
  events: readonly NetworkEvent[],
  visibleEntityIds: ReadonlySet<EntityId>,
): NetworkEvent[] {
  return events.filter(
    (event) =>
      event.entityId === null ||
      event.type === 'HumanBorn' ||
      event.type === 'HumanDied' ||
      visibleEntityIds.has(event.entityId),
  );
}

function emptySelection(): EntityInterestSelection {
  return { profiles: [], humans: [], entityIds: new Set<EntityId>() };
}
