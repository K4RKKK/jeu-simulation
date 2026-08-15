import * as THREE from 'three';
import type { WorldGenerationMetadata } from '@civ/shared';
import type { LoadedChunk } from '../world/chunkStore.js';
import { TRAIL_VISIBLE_THRESHOLD } from './trailView.js';

const UP = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const GRASS_CANDIDATES = 190;
const STONE_CANDIDATES = 42;

/**
 * Purely decorative, deterministic client-side ground cover.
 *
 * These instances deliberately have no local id and never enter a chunk payload or the
 * simulation. Their only inputs are already transmitted terrain fields, so hiding the layer
 * has no gameplay consequence.
 */
export class GroundDecorationView {
  public readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  /**
   * Instances d'herbe regroupées par cellule de sentier (même grille que `TrailView` —
   * `chunk.trails.resolution`) : piétiner une cellule fait disparaître toute l'herbe
   * qui s'y trouve. `null` tant qu'aucune herbe n'a été placée dans ce chunk (rien à
   * piétiner, `update` devient un no-op immédiat).
   */
  private grassMesh: THREE.InstancedMesh | null = null;
  private grassPoints: readonly { x: number; z: number }[] = [];
  private readonly grassInstancesByTrailCell = new Map<number, number[]>();
  /**
   * Résolution à laquelle `grassInstancesByTrailCell` a été construit — `0` tant que
   * jamais construit. Un chunk chargé sans usure connue reçoit la résolution
   * sentinelle `1` (voir `ChunkStore`) ; l'index ne peut être bâti correctement
   * qu'une fois la VRAIE résolution connue, ce qui n'arrive qu'à la première mise à
   * jour d'usure réelle (`ChunkStore.applyTrailUpdate` la révèle alors). Reconstruire
   * l'index à ce moment-là, plutôt qu'à la construction, évite de l'indexer sur une
   * grille factice à une seule cellule qui ne correspondrait plus à rien ensuite.
   */
  private grassIndexResolution = 0;
  /**
   * Préfixe de seed mêlé à chaque hash de décoration.
   *
   * Bug corrigé : le hash ne dépendait que de `(chunkX, chunkZ, domaine)`, jamais de la
   * seed du monde ni de `generationVersion`. Deux mondes différents (seeds A et B)
   * produisaient donc le même motif candidat d'herbe/cailloux pour le chunk `0:0` — la
   * filtration par terrain change un peu le résultat final, mais le motif sous-jacent
   * restait identique, une coïncidence visuelle sans rapport avec le contenu réel du
   * monde.
   */
  private readonly seedPrefix: string;

  constructor(chunk: LoadedChunk, metadata: WorldGenerationMetadata) {
    this.group.name = 'ground-decoration';
    this.seedPrefix = `${metadata.seed}:${metadata.generationVersion}`;
    this.buildGrass(chunk, metadata.chunkSizeMeters);
    this.buildStones(chunk, metadata.chunkSizeMeters);
    // Le chunk arrive parfois déjà avec de l'usure connue (résolution réelle dès le
    // tout premier payload, voir `ChunkManager.withTrails`) : l'index peut alors être
    // bâti tout de suite plutôt que d'attendre une mise à jour réseau.
    if (chunk.trails.resolution > 1) this.ensureGrassIndex(chunk, metadata.chunkSizeMeters);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.group.clear();
  }

  private buildGrass(chunk: LoadedChunk, size: number): void {
    const points = this.candidates(chunk, size, GRASS_CANDIDATES, 'grass').filter((point) => {
      const vegetation = fieldAt(chunk, point.x, point.z, size, chunk.terrain.fields.vegetation);
      const moisture = fieldAt(chunk, point.x, point.z, size, chunk.terrain.fields.moisture);
      const slope = fieldAt(chunk, point.x, point.z, size, chunk.terrain.fields.slope);
      const threshold = 0.38 + slope * 0.35 - moisture * 0.08;
      return vegetation > threshold && slope < 0.62;
    });
    if (points.length === 0) return;

    const geometry = crossedGrassGeometry();
    const material = new THREE.MeshLambertMaterial({
      color: '#71894b',
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.25,
    });
    this.grassMesh = this.addInstances(chunk, size, points, geometry, material, 0.16, 0.48);
    this.grassPoints = points;
  }

  private buildStones(chunk: LoadedChunk, size: number): void {
    const points = this.candidates(chunk, size, STONE_CANDIDATES, 'pebble').filter((point) => {
      const rockiness = fieldAt(chunk, point.x, point.z, size, chunk.terrain.fields.rockiness);
      const slope = fieldAt(chunk, point.x, point.z, size, chunk.terrain.fields.slope);
      return rockiness + slope * 0.45 > 0.48;
    });
    if (points.length === 0) return;

    const geometry = new THREE.IcosahedronGeometry(0.16, 0);
    const material = new THREE.MeshLambertMaterial({ color: '#827f75', flatShading: true });
    this.addInstances(chunk, size, points, geometry, material, 0.65, 1.45, true);
  }

  private candidates(
    chunk: LoadedChunk,
    size: number,
    count: number,
    domain: string,
  ): Array<{ x: number; z: number; variation: number }> {
    const result: Array<{ x: number; z: number; variation: number }> = [];
    const seed = hashString(
      `${this.seedPrefix}:${chunk.coordinate.x}:${chunk.coordinate.z}:${domain}`,
    );
    for (let i = 0; i < count; i++) {
      const x = unitHash(seed, i * 3) * size;
      const z = unitHash(seed, i * 3 + 1) * size;
      if (isWaterCell(chunk, x, z, size)) continue;
      result.push({ x, z, variation: unitHash(seed, i * 3 + 2) });
    }
    return result;
  }

