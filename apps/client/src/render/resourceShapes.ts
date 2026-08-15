import * as THREE from 'three';
import type { ResourceDescriptor } from '@civ/shared';
import { mergeParts, type GeometryPart } from './geometryMerge.js';

/**
 * Fabrique de formes procédurales pour les ressources.
 *
 * Le client ne connaît **aucune ressource** : il connaît des *formes*. Le serveur lui dit
 * « ceci est un `broadleaf_tree` de 7,5 m, vert foncé sur brun » et cette fabrique produit
 * la géométrie correspondante. Ajouter une ressource au catalogue qui réutilise une forme
 * existante n'exige donc aucune modification ici (règle 1 : le client n'a pas de contenu).
 *
 * Les formes sont volontairement grossières : quelques dizaines de triangles, facettées,
 * lisibles de loin. L'objectif de cette phase est l'architecture, pas la modélisation.
 */
export interface ResourceGeometry {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
}

export class ResourceShapeFactory {
  private readonly cache = new Map<string, ResourceGeometry>();
  private readonly variantCache = new Map<string, readonly ResourceGeometry[]>();
  private readonly material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
  });

  get(descriptor: ResourceDescriptor): ResourceGeometry {
    const cached = this.cache.get(descriptor.id);
    if (cached) return cached;

    const built: ResourceGeometry = {
      geometry: buildGeometry(descriptor),
      material: this.material,
    };
    this.cache.set(descriptor.id, built);
    return built;
  }

  /**
   * Variantes de forme d'une ressource, une par instance.
   *
   * La géométrie d'un InstancedMesh est partagée par toutes ses instances : la seule façon
   * de faire varier la *forme* d'un individu à l'autre est de créer plusieurs variantes et
   * d'attribuer chacune à un sous-ensemble d'instances. Le champignon décline son chapeau
   * (étroit, large, penché) ; les autres formes n'ont qu'une variante et restent inchangées.
   */
  getVariants(descriptor: ResourceDescriptor): readonly ResourceGeometry[] {
    const shape = descriptor.visual.shape;
    if (
      shape !== 'mushroom' &&
      shape !== 'broadleaf_tree' &&
      shape !== 'conifer_tree' &&
      shape !== 'bush'
    ) {
      return [this.get(descriptor)];
    }

    const cached = this.variantCache.get(descriptor.id);
    if (cached) return cached;

    const height = descriptor.visual.heightM;
    const radius = descriptor.visual.radiusM;
    const primary = new THREE.Color(descriptor.visual.primaryColor);
    const secondary = new THREE.Color(
      descriptor.visual.secondaryColor ?? descriptor.visual.primaryColor,
    );

    let variants: ResourceGeometry[];
    if (shape === 'mushroom') {
      variants = MUSHROOM_VARIANTS.map((variant) => ({
        geometry: buildMushroom(height, radius, primary, secondary, variant),
        material: this.material,
      }));
    } else if (shape === 'broadleaf_tree') {
      variants = BROADLEAF_VARIANTS.map((variant) => ({
        geometry: buildBroadleafTree(height, radius, primary, secondary, variant),
        material: this.material,
      }));
    } else if (shape === 'conifer_tree') {
      variants = CONIFER_VARIANTS.map((variant) => ({
        geometry: buildConiferTree(height, radius, primary, secondary, variant),
        material: this.material,
      }));
    } else {
      variants = BUSH_VARIANTS.map((variant) => ({
        geometry: buildBush(height, radius, primary, secondary, variant),
        material: this.material,
      }));
    }
    this.variantCache.set(descriptor.id, variants);
    return variants;
  }

  dispose(): void {
    for (const entry of this.cache.values()) entry.geometry.dispose();
    for (const variants of this.variantCache.values()) {
      for (const variant of variants) variant.geometry.dispose();
    }
    this.cache.clear();
    this.variantCache.clear();
    this.material.dispose();
  }
}

