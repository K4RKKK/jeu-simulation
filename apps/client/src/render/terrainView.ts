import * as THREE from 'three';
import type { WorldGenerationMetadata } from '@civ/shared';
import type { LoadedChunk } from '../world/chunkStore.js';
import { colorForMode, type TerrainColorMode } from './terrainColorModes.js';

export class TerrainView {
  public readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshLambertMaterial;

  constructor(
    private readonly chunk: LoadedChunk,
    metadata: WorldGenerationMetadata,
    colorMode: TerrainColorMode,
  ) {
    this.geometry = this.buildGeometry(chunk, metadata.chunkSizeMeters);
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'terrain';
    this.mesh.userData.chunkKey = chunk.key;

    this.applyColorMode(colorMode, metadata);
  }

  public applyColorMode(mode: TerrainColorMode, metadata: WorldGenerationMetadata): void {
    const colors = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const terrain = this.chunk.terrain;
    const count = colors.count;
    const target = new THREE.Color();

    for (let i = 0; i < count; i++) {
      colorForMode(mode, terrain, i, metadata, target);
      colors.setXYZ(i, target.r, target.g, target.b);
    }
    colors.needsUpdate = true;
  }

  public setWetness(wetness01: number): void {
    const shade = 1 - THREE.MathUtils.clamp(wetness01, 0, 1) * 0.22;
    this.material.color.setRGB(shade, shade, shade);
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  private buildGeometry(chunk: LoadedChunk, chunkSizeMeters: number): THREE.BufferGeometry {
    const resolution = chunk.terrain.resolution;
    const side = resolution + 1;
    const step = chunkSizeMeters / resolution;
    const count = side * side;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let row = 0; row < side; row++) {
      for (let column = 0; column < side; column++) {
        const index = row * side + column;
        positions[index * 3] = column * step;
        positions[index * 3 + 1] = chunk.terrain.heights[index] as number;
        positions[index * 3 + 2] = row * step;
      }
    }

    const indices = new Uint32Array(resolution * resolution * 6);
    let offset = 0;
    for (let row = 0; row < resolution; row++) {
      for (let column = 0; column < resolution; column++) {
        const a = row * side + column;
        const b = a + 1;
        const c = a + side;
        const d = c + 1;
        indices[offset++] = a;
        indices[offset++] = c;
        indices[offset++] = b;
        indices[offset++] = b;
        indices[offset++] = c;
        indices[offset++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
}
