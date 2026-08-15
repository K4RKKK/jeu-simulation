/**
 * Registre générique de définitions.
 *
 * Toute famille de contenu (biomes, ressources, profils d'eau…) passe par ce registre
 * plutôt que par une chaîne de `if` (CLAUDE.md : « Data-driven avant tout »). Deux
 * propriétés comptent pour la simulation :
 *
 * - **Ordre stable** : `all()` renvoie toujours les définitions dans l'ordre
 *   d'enregistrement. Un générateur qui itère un registre reste donc déterministe.
 * - **Index stable** : chaque définition reçoit un index numérique utilisé sur le réseau
 *   (transmettre `3` plutôt que `"berry_bush"` dans une grille de 289 valeurs).
 */
export interface Identified {
  readonly id: string;
}

export class Registry<T extends Identified> {
  private readonly byId = new Map<string, T>();
  private readonly order: T[] = [];
  private readonly indexById = new Map<string, number>();

  constructor(readonly name: string) {}

  register(definition: T): T {
    if (this.byId.has(definition.id)) {
      throw new Error(`${this.name}: duplicate definition id "${definition.id}"`);
    }
    this.indexById.set(definition.id, this.order.length);
    this.byId.set(definition.id, definition);
    this.order.push(definition);
    return definition;
  }

  registerAll(definitions: readonly T[]): void {
    for (const definition of definitions) this.register(definition);
  }

  get(id: string): T | undefined {
    return this.byId.get(id);
  }

  getOrThrow(id: string): T {
    const definition = this.byId.get(id);
    if (!definition) throw new Error(`${this.name}: unknown definition "${id}"`);
    return definition;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Index réseau d'une définition, ou -1 si inconnue. */
  indexOf(id: string): number {
    return this.indexById.get(id) ?? -1;
  }

  at(index: number): T | undefined {
    return this.order[index];
  }

  all(): readonly T[] {
    return this.order;
  }

  get size(): number {
    return this.order.length;
  }
}
