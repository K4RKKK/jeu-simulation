import type { EntityId } from '@civ/shared';

interface IndexedActor {
  readonly entity: EntityId;
  readonly x: number;
  readonly z: number;
}

/**
 * Index spatial éphémère (Phase 3.8) — jamais persisté, jamais hashé, jamais partagé
 * entre ticks. Reconstruit à chaque passe de `SocialObservationSystem` pour éviter la
 * comparaison naïve O(N²) qui deviendrait ingérable dès quelques centaines d'humains.
 *
 * Ne contient QUE les acteurs qui portent actuellement `Transform + ObservableAction` —
 * un observateur n'a pas besoin d'apparaître dans les buckets « acteurs », il interroge
 * l'index avec sa propre position (via son `Transform`) et récupère les acteurs
 * visibles autour. Cela évite d'indexer toute la population.
 *
 * Grille carrée, cellule = `visionRangeM` : la zone d'observation d'un individu
 * (disque de rayon `visionRangeM`) est couverte par au plus 3×3 cellules quel que
 * soit l'endroit où il se trouve dans la sienne.
 *
 * Déterminisme : `forEachNear` itère les cellules dans un ordre stable (dx puis dz de
 * -span à +span) et parcourt chaque bucket dans son ordre d'insertion. L'appelant
 * insère dans l'ordre déterministe de `EntityManager.each` (tri implicite par id).
 * Deux runs identiques produisent donc exactement la même séquence d'inspections.
 *
 * `candidateChecks` : compteur d'inspections exposé UNIQUEMENT pour permettre un test
 * structurel qui prouve la sous-linéarité (pas O(N²)) sans dépendre d'une horloge —
 * un budget temps réel fragile serait rouge aléatoirement sur CI. Un test unitaire
 * doit vérifier que `candidateChecks / N` reste borné même à population dense.
 */
export class SocialSpatialIndex {
  private readonly buckets: Map<string, IndexedActor[]> = new Map();
  private readonly cellSizeM: number;
  candidateChecks = 0;

  constructor(cellSizeM: number) {
    if (cellSizeM <= 0) {
      throw new Error(`SocialSpatialIndex: cellSizeM must be > 0 (got ${cellSizeM})`);
    }
    this.cellSizeM = cellSizeM;
  }

  add(entity: EntityId, x: number, z: number): void {
    const key = this.cellKey(x, z);
    const bucket = this.buckets.get(key);
    if (bucket === undefined) this.buckets.set(key, [{ entity, x, z }]);
    else bucket.push({ entity, x, z });
  }

  /**
   * Appelle `visit(candidate, distanceSquared)` pour chaque acteur indexé RÉELLEMENT
   * dans un disque de rayon `radiusM` autour de `(x, z)`. Ne renvoie rien : l'appelant
   * accumule ce qu'il veut dans une closure. Les acteurs situés dans les cellules
   * voisines mais hors du disque comptent quand même comme `candidateChecks` — c'est
   * le vrai coût de la recherche, qu'un test structurel peut mesurer.
   */
  forEachNear(
    x: number,
    z: number,
    radiusM: number,
    visit: (entity: EntityId, distanceSquared: number) => void,
  ): void {
    if (radiusM < 0) return;
    const cellSpan = Math.max(1, Math.ceil(radiusM / this.cellSizeM));
    const centerCx = Math.floor(x / this.cellSizeM);
    const centerCz = Math.floor(z / this.cellSizeM);
    const radiusSquared = radiusM * radiusM;
    for (let dcx = -cellSpan; dcx <= cellSpan; dcx++) {
      for (let dcz = -cellSpan; dcz <= cellSpan; dcz++) {
        const bucket = this.buckets.get(`${centerCx + dcx}:${centerCz + dcz}`);
        if (bucket === undefined) continue;
        for (const actor of bucket) {
          this.candidateChecks += 1;
          const dx = actor.x - x;
          const dz = actor.z - z;
          const distSq = dx * dx + dz * dz;
          if (distSq <= radiusSquared) visit(actor.entity, distSq);
        }
      }
    }
  }

  /** Nombre de buckets non vides — pour le debug et les tests structurels. */
  get bucketCount(): number {
    return this.buckets.size;
  }

  /** Nombre total d'acteurs indexés — pour le debug et les tests structurels. */
  get size(): number {
    let n = 0;
    for (const bucket of this.buckets.values()) n += bucket.length;
    return n;
  }

  private cellKey(x: number, z: number): string {
    return `${Math.floor(x / this.cellSizeM)}:${Math.floor(z / this.cellSizeM)}`;
  }
}