  private addInstances(
    chunk: LoadedChunk,
    size: number,
    points: readonly { x: number; z: number; variation: number }[],
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    minScale: number,
    maxScale: number,
    flatten = false,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, points.length);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (let i = 0; i < points.length; i++) {
      const point = points[i] as (typeof points)[number];
      const height = heightAt(chunk, point.x, point.z, size);
      const value = minScale + (maxScale - minScale) * point.variation;
      position.set(point.x, height + (flatten ? value * 0.035 : 0.01), point.z);
      quaternion.setFromAxisAngle(UP, point.variation * Math.PI * 2);
      scale.set(value, flatten ? value * 0.45 : value, value * (0.82 + point.variation * 0.3));
      mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = 'ground-decoration-instances';
    this.group.add(mesh);
    this.meshes.push(mesh);
    this.geometries.push(geometry);
    this.materials.push(material);
    return mesh;
  }

  /**
   * Fait disparaître l'herbe des cellules dont l'usure vient de franchir le seuil de
   * visibilité — jamais l'inverse : l'usure ne décroît pas (pas de repousse), donc une
   * fois trépignée, une touffe reste cachée. `chunk`/`size` servent uniquement à
   * (re)bâtir l'index cellule→instances si la résolution réelle vient d'être révélée
   * (voir `ensureGrassIndex`) ; ils ne sont pas conservés.
   */
  update(
    chunk: LoadedChunk,
    size: number,
    cells: readonly { index: number; wear: number }[],
  ): void {
    if (!this.grassMesh) return;
    this.ensureGrassIndex(chunk, size);
    this.hideWornCells(cells);
  }

  private hideWornCells(cells: readonly { index: number; wear: number }[]): void {
    if (!this.grassMesh) return;
    let changed = false;
    for (const cell of cells) {
      if (cell.wear < TRAIL_VISIBLE_THRESHOLD) continue;
      const instances = this.grassInstancesByTrailCell.get(cell.index);
      if (!instances) continue;
      for (const instanceIndex of instances) this.grassMesh.setMatrixAt(instanceIndex, HIDDEN);
      changed = true;
    }
    if (changed) this.grassMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Associe chaque touffe d'herbe placée à la cellule de sentier (même grille que
   * `TrailView`, à la résolution COURANTE de `chunk.trails`) sous laquelle elle se
   * trouve. No-op si déjà construit à cette résolution exacte — ni à la construction
   * (résolution sentinelle `1`, rien à indexer utilement), ni deux fois pour la même
   * résolution réelle.
   */
  private ensureGrassIndex(chunk: LoadedChunk, size: number): void {
    const resolution = chunk.trails.resolution;
    if (resolution === this.grassIndexResolution || resolution <= 1) return;

    this.grassInstancesByTrailCell.clear();
    const cellSize = size / resolution;
    this.grassPoints.forEach((point, instanceIndex) => {
      const column = Math.min(resolution - 1, Math.floor(point.x / cellSize));
      const row = Math.min(resolution - 1, Math.floor(point.z / cellSize));
      const trailIndex = row * resolution + column;
      const existing = this.grassInstancesByTrailCell.get(trailIndex);
      if (existing) existing.push(instanceIndex);
      else this.grassInstancesByTrailCell.set(trailIndex, [instanceIndex]);
    });
    this.grassIndexResolution = resolution;

    // L'index vient d'apparaître (ou de changer) : applique tout de suite l'usure déjà
    // connue à cette résolution, plutôt que d'attendre la prochaine mise à jour réseau.
    const alreadyWorn: { index: number; wear: number }[] = [];
    for (let i = 0; i < chunk.trails.wear.length; i++) {
      const wear = chunk.trails.wear[i] as number;
      if (wear > 0) alreadyWorn.push({ index: i, wear });
    }
    if (alreadyWorn.length > 0) this.hideWornCells(alreadyWorn);
  }
}

function crossedGrassGeometry(): THREE.BufferGeometry {
  const first = new THREE.PlaneGeometry(0.42, 0.75, 1, 1);
  first.translate(0, 0.375, 0);
  const second = first.clone().rotateY(Math.PI / 2);
  const merged = new THREE.BufferGeometry();
  const a = first.getAttribute('position');
  const b = second.getAttribute('position');
  const positions = new Float32Array((a.count + b.count) * 3);
  positions.set(a.array as Float32Array, 0);
  positions.set(b.array as Float32Array, a.count * 3);
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setIndex([0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]);
  merged.computeVertexNormals();
  first.dispose();
  second.dispose();
  return merged;
}

function isWaterCell(chunk: LoadedChunk, x: number, z: number, size: number): boolean {
  const resolution = chunk.terrain.resolution;
  const column = Math.min(resolution - 1, Math.floor((x / size) * resolution));
  const row = Math.min(resolution - 1, Math.floor((z / size) * resolution));
  const side = resolution + 1;
  const a = row * side + column;
  return [a, a + 1, a + side, a + side + 1].some((index) =>
    Number.isFinite(chunk.terrain.waterHeights[index]),
  );
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

function fieldAt(
  chunk: LoadedChunk,
  x: number,
  z: number,
  size: number,
  field: Uint8Array,
): number {
  const resolution = chunk.terrain.resolution;
  const column = Math.min(resolution, Math.round((x / size) * resolution));
  const row = Math.min(resolution, Math.round((z / size) * resolution));
  return (field[row * (resolution + 1) + column] ?? 0) / 255;
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

function unitHash(seed: number, index: number): number {
  let hash = Math.imul(seed ^ index, 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0xffffffff;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
