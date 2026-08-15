import type { EntityId } from '@civ/shared';
import { ComponentStore } from './componentStore.js';
import type { ComponentType } from './componentType.js';

/** Extrait les types portés par une liste de `ComponentType`. */
type ComponentValues<T extends readonly ComponentType<unknown>[]> = {
  [K in keyof T]: T[K] extends ComponentType<infer U> ? U : never;
};

export interface EntityManagerStats {
  entityCount: number;
  componentTypeCount: number;
  componentInstanceCount: number;
}

/**
 * Registre des entités et de leurs composants.
 *
 * Modèle : `Entity` = identifiant, `Component` = donnée pure, `System` = comportement.
 * Aucun héritage. Les composants sont stockés par type (structure of arrays au niveau du
 * type de composant), ce qui donne des itérations localisées par système.
 */
export class EntityManager {
  private readonly alive = new Set<EntityId>();
  private readonly stores = new Map<number, ComponentStore<unknown>>();
  private nextEntityId: EntityId = 1;

  /* ---------------------------------------------------------------- */
  /* Entités                                                          */
  /* ---------------------------------------------------------------- */

  createEntity(): EntityId {
    const id = this.nextEntityId++;
    this.alive.add(id);
    return id;
  }

  destroyEntity(entity: EntityId): boolean {
    if (!this.alive.delete(entity)) return false;
    for (const store of this.stores.values()) {
      store.delete(entity);
    }
    return true;
  }

  exists(entity: EntityId): boolean {
    return this.alive.has(entity);
  }

  get entityCount(): number {
    return this.alive.size;
  }

  /** Identifiants vivants, triés. Copie : sûr à itérer pendant des destructions. */
  allEntities(): EntityId[] {
    return [...this.alive].sort((a, b) => a - b);
  }

  /**
   * Prochain identifiant qui sera attribué. Exposé pour la persistance : restaurer un
   * monde doit restaurer ce compteur, sinon deux entités différentes pourraient partager
   * un identifiant après un chargement.
   */
  get nextId(): EntityId {
    return this.nextEntityId;
  }

  restoreNextId(value: EntityId): void {
    if (value < this.nextEntityId) {
      throw new Error(`restoreNextId(${value}) would reuse already-issued entity ids`);
    }
    this.nextEntityId = value;
  }

  /**
   * Force le compteur d'identifiants à une valeur exacte, sans la garde de
   * `restoreNextId` — réservé au chargement d'un snapshot complet.
   *
   * `restoreNextId` protège contre la réutilisation d'un id déjà attribué PENDANT une
   * partie en cours (un appelant de bonne foi ne devrait jamais reculer le compteur).
   * Mais un chargement de snapshot **remplace tout l'état vivant** (`clear()` puis
   * réinjection) : le compteur précédent n'a plus aucun sens, qu'il ait été plus haut
   * ou plus bas que la valeur sauvegardée. Sans cette méthode, charger une sauvegarde
   * de 6 entités dans une simulation qui venait d'en créer 15 par défaut (population
   * initiale construite avant le chargement) levait à tort « réutilisation d'id ».
   */
  forceNextId(value: EntityId): void {
    this.nextEntityId = value;
  }

  /**
   * Restaure une entité par son identifiant exact — API interne réservée à la
   * persistance. Après plusieurs morts, les identifiants vivants ont des trous
   * (1, 2, 4, 8, 12, 57…) qu'il faut reconstruire bit à bit ; `createEntity` n'aide pas
   * puisqu'il incrémente `nextEntityId`. La logique métier ne doit jamais utiliser
   * cette méthode : elle briserait l'unicité des identifiants.
   */
  restoreEntity(entity: EntityId): void {
    this.alive.add(entity);
  }

  /**
   * Ensemble des stores de composants existants, indexés par nom de composant.
   * Exposé pour la persistance : permet d'itérer sur ce qui existe sans connaître à
   * l'avance la liste des types de composants.
   */
  storesByName(): Map<string, ComponentStore<unknown>> {
    const result = new Map<string, ComponentStore<unknown>>();
    for (const store of this.stores.values()) {
      result.set(store.name, store);
    }
    return result;
  }

  /** Insère (ou remplace) la valeur d'un composant par son type — API de restauration. */
  restoreComponent<T>(entity: EntityId, type: ComponentType<T>, value: T): void {
    // Volontairement sans vérification d'`alive` : le restore recompose l'ensemble
    // vivant AVANT d'injecter les composants, l'ordre exact reste sous contrôle du
    // caller de haut niveau.
    this.storeOf(type).set(entity, value);
  }

