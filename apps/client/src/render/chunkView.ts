import * as THREE from 'three';
import type { WorldGenerationMetadata } from '@civ/shared';
import type { LoadedChunk } from '../world/chunkStore.js';
import type { TerrainColorMode } from './terrainColorModes.js';
import type { ResourceShapeFactory } from './resourceShapes.js';
import type { Season } from './seasonFoliage.js';
import { TerrainView } from './terrainView.js';
import { WaterView } from './waterView.js';
import { ResourceView } from './resourceView.js';
import { GroundDecorationView } from './groundDecorationView.js';
import { TrailView } from './trailView.js';

export class ChunkView {
  public readonly group = new THREE.Group();

  private readonly terrainView: TerrainView;
  private readonly waterView: WaterView;
  private readonly resourceView: ResourceView;
  private readonly groundDecorationView: GroundDecorationView;
  private detailVisible = true;
  private mapMode = false;
  private readonly appearedAt = performance.now();
  /**
   * `null` tant qu'aucune usure n'existe pour ce chunk — l'immense majorité des chunks
   * chargés, puisque le serveur omet désormais `trails` pour eux (voir
   * `ChunkManager.withTrails`). Construire un `InstancedMesh` (géométrie + matériau +
   * insertion dans le graphe de scène) pour un sentier qui n'existera peut-être jamais
   * serait du travail jeté pour la quasi-totalité des chunks d'un grand monde.
   */
  private trailView: TrailView | null;

  constructor(
    public readonly chunk: LoadedChunk,
    private readonly metadata: WorldGenerationMetadata,
    shapes: ResourceShapeFactory,
    colorMode: TerrainColorMode,
  ) {
    this.group.position.set(chunk.originX, 0, chunk.originZ);
    this.group.name = `chunk-${chunk.key}`;
    this.group.scale.setScalar(0.985);

    this.terrainView = new TerrainView(chunk, metadata, colorMode);
    this.group.add(this.terrainView.mesh);

    this.waterView = new WaterView(chunk, metadata);
    if (this.waterView.mesh) {
      this.group.add(this.waterView.mesh);
    }

    this.resourceView = new ResourceView(chunk, metadata, shapes);
    this.group.add(this.resourceView.group);

    this.groundDecorationView = new GroundDecorationView(chunk, metadata);
    this.group.add(this.groundDecorationView.group);

    // Résolution sentinelle `1` (voir `ChunkStore`) = aucune usure connue à la
    // réception : rien à construire tout de suite, `updateTrails` le fera à la
    // demande, la toute première fois qu'une usure réelle apparaît.
    this.trailView = chunk.trails.resolution > 1 ? new TrailView(chunk, metadata) : null;
    if (this.trailView) this.group.add(this.trailView.mesh);
  }

  public get terrainMesh(): THREE.Object3D | undefined {
    return this.terrainView.mesh;
  }

  public applyColorMode(mode: TerrainColorMode, metadata: WorldGenerationMetadata): void {
    this.terrainView.applyColorMode(mode, metadata);
  }

  public setDetailVisible(visible: boolean): void {
    this.detailVisible = visible;
    this.applyVisibility();
  }

  /** Masque les couches de proximité sans toucher au terrain, à l'eau ni aux sentiers. */
  public setMapMode(enabled: boolean): void {
    this.mapMode = enabled;
    this.applyVisibility();
  }

  public applySeason(season: Season): void {
    this.resourceView.applySeason(season);
  }

  public applyWeather(precipitation01: number): void {
    this.terrainView.setWetness(precipitation01);
  }

  public updateTransition(now: number): void {
    const progress = Math.min(1, (now - this.appearedAt) / 360);
    const eased = 1 - Math.pow(1 - progress, 3);
    this.group.scale.setScalar(0.985 + eased * 0.015);
  }

  public removeResourceByLocalId(localId: number): boolean {
    return this.resourceView.removeByLocalId(localId);
  }

  public restoreResourceByLocalId(localId: number): boolean {
    return this.resourceView.restoreByLocalId(localId);
  }

  public updateResourceAppearance(
    localId: number,
    changedFields: Readonly<Record<string, number | string | boolean>>,
  ): boolean {
    return this.resourceView.applyResourceUpdate(localId, changedFields);
  }

  public updateTrails(cells: readonly { index: number; wear: number }[]): void {
    if (!this.trailView) {
      if (cells.length === 0) return;
      this.trailView = new TrailView(this.chunk, this.metadata);
      this.group.add(this.trailView.mesh);
    }
    this.trailView.update(cells);
    this.groundDecorationView.update(this.chunk, this.metadata.chunkSizeMeters, cells);
  }

  public dispose(): void {
    this.terrainView.dispose();
    this.waterView.dispose();
    this.resourceView.dispose();
    this.groundDecorationView.dispose();
    this.trailView?.dispose();
    this.group.clear();
  }

  private applyVisibility(): void {
    this.resourceView.group.visible = !this.mapMode;
    this.resourceView.setDetailVisible(this.detailVisible && !this.mapMode);
    this.groundDecorationView.setVisible(this.detailVisible && !this.mapMode);
  }
}
