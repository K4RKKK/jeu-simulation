import * as THREE from 'three';
import type { WorldGenerationMetadata } from '@civ/shared';
import { colorForMode, type TerrainColorMode } from '../render/terrainColorModes.js';
import type { ChunkStore } from '../world/chunkStore.js';

const PIXELS_PER_CHUNK = 9;

/**
 * Aperçu 2D du monde.
 *
 * Vue de dessus des chunks reçus, dessinée avec le même calque de couleur que la scène 3D.
 * Elle répond à une question que la vue 3D masque : à quoi ressemble la *région* ? Voir
 * d'un coup où passent les rivières et comment se répartissent les biomes vaut des heures
 * de survol.
 *
 * Elle n'affiche que les chunks reçus : c'est aussi un contrôle visuel du streaming.
 */
export class WorldMinimap {
  private readonly context: CanvasRenderingContext2D;
  private readonly color = new THREE.Color();
  private metadata: WorldGenerationMetadata | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Minimap: contexte 2D indisponible');
    this.context = context;
  }

  setMetadata(metadata: WorldGenerationMetadata): void {
    this.metadata = metadata;
    const side = metadata.sizeChunks * PIXELS_PER_CHUNK;
    this.canvas.width = side;
    this.canvas.height = side;
  }

  draw(store: ChunkStore, mode: TerrainColorMode, camera: { x: number; z: number }): void {
    const metadata = this.metadata;
    if (!metadata) return;

    this.context.fillStyle = '#161b1e';
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (const chunk of store.values()) {
      const resolution = chunk.terrain.resolution;
      const side = resolution + 1;
      const originPx = (chunk.coordinate.x - metadata.minChunk) * PIXELS_PER_CHUNK;
      const originPz = (chunk.coordinate.z - metadata.minChunk) * PIXELS_PER_CHUNK;
      const step = resolution / PIXELS_PER_CHUNK;

      for (let py = 0; py < PIXELS_PER_CHUNK; py++) {
        for (let px = 0; px < PIXELS_PER_CHUNK; px++) {
          const column = Math.min(resolution, Math.round(px * step));
          const row = Math.min(resolution, Math.round(py * step));
          const vertex = row * side + column;

          // L'eau prime sur le calque courant : sans cela, les rivières disparaissent dès
          // qu'on regarde la fertilité, et l'aperçu perd son principal repère.
          const waterHeight = chunk.terrain.waterHeights[vertex] as number;
          if (!Number.isNaN(waterHeight)) this.color.set('#3f6f92');
          else colorForMode(mode, chunk.terrain, vertex, metadata, this.color);

          this.context.fillStyle = `#${this.color.getHexString()}`;
          this.context.fillRect(originPx + px, originPz + py, 1, 1);
        }
      }
    }

    const cameraPx = (camera.x - metadata.minChunk) * PIXELS_PER_CHUNK;
    const cameraPz = (camera.z - metadata.minChunk) * PIXELS_PER_CHUNK;
    this.context.strokeStyle = '#f0c46a';
    this.context.lineWidth = 1;
    this.context.strokeRect(cameraPx - 1, cameraPz - 1, PIXELS_PER_CHUNK + 2, PIXELS_PER_CHUNK + 2);
  }
}