function buildGeometry(descriptor: ResourceDescriptor): THREE.BufferGeometry {
  const height = descriptor.visual.heightM;
  const radius = descriptor.visual.radiusM;
  const primary = new THREE.Color(descriptor.visual.primaryColor);
  const secondary = new THREE.Color(
    descriptor.visual.secondaryColor ?? descriptor.visual.primaryColor,
  );

  switch (descriptor.visual.shape) {
    case 'broadleaf_tree':
      return buildBroadleafTree(
        height,
        radius,
        primary,
        secondary,
        BROADLEAF_VARIANTS[0] as CanopyVariant,
      );

    case 'conifer_tree':
      return buildConiferTree(
        height,
        radius,
        primary,
        secondary,
        CONIFER_VARIANTS[0] as CanopyVariant,
      );

    case 'bush':
      return buildBush(height, radius, primary, secondary, BUSH_VARIANTS[0] as CanopyVariant);

    case 'boulder':
      return mergeParts([blob(radius, height * 0.45, primary, 1.15, 0.65)]);

    case 'shard':
      return mergeParts([
        {
          geometry: new THREE.TetrahedronGeometry(radius, 0),
          color: primary,
          matrix: new THREE.Matrix4().makeScale(1, 0.75, 1.25).setPosition(0, height * 0.45, 0),
        },
      ]);

    case 'tuft':
      return mergeParts(
        [0, 1, 2].map((index) => {
          const angle = (index / 3) * Math.PI * 2;
          return {
            geometry: new THREE.ConeGeometry(radius * 0.3, height, 3, 1),
            color: primary,
            matrix: new THREE.Matrix4()
              .makeRotationZ(0.25 * (index - 1))
              .setPosition(
                Math.cos(angle) * radius * 0.4,
                height * 0.5,
                Math.sin(angle) * radius * 0.4,
              ),
          };
        }),
      );

    case 'mushroom':
      return buildMushroom(height, radius, primary, secondary, {
        capScale: 1,
        capFlat: 0.7,
        tilt: 0,
        stem: 1,
      });

    case 'branch':
      return mergeParts([
        {
          geometry: new THREE.CylinderGeometry(radius * 0.5, radius * 0.35, radius * 8, 5, 1),
          color: primary,
          matrix: new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(0, height * 0.5, 0),
        },
      ]);

    case 'reed':
      return mergeParts(
        [0, 1, 2, 3].map((index) => {
          const angle = (index / 4) * Math.PI * 2;
          return {
            geometry: new THREE.CylinderGeometry(radius * 0.16, radius * 0.24, height, 3, 1),
            color: primary,
            matrix: new THREE.Matrix4()
              .makeRotationZ(0.14 * (index - 1.5))
              .setPosition(
                Math.cos(angle) * radius * 0.5,
                height * 0.5,
                Math.sin(angle) * radius * 0.5,
              ),
          };
        }),
      );

    default:
      // Forme inconnue : un bloc neutre plutôt qu'un plantage. Un contenu ajouté avec une
      // forme non implémentée doit rester visible et signalé, pas casser le rendu.
      console.warn(`[render] forme inconnue "${descriptor.visual.shape}" pour ${descriptor.id}`);
      return mergeParts([blob(radius, height * 0.5, primary, 1, 1)]);
  }
}

function trunk(radius: number, height: number, color: THREE.Color): GeometryPart {
  return {
    geometry: new THREE.CylinderGeometry(radius * 0.8, radius, height, 5, 1),
    color,
    matrix: new THREE.Matrix4().makeTranslation(0, height * 0.5, 0),
  };
}

function cone(
  radius: number,
  height: number,
  y: number,
  color: THREE.Color,
  x = 0,
  z = 0,
): GeometryPart {
  return {
    geometry: new THREE.ConeGeometry(radius, height, 6, 1),
    color,
    matrix: new THREE.Matrix4().makeTranslation(x, y + height * 0.5, z),
  };
}

function blob(
  radius: number,
  y: number,
  color: THREE.Color,
  scaleXZ: number,
  scaleY: number,
  x = 0,
  z = 0,
): GeometryPart {
  return {
    geometry: new THREE.IcosahedronGeometry(radius, 0),
    color,
    matrix: new THREE.Matrix4().makeScale(scaleXZ, scaleY, scaleXZ).setPosition(x, y, z),
  };
}

/**
 * Déclinaison de silhouette pour un feuillage (arbre, buisson) : fait varier l'échelle et
 * le décalage des masses de feuillage d'une instance à l'autre, comme le champignon
 * décline son chapeau — sans quoi chaque essence est un unique moule répété partout.
 */
interface CanopyVariant {
  /** Échelle globale du houppier relative à la définition. */
  readonly canopyScale: number;
  /** Décalage horizontal du sommet du houppier, casse la symétrie verticale. */
  readonly leanX: number;
  readonly leanZ: number;
}

const BROADLEAF_VARIANTS: readonly CanopyVariant[] = [
  { canopyScale: 1, leanX: 0, leanZ: 0 },
  { canopyScale: 1.18, leanX: 0.12, leanZ: -0.08 },
  { canopyScale: 0.86, leanX: -0.1, leanZ: 0.14 },
];

const CONIFER_VARIANTS: readonly CanopyVariant[] = [
  { canopyScale: 1, leanX: 0, leanZ: 0 },
  { canopyScale: 1.14, leanX: 0.08, leanZ: 0.06 },
  { canopyScale: 0.9, leanX: -0.07, leanZ: -0.05 },
];

