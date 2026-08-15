import type { ChunkData, ResourceSpawn } from '@civ/procedural';

/**
 * WorldDelta — écarts persistants entre le monde procédural et le monde vécu.
 *
 * Modèle architectural :
 *
 *     état réel = base procédurale + WorldDelta
 *
 * Les ressources procédurales sont statiques (arbres, rochers…). Lorsqu'un humain
 * interagit avec l'une d'elles, elle peut être modifiée (`modified`), épuisée
 * (`depleted`) ou définitivement supprimée (`removed`). Ces mutations sont l'unique
 * source de vérité persistante ; on ne sauvegarde jamais l'intégralité du monde, on
 * sauvegarde ces deltas.
 *
 * Note : les événements réseau récents (« ce buisson vient d'être cueilli ») sont
 * portés par un journal séparé (`WorldChangeJournal`) — le journal se vide à chaque
 * lecture et n'appartient pas à l'état persistant. Cette séparation résout un bug
 * historique : deux sources de vérité (`WorldModifications` pour le réseau,
 * `WorldDelta` pour la persistance) auraient fini par diverger.
 */

/** État d'une ressource modifiée — générique pour supporter de futurs champs sans refactoring. */
export interface ResourceDelta {
  /** Identifiant stable de la ressource (attribué à la génération procédurale). */
  readonly resourceId: string;
  /**
   * Chunk auquel appartient cette ressource — sert à faire avancer UNIQUEMENT la
   * révision de CE chunk (voir `resourceRevision`), jamais un compteur global. Stocké
   * une fois pour toutes (l'appartenance d'une ressource à un chunk ne change jamais) :
   * `restore()` n'a ainsi pas besoin qu'on la lui rappelle.
   */
  readonly ownerChunkKey: string;
  /**
   * Adresse locale du spawn dans son chunk propriétaire — même valeur que
   * `ResourceSpawn.localId`. Dupliquée ici (plutôt que recherchée dans le chunk à chaque
   * fois) pour que tout consommateur d'un `ResourceDelta` seul (reconstruction de
   * `ChunkPayload.resourceStates`, futur `RegionDynamicStats`…) ait l'adresse réseau sans
   * devoir retrouver le spawn correspondant par `resourceId`.
   */
  readonly localId: number;
  /**
   * État sémantique de la ressource.
   * - `modified` : partiellement altérée (coupage en cours, dégâts partiels…)
   * - `depleted` : entièrement consommée (buisson cueilli, mine épuisée…)
   * - `removed`  : supprimée définitivement sans reste exploitable
   */
  state: 'modified' | 'depleted' | 'removed';
  /**
   * Champs modifiés. Chaque clé est un nom de propriété de la ressource ; la valeur est son
   * état actuel. Ce dictionnaire est intentionnellement générique pour supporter des
   * propriétés futures (growthStage, burnState, disease…) sans modifier le schéma.
   */
  changedFields: Record<string, number | string | boolean>;
  /** Tick de simulation auquel cette modification a eu lieu (pour debug et TTL futur). */
  lastModifiedTick: number;
}

export interface TrailChunkDelta {
  readonly chunkKey: string;
  readonly resolution: number;
  readonly cells: Array<readonly [number, number]>;
}

/**
 * Accumulateur des modifications persistantes du monde — source de vérité unique.
 * Voir `WorldChangeJournal` pour les événements réseau récents.
 */
export class WorldDelta {
  private readonly deltas = new Map<string, ResourceDelta>();
  private readonly trails = new Map<
    string,
    { resolution: number; wear: Float32Array; revision: number }
  >();
  /**
   * Révision des ressources, PAR CHUNK — jamais un compteur global (voir
   * `resourceRevision`, qui documente le bug que ce découpage corrige : la
   * granularité par chunk existait déjà pour les sentiers, elle est maintenant
   * étendue aux ressources).
   */
  private readonly resourceRevisions = new Map<string, number>();
  private goneCount = 0;

  // ---- Lecture --------------------------------------------------------

  get size(): number {
    return this.deltas.size;
  }

  /** Ressources dont l'état est `depleted` ou `removed` — utile pour le filtrage rapide. */
  get depletedOrRemovedCount(): number {
    return this.goneCount;
  }

