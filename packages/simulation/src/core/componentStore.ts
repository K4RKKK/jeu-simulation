import type { EntityId } from '@civ/shared';

/**
 * Stockage d'un composant pour toutes les entités qui le portent.
 *
 * Deux exigences se rencontrent ici :
 *
 * 1. **Accès O(1)** par entité → une `Map`.
 * 2. **Ordre d'itération déterministe** → un tableau d'identifiants trié, reconstruit
 *    paresseusement. L'ordre d'insertion d'une `Map` serait déjà déterministe, mais il
 *    dépendrait de l'historique des ajouts/retraits : deux mondes issus de la même seed
 *    pourraient diverger après un `removeComponent` suivi d'un `addComponent`. Trier par
 *    `EntityId` rend l'ordre indépendant de cet historique (règle 4 : déterminisme).
 */
export class ComponentStore<T> {
  private readonly values = new Map<EntityId, T>();
  private sortedIds: EntityId[] = [];
  private sortedDirty = false;

  constructor(readonly name: string) {}

  get size(): number {
    return this.values.size;
  }

  set(entity: EntityId, value: T): T {
    if (!this.values.has(entity)) this.sortedDirty = true;
    this.values.set(entity, value);
    return value;
  }

  get(entity: EntityId): T | undefined {
    return this.values.get(entity);
  }

  has(entity: EntityId): boolean {
    return this.values.has(entity);
  }

  delete(entity: EntityId): boolean {
    const removed = this.values.delete(entity);
    if (removed) this.sortedDirty = true;
    return removed;
  }

  clear(): void {
    this.values.clear();
    this.sortedIds = [];
    this.sortedDirty = false;
  }

  /** Identifiants triés par ordre croissant. Le tableau retourné ne doit pas être muté. */
  ids(): readonly EntityId[] {
    if (this.sortedDirty) {
      this.sortedIds = [...this.values.keys()].sort((a, b) => a - b);
      this.sortedDirty = false;
    }
    return this.sortedIds;
  }

  entries(): IterableIterator<[EntityId, T]> {
    return this.values.entries();
  }
}
