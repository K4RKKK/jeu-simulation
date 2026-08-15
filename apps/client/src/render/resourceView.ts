import * as THREE from 'three';
import type { ResourceDescriptor, WorldGenerationMetadata } from '@civ/shared';
import type { LoadedChunk } from '../world/chunkStore.js';
import { instanceTint } from './instanceTint.js';
import { variantForRotation } from './resourceVariant.js';
import type { ResourceGeometry, ResourceShapeFactory } from './resourceShapes.js';
import { seasonFoliageTint, type Season } from './seasonFoliage.js';

const UP = new THREE.Vector3(0, 1, 0);
const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
/** Teinte vers laquelle une ressource récoltée dérive à mesure qu'il n'en reste plus —
 * un vert-brun séché, cohérent avec la palette terreuse déjà utilisée par les sentiers. */
const HARVESTED_COLOR = new THREE.Color('#8a7350');

export class ResourceView {
  public readonly group = new THREE.Group();

  private readonly instanced: { mesh: THREE.InstancedMesh; detailOnly: boolean }[] = [];
  private readonly foliage: { mesh: THREE.InstancedMesh; tints: Float32Array }[] = [];
  /**
   * Correspondance `localId → (mesh, slot, couleur d'origine)` : le serveur adresse les
   * ressources par `(chunkKey, localId)` dans les deltas réseau, il faut donc pouvoir
   * retrouver instantanément l'instance à cacher ou muter sans balayer toutes les
   * positions. `baseColor` est la teinte de départ (avant toute récolte) — nécessaire
   * pour calculer une teinte récoltée cohérente à chaque mise à jour plutôt que
   * d'assombrir une couleur déjà assombrie par une mise à jour précédente.
   */
  private readonly byLocalId = new Map<
    number,
    { mesh: THREE.InstancedMesh; slot: number; baseColor: THREE.Color; baseMatrix: THREE.Matrix4 }
  >();
  private readonly removedLocalIds = new Set<number>();

  constructor(chunk: LoadedChunk, metadata: WorldGenerationMetadata, shapes: ResourceShapeFactory) {
    this.buildResources(chunk, metadata, shapes);
  }

  public setDetailVisible(visible: boolean): void {
    for (const entry of this.instanced) {
      if (entry.detailOnly) entry.mesh.visible = visible;
    }
  }

  public applySeason(season: Season): void {
    const tint = seasonFoliageTint(season, true);
    for (const entry of this.foliage) {
      const attribute = entry.mesh.instanceColor as THREE.InstancedBufferAttribute;
      for (let i = 0; i < entry.tints.length; i += 3) {
        attribute.array[i] = (entry.tints[i] as number) * tint.r;
        attribute.array[i + 1] = (entry.tints[i + 1] as number) * tint.g;
        attribute.array[i + 2] = (entry.tints[i + 2] as number) * tint.b;
      }
      attribute.needsUpdate = true;
    }
  }