  /**
   * Numéro monotone incrémenté à chaque mutation touchant les ressources DE CE CHUNK
   * — jamais un compteur global. Sert de « clé de fraîcheur » : `ChunkManager`
   * mémorise la revision du chunk au moment où il a produit son payload, puis peut se
   * contenter de comparer `delta.resourceRevision(key) === myRevision` pour savoir si
   * son résultat est encore valide — sans balayer les ressources d'AUCUN chunk.
   *
   * Bug corrigé (première version) : un unique compteur global était incrémenté par
   * toute mutation, ressource OU sentier confondus. Chaque pas d'un humain n'importe
   * où dans le monde faisait croire à TOUS les chunks actifs qu'une ressource avait
   * peut-être changé, déclenchant un balayage `resources.some(isDepleted)` à chaque
   * appel de `payloadFor` pour CHACUN d'eux — avec des centaines d'humains en
   * mouvement et des dizaines de chunks actifs, ce faux partage annulait l'intérêt
   * même de la mise en cache. Un compteur par chunk, symétrique à `trailRevision`,
   * élimine le balayage : la révision EST déjà la réponse à « ce chunk a-t-il changé
   * », pas un simple indice qui oblige à revérifier.
   */
  resourceRevision(chunkKey: string): number {
    return this.resourceRevisions.get(chunkKey) ?? 0;
  }

  private bumpResourceRevision(chunkKey: string): void {
    this.resourceRevisions.set(chunkKey, (this.resourceRevisions.get(chunkKey) ?? 0) + 1);
  }

  has(resourceId: string): boolean {
    return this.deltas.has(resourceId);
  }

  get(resourceId: string): Readonly<ResourceDelta> | undefined {
    return this.deltas.get(resourceId);
  }

  entries(): IterableIterator<[string, ResourceDelta]> {
    return this.deltas.entries();
  }

  trailGrid(chunkKey: string, resolution: number): Float32Array {
    const existing = this.trails.get(chunkKey);
    if (!existing || existing.resolution !== resolution) {
      return new Float32Array(resolution * resolution);
    }
    return Float32Array.from(existing.wear);
  }

  trailRevision(chunkKey: string): number {
    return this.trails.get(chunkKey)?.revision ?? 0;
  }

  /** Résumé macro d'un sentier, sans exposer ni recopier sa grille dense. */
  trailStats(chunkKey: string): { wornCellCount: number; totalWear01: number } {
    const trail = this.trails.get(chunkKey);
    if (!trail) return { wornCellCount: 0, totalWear01: 0 };
    let wornCellCount = 0;
    let totalWear01 = 0;
    for (const wear of trail.wear) {
      if (wear <= 0) continue;
      wornCellCount++;
      totalWear01 += wear;
    }
    return { wornCellCount, totalWear01 };
  }

  /**
   * Cellules d'usure visible (0-255), sous forme creuse — jamais la grille dense
   * entière. Court-circuite immédiatement (sans itérer un seul octet) pour l'immense
   * majorité des chunks : ceux qu'aucun humain n'a jamais foulés n'ont pas d'entrée
   * dans `trails`. C'est cette représentation, et non `trailGrid`, qui doit alimenter
   * le réseau — un sentier n'occupe presque jamais toute la surface d'un chunk.
   */
  trailSparseCells(chunkKey: string, resolution: number): { index: number; wear: number }[] {
    const trail = this.trails.get(chunkKey);
    if (!trail || trail.resolution !== resolution) return [];
    const cells: { index: number; wear: number }[] = [];
    for (let i = 0; i < trail.wear.length; i++) {
      const byte = Math.round((trail.wear[i] as number) * 255);
      if (byte > 0) cells.push({ index: i, wear: byte });
    }
    return cells;
  }

  /** Ajoute une usure et retourne sa valeur si l'octet transmis au rendu a changé. */
  addTrailWear(
    chunkKey: string,
    resolution: number,
    cellIndex: number,
    amount: number,
  ): number | null {
    if (amount <= 0 || cellIndex < 0 || cellIndex >= resolution * resolution) return null;
    let trail = this.trails.get(chunkKey);
    if (!trail || trail.resolution !== resolution) {
      trail = { resolution, wear: new Float32Array(resolution * resolution), revision: 0 };
      this.trails.set(chunkKey, trail);
    }
    const previous = trail.wear[cellIndex] as number;
    const next = Math.min(1, previous + amount);
    if (next === previous) return null;
    trail.wear[cellIndex] = next;
    if (Math.round(previous * 255) === Math.round(next * 255)) return null;
    // Uniquement la révision DU CHUNK concerné — jamais le compteur global des
    // ressources (voir la note sur `revision` plus haut : c'est exactement le bug
    // corrigé, ne pas le réintroduire).
    trail.revision++;
    return next;
  }

