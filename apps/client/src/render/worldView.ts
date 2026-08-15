import * as THREE from 'three';
import type { EnvironmentSnapshot, WorldGenerationMetadata } from '@civ/shared';
import type { LoadedChunk } from '../world/chunkStore.js';
import { ChunkView } from './chunkView.js';
import { ResourceShapeFactory } from './resourceShapes.js';
import type { TerrainColorMode } from './terrainColorModes.js';

export interface WorldViewOptions {
  /** Distance, en chunks, au-delà de laquelle les petits éléments sont masqués. */
  detailDistanceChunks?: number;
}

/**
 * Vue du monde : l'ensemble des chunks affichés.
 *
 * Trois responsabilités, et rien d'autre — le client ne décide jamais de ce qui existe :
 *
 * - suivre les chunks reçus et retirés, en libérant strictement toute géométrie créée ;
 * - appliquer le calque de couleur courant ;
 * - masquer les petits objets au-delà de la distance de détail.
 */
export class WorldView {
  readonly group = new THREE.Group();
  readonly borders = new THREE.Group();

  private readonly views = new Map<string, ChunkView>();
  private readonly shapes = new ResourceShapeFactory();
  /** Réglable en direct — voir `GraphicsSettings.decorativeDensity` (`OptionsPanel`). */
  private detailDistanceChunks: number;

  private metadata: WorldGenerationMetadata | null = null;
  private colorMode: TerrainColorMode = 'natural';
  private showChunkBorders = false;
  private mapMode = false;
  private season: EnvironmentSnapshot['season'] = 'été';
  private precipitation01 = 0;

  constructor(options: WorldViewOptions = {}) {
    this.detailDistanceChunks = options.detailDistanceChunks ?? 2;
    this.group.add(this.borders);
    this.borders.visible = false;
  }

  setMetadata(metadata: WorldGenerationMetadata): void {
    this.clear();
    this.metadata = metadata;
  }

  get chunkCount(): number {
    return this.views.size;
  }

  /** Maillages de sol : cibles du raycast de l'inspecteur de terrain. */
  get terrainMeshes(): THREE.Object3D[] {
    const meshes: THREE.Object3D[] = [];
    for (const view of this.views.values()) {
      const mesh = view.terrainMesh;
      if (mesh) meshes.push(mesh);
    }
    return meshes;
  }

  add(chunk: LoadedChunk): void {
    if (!this.metadata) return;
    this.remove(chunk.key);

    const view = new ChunkView(chunk, this.metadata, this.shapes, this.colorMode);
    this.views.set(chunk.key, view);
    this.group.add(view.group);
    view.setMapMode(this.mapMode);
    view.applySeason(this.season);
    view.applyWeather(this.precipitation01);
    if (this.showChunkBorders) this.borders.add(this.buildBorder(chunk));
  }

  remove(key: string): void {
    const view = this.views.get(key);
    if (!view) return;
    this.group.remove(view.group);
    view.dispose();
    this.views.delete(key);
    this.rebuildBorders();
  }

  /**
   * Retire visuellement la ressource `(chunkKey, localId)` — adresse compacte livrée par
   * le serveur dans les deltas réseau. Retourne `false` si le chunk n'est pas chargé ou
   * si l'instance a déjà été retirée.
   */
  removeResourceByLocalId(chunkKey: string, localId: number): boolean {
    const view = this.views.get(chunkKey);
    if (!view) return false;
    return view.removeResourceByLocalId(localId);
  }

  restoreResourceByLocalId(chunkKey: string, localId: number): boolean {
    const view = this.views.get(chunkKey);
    if (!view) return false;
    return view.restoreResourceByLocalId(localId);
  }

  /** Récolte partielle d'une ressource : même adressage compact que `removeResourceByLocalId`. */
  updateResourceAppearance(
    chunkKey: string,
    localId: number,
    changedFields: Readonly<Record<string, number | string | boolean>>,
  ): boolean {
    const view = this.views.get(chunkKey);
    if (!view) return false;
    return view.updateResourceAppearance(localId, changedFields);
  }

