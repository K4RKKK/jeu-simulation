import * as THREE from 'three';
import type { WorldGenerationMetadata } from '@civ/shared';
import type { LoadedChunk } from '../world/chunkStore.js';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
/** Exporté pour que `GroundDecorationView` fasse disparaître l'herbe piétinée au même
 * seuil que celui où la trace de terre battue devient visible — un seul seuil perçu. */
export const TRAIL_VISIBLE_THRESHOLD = 8;
const VISIBLE_THRESHOLD = TRAIL_VISIBLE_THRESHOLD;

/** Trace visuelle persistante des passages humains, sans effet sur la simulation. */
export class TrailView {
  public readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2, 0, 0),
  );

  constructor(
    private readonly chunk: LoadedChunk,
    metadata: WorldGenerationMetadata,
  ) {
    const cellSize = metadata.chunkSizeMeters / chunk.trails.resolution;
    this.geometry = new THREE.PlaneGeometry(cellSize * 1.08, cellSize * 1.08);
    this.material = new THREE.MeshLambertMaterial({
      color: '#b89a69',
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      chunk.trails.resolution * chunk.trails.resolution,
    );
    this.mesh.name = 'emergent-trails';
    this.mesh.renderOrder = 2;
    for (let i = 0; i < chunk.trails.wear.length; i++) this.updateCell(i);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }

  update(cells: readonly { index: number; wear: number }[]): void {
    for (const cell of cells) this.updateCell(cell.index);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  private updateCell(index: number): void {
    if (index < 0 || index >= this.chunk.trails.wear.length) return;
    const wear = this.chunk.trails.wear[index] as number;
    if (wear < VISIBLE_THRESHOLD) {
      this.mesh.setMatrixAt(index, HIDDEN);
      return;
    }

    const resolution = this.chunk.trails.resolution;
    const chunkSize = (this.geometry.parameters.width / 1.08) * resolution;
    const cellSize = chunkSize / resolution;
    const column = index % resolution;
    const row = (index - column) / resolution;
    const x = (column + 0.5) * cellSize;
    const z = (row + 0.5) * cellSize;
    const strength = (wear - VISIBLE_THRESHOLD) / (255 - VISIBLE_THRESHOLD);
    this.position.set(x, heightAt(this.chunk, x, z, chunkSize) + 0.035, z);
    this.scale.set(0.72 + strength * 0.28, 0.72 + strength * 0.28, 1);
    this.mesh.setMatrixAt(index, this.matrix.compose(this.position, this.rotation, this.scale));
    this.mesh.setColorAt(
      index,
      new THREE.Color('#bca878').lerp(new THREE.Color('#71583c'), strength),
    );
  }
}

function heightAt(chunk: LoadedChunk, x: number, z: number, size: number): number {
  const resolution = chunk.terrain.resolution;
  const gx = (x / size) * resolution;
  const gz = (z / size) * resolution;
  const column = Math.min(resolution - 1, Math.floor(gx));
  const row = Math.min(resolution - 1, Math.floor(gz));
  const tx = gx - column;
  const tz = gz - row;
  const side = resolution + 1;
  const a = row * side + column;
  const top = lerp(chunk.terrain.heights[a] as number, chunk.terrain.heights[a + 1] as number, tx);
  const bottom = lerp(
    chunk.terrain.heights[a + side] as number,
    chunk.terrain.heights[a + side + 1] as number,
    tx,
  );
  return lerp(top, bottom, tz);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
