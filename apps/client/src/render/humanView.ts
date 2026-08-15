import * as THREE from 'three';
import type { HumanRecord, WorldStore } from '../net/worldStore.js';
import { createHumanAvatar, type HumanAvatar } from './humanMesh.js';

const MARKER_ENTER_DISTANCE = 160;
const MARKER_EXIT_DISTANCE = 145;

/**
 * Représentation visuelle de la population.
 *
 * Le serveur ajoute et retire des humains ; cette vue se contente de suivre. Elle ne
 * conserve aucun état de simulation : chaque frame, elle lit la pose interpolée du store.
 */
export class HumanView {
  readonly group = new THREE.Group();
  private readonly avatars = new Map<number, HumanAvatar>();
  private selectedId: number | null = null;
  private markerMode = false;

  add(record: HumanRecord): void {
    if (this.avatars.has(record.profile.id)) return;
    const avatar = createHumanAvatar(record.profile);
    avatar.root.userData.entityId = record.profile.id;
    avatar.setDistant(this.markerMode);
    this.avatars.set(record.profile.id, avatar);
    this.group.add(avatar.root);
  }

  remove(id: number): void {
    const avatar = this.avatars.get(id);
    if (!avatar) return;
    this.group.remove(avatar.root);
    avatar.dispose();
    this.avatars.delete(id);
    if (this.selectedId === id) this.selectedId = null;
  }

  select(id: number | null): void {
    if (this.selectedId !== null) this.avatars.get(this.selectedId)?.setSelected(false);
    this.selectedId = id;
    if (id !== null) this.avatars.get(id)?.setSelected(true);
  }

  get selection(): number | null {
    return this.selectedId;
  }

  /**
   * Adapte la silhouette globale au recul de la caméra.
   *
   * Une petite hystérésis évite que les corps et marqueurs alternent rapidement lorsque
   * le zoom oscille autour du seuil. Les racines restent présentes dans les deux modes :
   * le raycasting et l'identité des entités ne changent jamais.
   */
  setViewDistance(distance: number): void {
    const markerMode = this.markerMode
      ? distance > MARKER_EXIT_DISTANCE
      : distance >= MARKER_ENTER_DISTANCE;
    if (markerMode === this.markerMode) return;

    this.markerMode = markerMode;
    for (const avatar of this.avatars.values()) avatar.setDistant(markerMode);
  }

  /** Objets candidats au raycasting de sélection. */
  get pickables(): THREE.Object3D[] {
    return [...this.avatars.values()].map((avatar) => avatar.root);
  }

  update(store: WorldStore, now: number, deltaSeconds: number): void {
    for (const record of store.values()) {
      const avatar = this.avatars.get(record.profile.id);
      if (!avatar) continue;

      const pose = store.poseOf(record, now);
      // L'altitude vient du serveur : le client ne cherche jamais le sol lui-même.
      avatar.root.position.set(pose.x, pose.y, pose.z);
      avatar.root.rotation.y = pose.yaw;
      avatar.update(deltaSeconds, pose.speed);
    }
  }

  dispose(): void {
    for (const id of [...this.avatars.keys()]) this.remove(id);
  }
}

/** Remonte la hiérarchie jusqu'à l'objet racine porteur d'un identifiant d'entité. */
export function resolveEntityId(object: THREE.Object3D | null): number | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const id: unknown = current.userData.entityId;
    if (typeof id === 'number') return id;
    current = current.parent;
  }
  return null;
}
