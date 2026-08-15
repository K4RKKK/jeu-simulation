import * as THREE from 'three';
import type { WorldGenerationMetadata } from '@civ/shared';
import type { LoadedChunk } from '../world/chunkStore.js';
import { createWaterMaterial, disposeWaterMaterial } from './waterShader.js';
import { buildWaterSurface } from './waterGeometry.js';

export class WaterView {
  public readonly mesh: THREE.Mesh | null = null;
  private readonly geometry: THREE.BufferGeometry | null = null;
  private readonly material: THREE.ShaderMaterial | null = null;

  constructor(chunk: LoadedChunk, metadata: WorldGenerationMetadata) {
    if (!chunk.terrain.hasWater) return;

    this.geometry = this.buildGeometry(chunk, metadata.chunkSizeMeters);
    if (!this.geometry) return;

    this.material = createWaterMaterial(
      this.waterColor(chunk, metadata),
      chunk.originX,
      chunk.originZ,
      this.flowRenewal(chunk, metadata),
    );
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'water';
    this.mesh.renderOrder = 1;
  }

  public dispose(): void {
    this.geometry?.dispose();
    if (this.material) disposeWaterMaterial(this.material);
  }

  private buildGeometry(chunk: LoadedChunk, chunkSizeMeters: number): THREE.BufferGeometry | null {
    const data = buildWaterSurface({
      resolution: chunk.terrain.resolution,
      chunkSizeMeters,
      terrainHeights: chunk.terrain.heights,
      waterHeights: chunk.terrain.waterHeights,
    });
    if (!data) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('aDepth', new THREE.BufferAttribute(data.depths, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private waterColor(chunk: LoadedChunk, metadata: WorldGenerationMetadata): THREE.Color {
    const color = new THREE.Color(0);
    let counted = 0;
    for (const index of chunk.waterBodyIndices) {
      const body = metadata.waterBodies[index];
      if (!body) continue;
      color.add(new THREE.Color(body.color));
      counted++;
    }
    return counted === 0 ? new THREE.Color('#3f6f92') : color.multiplyScalar(1 / counted);
  }

  private flowRenewal(chunk: LoadedChunk, metadata: WorldGenerationMetadata): number {
    let total = 0;
    let counted = 0;
    for (const index of chunk.waterBodyIndices) {
      const body = metadata.waterBodies[index];
      if (!body) continue;
      total += body.flowRenewal;
      counted++;
    }
    return counted === 0 ? 0.3 : total / counted;
  }
}