  // ---- Écriture -------------------------------------------------------

  /** Enregistre un état partiel pour une ressource (fusion des champs si déjà présente). */
  patch(
    resourceId: string,
    ownerChunkKey: string,
    localId: number,
    changedFields: Record<string, number | string | boolean>,
    currentTick: number,
  ): void {
    const existing = this.deltas.get(resourceId);
    if (existing) {
      // Une ressource passée de gone → modified redevient présente (cas rare mais légal).
      if (existing.state !== 'modified') this.goneCount--;
      existing.state = 'modified';
      Object.assign(existing.changedFields, changedFields);
      existing.lastModifiedTick = currentTick;
    } else {
      this.deltas.set(resourceId, {
        resourceId,
        ownerChunkKey,
        localId,
        state: 'modified',
        changedFields: { ...changedFields },
        lastModifiedTick: currentTick,
      });
    }
    this.bumpResourceRevision(ownerChunkKey);
  }

  /** Marque une ressource comme entièrement épuisée (buisson cueilli, mine vidée…). */
  markDepleted(
    resourceId: string,
    ownerChunkKey: string,
    localId: number,
    currentTick: number,
  ): void {
    const existing = this.deltas.get(resourceId);
    if (existing) {
      if (existing.state === 'modified') this.goneCount++;
      existing.state = 'depleted';
      existing.lastModifiedTick = currentTick;
    } else {
      this.deltas.set(resourceId, {
        resourceId,
        ownerChunkKey,
        localId,
        state: 'depleted',
        changedFields: {},
        lastModifiedTick: currentTick,
      });
      this.goneCount++;
    }
    this.bumpResourceRevision(ownerChunkKey);
  }

  /** Marque une ressource comme définitivement supprimée sans reste exploitable. */
  markRemoved(
    resourceId: string,
    ownerChunkKey: string,
    localId: number,
    currentTick: number,
  ): void {
    const existing = this.deltas.get(resourceId);
    if (existing) {
      if (existing.state === 'modified') this.goneCount++;
      existing.state = 'removed';
      existing.lastModifiedTick = currentTick;
    } else {
      this.deltas.set(resourceId, {
        resourceId,
        ownerChunkKey,
        localId,
        state: 'removed',
        changedFields: {},
        lastModifiedTick: currentTick,
      });
      this.goneCount++;
    }
    this.bumpResourceRevision(ownerChunkKey);
  }

  /** Retire tout delta pour une ressource (régénération, restauration explicite). */
  restore(resourceId: string): void {
    const existing = this.deltas.get(resourceId);
    if (!existing) return;
    if (existing.state !== 'modified') this.goneCount--;
    this.deltas.delete(resourceId);
    this.bumpResourceRevision(existing.ownerChunkKey);
  }

  // ---- Requêtes utilitaires -------------------------------------------

  isAlive(resourceId: string): boolean {
    const delta = this.deltas.get(resourceId);
    return delta === undefined || delta.state === 'modified';
  }

  isDepleted(resourceId: string): boolean {
    const delta = this.deltas.get(resourceId);
    return delta?.state === 'depleted' || delta?.state === 'removed';
  }

  // ---- Application aux chunks ----------------------------------------

  /**
   * Applique les mutations à un chunk fraîchement généré : les ressources `depleted` et
   * `removed` sont filtrées. Aucune allocation si rien n'a été mutée dans ce chunk.
   * (Les mutations `modified` ne changent pas encore la géométrie du spawn ; elles
   * traduiront leur effet quand la promotion en entité ECS existera.)
   */
  apply(chunk: ChunkData): ChunkData {
    if (this.goneCount === 0) return chunk;
    let changed = false;
    const kept: ResourceSpawn[] = [];
    for (const spawn of chunk.resources) {
      if (this.isDepleted(spawn.id)) {
        changed = true;
        continue;
      }
      kept.push(spawn);
    }
    return changed ? { ...chunk, resources: kept } : chunk;
  }

  // ---- Persistance ----------------------------------------------------

  toJSON(): { deltas: ResourceDelta[]; trails: TrailChunkDelta[] } {
    return {
      deltas: [...this.deltas.values()].sort((a, b) => a.resourceId.localeCompare(b.resourceId)),
      trails: [...this.trails.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([chunkKey, trail]) => ({
          chunkKey,
          resolution: trail.resolution,
          cells: [...trail.wear.entries()]
            .filter(([, wear]) => wear > 0)
            .map(([index, wear]) => [index, wear] as const),
        })),
    };
  }