  /**
   * Cache l'instance dont l'adresse locale (dans ce chunk) est `localId`.
   * Retourne `true` si l'instance a été trouvée et cachée, `false` sinon (déjà retirée,
   * ou localId inconnu — chunk mal aligné, à ignorer sans planter).
   */
  public removeByLocalId(localId: number): boolean {
    if (this.removedLocalIds.has(localId)) return false;
    const entry = this.byLocalId.get(localId);
    if (!entry) return false;
    this.removedLocalIds.add(localId);
    entry.mesh.setMatrixAt(entry.slot, HIDDEN_MATRIX);
    entry.mesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  /** Réactive un emplacement existant sans agrandir ni reconstruire l'InstancedMesh. */
  public restoreByLocalId(localId: number): boolean {
    if (!this.removedLocalIds.delete(localId)) return false;
    const entry = this.byLocalId.get(localId);
    if (!entry) return false;
    entry.mesh.setMatrixAt(entry.slot, entry.baseMatrix);
    entry.mesh.setColorAt(entry.slot, entry.baseColor);
    entry.mesh.instanceMatrix.needsUpdate = true;
    if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true;
    return true;
  }

  /**
   * Applique une récolte partielle : assombrit l'instance vers `HARVESTED_COLOR`
   * proportionnellement à `1 - remainingFraction01`. Recalculée depuis `baseColor` (la
   * teinte d'origine, jamais celle déjà mutée) à chaque appel — sans ça, des récoltes
   * successives assombriraient une couleur déjà assombrie au lieu de refléter la
   * fraction ABSOLUE restante envoyée par le serveur.
   *
   * Limite assumée : un changement de saison (`applySeason`) réécrit `instanceColor`
   * depuis `tints` pour les essences caduques et efface donc cette teinte au tour
   * suivant — un compromis acceptable, pas un blocage, pour une première version.
   */
  public applyResourceUpdate(
    localId: number,
    changedFields: Readonly<Record<string, number | string | boolean>>,
  ): boolean {
    if (this.removedLocalIds.has(localId)) return false;
    const entry = this.byLocalId.get(localId);
    if (!entry) return false;
    const remaining = changedFields.remainingFraction01;
    if (typeof remaining !== 'number') return false;

    const color = entry.baseColor.clone().lerp(HARVESTED_COLOR, 1 - remaining);
    entry.mesh.setColorAt(entry.slot, color);
    if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true;
    return true;
  }

  public dispose(): void {
    for (const entry of this.instanced) entry.mesh.dispose();
    this.group.clear();
  }

  private buildResources(
    chunk: LoadedChunk,
    metadata: WorldGenerationMetadata,
    shapes: ResourceShapeFactory,
  ): void {
    const byDefinition = new Map<number, number[]>();
    for (let i = 0; i < chunk.resources.count; i++) {
      const index = chunk.resources.definitionIndex[i] as number;
      const list = byDefinition.get(index) ?? [];
      list.push(i);
      byDefinition.set(index, list);
    }

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const euler = new THREE.Euler();

    for (const [definitionIndex, indices] of byDefinition) {
      const descriptor: ResourceDescriptor | undefined = metadata.resources[definitionIndex];
      if (!descriptor) continue;

      const variants = shapes.getVariants(descriptor);
      const byVariant = new Map<number, number[]>();
      for (const i of indices) {
        const variant = variantForRotation(
          chunk.resources.rotation[i as number] as number,
          variants.length,
        );
        const list = byVariant.get(variant) ?? [];
        list.push(i);
        byVariant.set(variant, list);
      }

      for (const [variantIndex, variantIndices] of byVariant) {
        const shape = variants[variantIndex] as ResourceGeometry;
        const mesh = new THREE.InstancedMesh(shape.geometry, shape.material, variantIndices.length);
        mesh.name = `resource-${descriptor.id}`;

        const tints = new Float32Array(variantIndices.length * 3);
        for (let slot = 0; slot < variantIndices.length; slot++) {
          const tint = instanceTint(
            chunk.resources.rotation[variantIndices[slot] as number] as number,
          );
          tints[slot * 3] = tint.r;
          tints[slot * 3 + 1] = tint.g;
          tints[slot * 3 + 2] = tint.b;
        }
        const tintAttribute = new THREE.InstancedBufferAttribute(tints, 3);
        mesh.instanceColor = tintAttribute;
        if (descriptor.visual.deciduous) this.foliage.push({ mesh, tints });

        for (let slot = 0; slot < variantIndices.length; slot++) {
          const i = variantIndices[slot] as number;
          position.set(
            (chunk.resources.x[i] as number) - chunk.originX,
            chunk.resources.y[i] as number,
            (chunk.resources.z[i] as number) - chunk.originZ,
          );
          const rotation = chunk.resources.rotation[i] as number;
          if (descriptor.category === 'tree') {
            // La rotation déterministe transmise par le serveur fournit aussi un petit
            // profil de silhouette : hauteur, largeur et inclinaison cessent de répéter le
            // même arbre sans ajouter un seul octet au protocole.
            const leanX = Math.sin(rotation * 2.31) * 0.045;
            const leanZ = Math.cos(rotation * 1.73) * 0.045;
            quaternion.setFromEuler(euler.set(leanX, rotation, leanZ));
          } else {
            quaternion.setFromAxisAngle(UP, rotation);
          }
          const s = chunk.resources.scale[i] as number;
          if (descriptor.category === 'tree') {
            const crownWidth = 0.9 + (Math.sin(rotation * 3.17) + 1) * 0.5 * 0.2;
            const height = 0.9 + (Math.cos(rotation * 2.63) + 1) * 0.5 * 0.2;
            scale.set(s * crownWidth, s * height, s * (2 - crownWidth));
          } else {
            scale.set(s, s, s);
          }
          matrix.compose(position, quaternion, scale);
          mesh.setMatrixAt(slot, matrix);
          const baseColor = new THREE.Color(
            tints[slot * 3] as number,
            tints[slot * 3 + 1] as number,
            tints[slot * 3 + 2] as number,
          );
          this.byLocalId.set(chunk.resources.localId[i] as number, {
            mesh,
            slot,
            baseColor,
            baseMatrix: matrix.clone(),
          });
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();

        this.group.add(mesh);
        this.instanced.push({ mesh, detailOnly: descriptor.visual.detailOnly });
      }
    }
  }
}