const BUSH_VARIANTS: readonly CanopyVariant[] = [
  { canopyScale: 1, leanX: 0, leanZ: 0 },
  { canopyScale: 1.22, leanX: 0.1, leanZ: 0.1 },
  { canopyScale: 0.82, leanX: -0.12, leanZ: -0.06 },
];

function buildBroadleafTree(
  height: number,
  radius: number,
  primary: THREE.Color,
  secondary: THREE.Color,
  variant: CanopyVariant,
): THREE.BufferGeometry {
  const s = variant.canopyScale;
  return mergeParts([
    trunk(radius * 0.16, height * 0.5, secondary),
    blob(
      radius * s,
      height * 0.72,
      primary,
      1,
      0.85,
      variant.leanX * radius,
      variant.leanZ * radius,
    ),
    blob(
      radius * 0.62 * s,
      height * 0.92,
      primary,
      1,
      0.8,
      variant.leanX * radius * 1.4,
      variant.leanZ * radius * 1.4,
    ),
  ]);
}

function buildConiferTree(
  height: number,
  radius: number,
  primary: THREE.Color,
  secondary: THREE.Color,
  variant: CanopyVariant,
): THREE.BufferGeometry {
  const s = variant.canopyScale;
  return mergeParts([
    trunk(radius * 0.16, height * 0.34, secondary),
    cone(
      radius * s,
      height * 0.4,
      height * 0.3,
      primary,
      variant.leanX * radius,
      variant.leanZ * radius,
    ),
    cone(
      radius * 0.78 * s,
      height * 0.36,
      height * 0.55,
      primary,
      variant.leanX * radius * 0.6,
      variant.leanZ * radius * 0.6,
    ),
    cone(radius * 0.5 * s, height * 0.3, height * 0.78, primary),
  ]);
}

function buildBush(
  height: number,
  radius: number,
  primary: THREE.Color,
  secondary: THREE.Color,
  variant: CanopyVariant,
): THREE.BufferGeometry {
  const s = variant.canopyScale;
  return mergeParts([
    blob(
      radius * s,
      height * 0.55,
      primary,
      1.1,
      0.8,
      variant.leanX * radius,
      variant.leanZ * radius,
    ),
    blob(
      radius * 0.7 * s,
      height * 0.85,
      secondary,
      1,
      0.75,
      variant.leanX * radius * 0.8,
      variant.leanZ * radius * 0.8,
    ),
  ]);
}

interface MushroomVariant {
  /** Taille du chapeau relative à celle de la définition. */
  readonly capScale: number;
  /** Aplatissement du chapeau : petit = champignon étalé, grand = bombé. */
  readonly capFlat: number;
  /** Inclinaison du chapeau en radians, autour de la jonction avec la tige. */
  readonly tilt: number;
  /** Épaisseur relative de la tige. */
  readonly stem: number;
}

/** Déclinaisons visuelles du champignon : étroit, large et penché. */
const MUSHROOM_VARIANTS: readonly MushroomVariant[] = [
  { capScale: 0.85, capFlat: 0.55, tilt: 0.07, stem: 0.9 },
  { capScale: 1.3, capFlat: 0.45, tilt: -0.06, stem: 0.78 },
  { capScale: 1.0, capFlat: 0.8, tilt: 0.22, stem: 0.95 },
];

function buildMushroom(
  height: number,
  radius: number,
  primary: THREE.Color,
  secondary: THREE.Color,
  variant: MushroomVariant,
): THREE.BufferGeometry {
  const capRadius = radius * variant.capScale;
  const capY = height * 0.6;

  // Le tilt tourne le chapeau autour de la jonction tige/chapeau : translation à la
  // jonction, rotation, translation inverse, puis mise à l'échelle du chapeau.
  const capMatrix = new THREE.Matrix4()
    .makeTranslation(0, capY, 0)
    .multiply(new THREE.Matrix4().makeRotationZ(variant.tilt))
    .multiply(new THREE.Matrix4().makeTranslation(0, -capY, 0))
    .multiply(new THREE.Matrix4().makeScale(1, variant.capFlat, 1));

  return mergeParts([
    {
      geometry: new THREE.CylinderGeometry(
        radius * 0.32 * variant.stem,
        radius * 0.45 * variant.stem,
        height * 0.6,
        5,
        1,
      ),
      color: secondary,
      matrix: new THREE.Matrix4().makeTranslation(0, height * 0.3, 0),
    },
    {
      geometry: new THREE.SphereGeometry(capRadius, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      color: primary,
      matrix: capMatrix,
    },
  ]);
}