  restoreFrom(state: {
    deltas: readonly ResourceDelta[];
    trails?: readonly TrailChunkDelta[];
  }): void {
    this.deltas.clear();
    this.trails.clear();
    this.resourceRevisions.clear();
    this.goneCount = 0;
    for (const delta of state.deltas) {
      const copy: ResourceDelta = { ...delta, changedFields: { ...delta.changedFields } };
      this.deltas.set(delta.resourceId, copy);
      if (copy.state !== 'modified') this.goneCount++;
      // Un seul cran par chunk touché suffit : rien ne lit encore une valeur précise
      // de `resourceRevision` à ce stade (`ChunkManager` reconstruit ses entrées à
      // neuf après un chargement), seule l'existence d'une révision ≠ 0 compte.
      this.bumpResourceRevision(delta.ownerChunkKey);
    }
    for (const saved of state.trails ?? []) {
      const wear = new Float32Array(saved.resolution * saved.resolution);
      for (const [index, value] of saved.cells) {
        if (index >= 0 && index < wear.length) wear[index] = Math.max(0, Math.min(1, value));
      }
      this.trails.set(saved.chunkKey, { resolution: saved.resolution, wear, revision: 1 });
    }
  }
}

/**
 * Journal des changements récents à diffuser au réseau.
 *
 * Distinct du `WorldDelta` : le delta est l'état persistant, le journal est le flux
 * volatile qui alimente les paquets réseau. Vidé à chaque lecture par le serveur.
 */
export interface RecentResourceRemoval {
  readonly resourceId: string;
  readonly ownerChunkKey: string;
  /** Adresse locale de la ressource dans son chunk — clé compacte des messages réseau. */
  readonly localId: number;
  readonly x: number | null;
  readonly z: number | null;
  readonly tick: number;
}

export interface RecentTrailChange {
  readonly chunkKey: string;
  readonly resolution: number;
  readonly cellIndex: number;
  readonly wear01: number;
}

/** Récolte partielle d'une ressource à plusieurs portions — voir `World.harvestResource`. */
export interface RecentResourceUpdate {
  readonly resourceId: string;
  readonly ownerChunkKey: string;
  readonly localId: number;
  readonly changedFields: Record<string, number | string | boolean>;
  readonly tick: number;
}

/** Ressource procédurale redevenue disponible après récupération écologique. */
export interface RecentResourceAddition {
  readonly resourceId: string;
  readonly ownerChunkKey: string;
  readonly localId: number;
  readonly changedFields: Record<string, number | string | boolean>;
  readonly tick: number;
}

export class WorldChangeJournal {
  private removals: RecentResourceRemoval[] = [];
  private readonly trailChanges = new Map<string, RecentTrailChange>();
  private readonly resourceUpdates = new Map<string, RecentResourceUpdate>();
  private readonly resourceAdditions = new Map<string, RecentResourceAddition>();

  pushRemoval(entry: RecentResourceRemoval): void {
    this.removals.push(entry);
  }

  /** Événements accumulés depuis la dernière lecture — vidés. */
  consumeRemovals(): RecentResourceRemoval[] {
    if (this.removals.length === 0) return [];
    const drained = this.removals;
    this.removals = [];
    return drained;
  }

  pushTrailChange(entry: RecentTrailChange): void {
    this.trailChanges.set(`${entry.chunkKey}:${entry.cellIndex}`, entry);
  }

  consumeTrailChanges(): RecentTrailChange[] {
    const changes = [...this.trailChanges.values()];
    this.trailChanges.clear();
    return changes;
  }

  /**
   * Clé = `resourceId` : une même ressource récoltée deux fois avant la prochaine
   * diffusion ne part qu'une fois, avec son état le plus récent — même dédoublonnage
   * que `pushTrailChange`.
   */
  pushResourceUpdate(entry: RecentResourceUpdate): void {
    this.resourceUpdates.set(entry.resourceId, entry);
  }

  consumeResourceUpdates(): RecentResourceUpdate[] {
    const updates = [...this.resourceUpdates.values()];
    this.resourceUpdates.clear();
    return updates;
  }

  pushResourceAddition(entry: RecentResourceAddition): void {
    this.resourceAdditions.set(entry.resourceId, entry);
  }

  consumeResourceAdditions(): RecentResourceAddition[] {
    const additions = [...this.resourceAdditions.values()];
    this.resourceAdditions.clear();
    return additions;
  }

  get pendingCount(): number {
    return this.removals.length;
  }
}
