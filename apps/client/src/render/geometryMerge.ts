import * as THREE from 'three';

export interface GeometryPart {
  geometry: THREE.BufferGeometry;
  color: THREE.Color;
  matrix: THREE.Matrix4;
}

/**
 * Fusionne plusieurs primitives en une seule géométrie à couleurs de sommet.
 *
 * Un arbre est un tronc et un feuillage : deux primitives, donc deux `InstancedMesh` si on
 * les garde séparées, et le double d'appels de rendu. Les fusionner en amont — en cuisant
 * la couleur dans les sommets — permet de n'avoir qu'un seul `InstancedMesh` par type de
 * ressource, quelle que soit la complexité de sa forme.
 *
 * Volontairement limité à `position` et `normal`, sans indices : c'est tout ce dont les
 * placeholders low-poly ont besoin, et cela évite de dépendre d'un utilitaire externe.
 */
export function mergeParts(parts: readonly GeometryPart[]): THREE.BufferGeometry {
  const converted = parts.map((part) => {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    geometry.applyMatrix4(part.matrix);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    return { geometry, color: part.color };
  });

  let vertexCount = 0;
  for (const { geometry } of converted) {
    vertexCount += geometry.getAttribute('position').count;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);

  let offset = 0;
  for (const { geometry, color } of converted) {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const count = position.count;

    positions.set(position.array as Float32Array, offset * 3);
    normals.set(normal.array as Float32Array, offset * 3);
    for (let i = 0; i < count; i++) {
      colors[(offset + i) * 3] = color.r;
      colors[(offset + i) * 3 + 1] = color.g;
      colors[(offset + i) * 3 + 2] = color.b;
    }
    offset += count;

    // Les primitives sources ont été clonées : on libère immédiatement les copies.
    geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.computeBoundingSphere();
  return merged;
}