  updateTrails(chunkKey: string, cells: readonly { index: number; wear: number }[]): void {
    this.views.get(chunkKey)?.updateTrails(cells);
  }

  setColorMode(mode: TerrainColorMode): void {
    if (mode === this.colorMode || !this.metadata) return;
    this.colorMode = mode;
    for (const view of this.views.values()) view.applyColorMode(mode, this.metadata);
  }

  /** Recolore le feuillage caduc quand la saison change (rendu seul : aucune logique). */
  applySeason(season: EnvironmentSnapshot['season']): void {
    if (season === this.season) return;
    this.season = season;
    for (const view of this.views.values()) view.applySeason(season);
  }

  applyWeather(environment: EnvironmentSnapshot): void {
    const precipitation = environment.weather?.precipitation01 ?? 0;
    if (Math.abs(precipitation - this.precipitation01) < 0.02) return;
    this.precipitation01 = precipitation;
    for (const view of this.views.values()) view.applyWeather(precipitation);
  }

  get currentColorMode(): TerrainColorMode {
    return this.colorMode;
  }

  /**
   * Active une lecture cartographique épurée du monde.
   * Terrain, eau et sentiers restent affichés ; chaque chunk masque uniquement ses
   * ressources et sa décoration de sol. Les chunks ajoutés ensuite héritent de l'état.
   */
  setMapMode(enabled: boolean): void {
    if (enabled === this.mapMode) return;
    this.mapMode = enabled;
    for (const view of this.views.values()) view.setMapMode(enabled);
  }

  setChunkBordersVisible(visible: boolean): void {
    this.showChunkBorders = visible;
    this.borders.visible = visible;
    if (visible) this.rebuildBorders();
  }

  /**
   * Change la distance de détail — appliquée au prochain `updateDetail()` (appelé chaque
   * frame par `Application`), pas besoin de forcer un recalcul immédiat ici.
   */
  setDetailDistanceChunks(chunks: number): void {
    this.detailDistanceChunks = chunks;
  }

  /** Applique le LOD : les petits objets ne sont affichés que près de la caméra. */
  updateDetail(cameraChunkX: number, cameraChunkZ: number, now = performance.now()): void {
    for (const view of this.views.values()) {
      const distance = Math.max(
        Math.abs(view.chunk.coordinate.x - cameraChunkX),
        Math.abs(view.chunk.coordinate.z - cameraChunkZ),
      );
      // Une marge d'un chunk empêche les objets de clignoter lorsque la caméra oscille
      // autour d'une frontière de LOD.
      const visible = distance <= this.detailDistanceChunks;
      if (visible || distance > this.detailDistanceChunks + 1) view.setDetailVisible(visible);
      view.updateTransition(now);
    }
  }

  clear(): void {
    for (const key of [...this.views.keys()]) this.remove(key);
    this.metadata = null;
  }

  dispose(): void {
    this.clear();
    this.shapes.dispose();
  }

  private rebuildBorders(): void {
    for (const child of [...this.borders.children]) {
      this.borders.remove(child);
      if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    if (!this.showChunkBorders) return;
    for (const view of this.views.values()) this.borders.add(this.buildBorder(view.chunk));
  }

  private buildBorder(chunk: LoadedChunk): THREE.LineSegments {
    const size = this.metadata?.chunkSizeMeters ?? 64;
    const top = chunk.terrain.maxHeightM + 1;
    const bottom = chunk.terrain.minHeightM - 1;
    const x0 = chunk.originX;
    const z0 = chunk.originZ;
    const x1 = x0 + size;
    const z1 = z0 + size;

    const points = [
      [x0, bottom, z0, x0, top, z0],
      [x1, bottom, z0, x1, top, z0],
      [x0, bottom, z1, x0, top, z1],
      [x1, bottom, z1, x1, top, z1],
      [x0, top, z0, x1, top, z0],
      [x1, top, z0, x1, top, z1],
      [x1, top, z1, x0, top, z1],
      [x0, top, z1, x0, top, z0],
    ].flat();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: '#f0c46a', transparent: true, opacity: 0.35 }),
    );
  }
}