  /* ---------------------------------------------------------------- */
  /* Composants                                                        */
  /* ---------------------------------------------------------------- */

  addComponent<T>(entity: EntityId, type: ComponentType<T>, value: T): T {
    if (!this.alive.has(entity)) {
      throw new Error(`Cannot add component "${type.name}" to dead entity ${entity}`);
    }
    return this.storeOf(type).set(entity, value);
  }

  removeComponent<T>(entity: EntityId, type: ComponentType<T>): boolean {
    return this.storeOf(type).delete(entity);
  }

  getComponent<T>(entity: EntityId, type: ComponentType<T>): T | undefined {
    return this.storeOf(type).get(entity);
  }

  /** Variante stricte : l'absence du composant est un bug d'appelant, pas un cas normal. */
  getComponentOrThrow<T>(entity: EntityId, type: ComponentType<T>): T {
    const value = this.storeOf(type).get(entity);
    if (value === undefined) {
      throw new Error(`Entity ${entity} has no component "${type.name}"`);
    }
    return value;
  }

  hasComponent<T>(entity: EntityId, type: ComponentType<T>): boolean {
    return this.storeOf(type).has(entity);
  }

  /* ---------------------------------------------------------------- */
  /* Requêtes                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Identifiants des entités portant tous les composants demandés, triés par id.
   * Le tableau est une copie : détruire des entités pendant l'itération est sûr, mais il
   * faut alors revérifier `exists()`.
   */
  query(...types: readonly ComponentType<unknown>[]): EntityId[] {
    if (types.length === 0) return this.allEntities();
    const smallest = this.smallestStore(types);
    if (!smallest) return [];

    const others = types
      .map((type) => this.storeOf(type))
      .filter((store) => store !== smallest.store);

    const result: EntityId[] = [];
    for (const id of smallest.store.ids()) {
      if (others.every((store) => store.has(id))) result.push(id);
    }
    return result;
  }

  /**
   * Itération sans allocation par entité : le chemin chaud des systèmes.
   * Les composants sont passés en arguments dans l'ordre des types demandés.
   */
  each<const T extends readonly ComponentType<unknown>[]>(
    types: T,
    visit: (entity: EntityId, ...components: ComponentValues<T>) => void,
  ): void {
    const smallest = this.smallestStore(types);
    if (!smallest) return;

    const stores = types.map((type) => this.storeOf(type));
    const values = new Array<unknown>(types.length);

    // `ids()` renvoie le tableau interne : une mutation pendant l'itération remplacera ce
    // tableau plutôt que de le modifier, la boucle courante reste donc cohérente.
    for (const entity of smallest.store.ids()) {
      let complete = true;
      for (let i = 0; i < stores.length; i++) {
        const value = (stores[i] as ComponentStore<unknown>).get(entity);
        if (value === undefined) {
          complete = false;
          break;
        }
        values[i] = value;
      }
      if (complete) {
        (visit as (entity: EntityId, ...components: unknown[]) => void)(entity, ...values);
      }
    }
  }

  /** Vue debug d'une entité : nom de composant → valeur. */
  describeEntity(entity: EntityId): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const store of this.stores.values()) {
      const value = store.get(entity);
      if (value !== undefined) result[store.name] = value;
    }
    return result;
  }

  stats(): EntityManagerStats {
    let componentInstanceCount = 0;
    for (const store of this.stores.values()) componentInstanceCount += store.size;
    return {
      entityCount: this.alive.size,
      componentTypeCount: this.stores.size,
      componentInstanceCount,
    };
  }

  clear(): void {
    this.alive.clear();
    for (const store of this.stores.values()) store.clear();
  }

  /* ---------------------------------------------------------------- */

  private storeOf<T>(type: ComponentType<T>): ComponentStore<T> {
    let store = this.stores.get(type.index);
    if (!store) {
      store = new ComponentStore<unknown>(type.name);
      this.stores.set(type.index, store);
    }
    return store as ComponentStore<T>;
  }

  /** Le store le plus petit pilote l'itération : c'est lui qui borne le coût. */
  private smallestStore(
    types: readonly ComponentType<unknown>[],
  ): { store: ComponentStore<unknown> } | undefined {
    let smallest: ComponentStore<unknown> | undefined;
    for (const type of types) {
      const store = this.storeOf(type);
      if (store.size === 0) return undefined;
      if (!smallest || store.size < smallest.size) smallest = store;
    }
    return smallest ? { store: smallest } : undefined;
  }
}
