import * as THREE from 'three';
import type { HumanProfile } from '@civ/shared';

/**
 * Personnage procédural temporaire.
 *
 * Direction artistique : low-poly, formes arrondies, lisible de loin. Aucun asset externe
 * n'est chargé — les proportions sont dérivées des données envoyées par le serveur
 * (taille, sexe, teinte), de sorte que deux individus différents *dans la simulation* se
 * distinguent aussi *à l'écran*.
 *
 * Le rendu par `InstancedMesh` n'est volontairement pas utilisé ici : avec une quinzaine
 * d'individus il n'apporterait rien et empêcherait la variation morphologique. Il
 * deviendra nécessaire pour la végétation et les grandes populations.
 */
export interface HumanAvatar {
  root: THREE.Group;
  update(deltaSeconds: number, speedMps: number): void;
  setDistant(distant: boolean): void;
  setSelected(selected: boolean): void;
  dispose(): void;
}

const SEGMENTS = 8;

export function createHumanAvatar(profile: HumanProfile): HumanAvatar {
  const height = profile.heightM;
  const male = profile.sex === 'male';

  const legLength = height * 0.47;
  const torsoHeight = height * 0.3;
  const headRadius = height * 0.072;
  const limbRadius = height * (male ? 0.038 : 0.034);
  const shoulderWidth = height * (male ? 0.1 : 0.088);
  const hipWidth = height * 0.052;

  const skin = skinColor(profile.tint);
  const cloth = clothColor(profile.tint);

  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];

  const makeMaterial = (color: THREE.Color): THREE.MeshLambertMaterial => {
    const material = new THREE.MeshLambertMaterial({ color, flatShading: true });
    materials.push(material);
    return material;
  };

  const makeCapsule = (radius: number, length: number): THREE.CapsuleGeometry => {
    const geometry = new THREE.CapsuleGeometry(radius, Math.max(0.01, length), 2, SEGMENTS);
    geometries.push(geometry);
    return geometry;
  };

  const skinMaterial = makeMaterial(skin);
  const clothMaterial = makeMaterial(cloth);

  const root = new THREE.Group();
  root.name = `human-${profile.id}`;
  const body = new THREE.Group();
  body.name = 'human-body';
  root.add(body);

  /* Torse */
  const torso = new THREE.Mesh(
    makeCapsule(shoulderWidth * 0.62, torsoHeight * 0.62),
    clothMaterial,
  );
  torso.position.y = legLength + torsoHeight * 0.5;
  body.add(torso);

  /* Tête */
  const headGeometry = new THREE.IcosahedronGeometry(headRadius, 1);
  geometries.push(headGeometry);
  const head = new THREE.Mesh(headGeometry, skinMaterial);
  head.position.y = legLength + torsoHeight + headRadius * 0.85;
  body.add(head);

  /* Membres : chaque membre pivote depuis son attache, pas depuis son centre. */
  const makeLimb = (
    pivotY: number,
    offsetX: number,
    length: number,
    material: THREE.Material,
  ): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(offsetX, pivotY, 0);
    const mesh = new THREE.Mesh(makeCapsule(limbRadius, length * 0.72), material);
    mesh.position.y = -length * 0.5;
    pivot.add(mesh);
    body.add(pivot);
    return pivot;
  };

  const shoulderY = legLength + torsoHeight * 0.88;
  const armLength = height * 0.36;
  const leftArm = makeLimb(shoulderY, -shoulderWidth, armLength, skinMaterial);
  const rightArm = makeLimb(shoulderY, shoulderWidth, armLength, skinMaterial);
  const leftLeg = makeLimb(legLength, -hipWidth, legLength, clothMaterial);
  const rightLeg = makeLimb(legLength, hipWidth, legLength, clothMaterial);

  /* Anneau de sélection */
  const ringGeometry = new THREE.RingGeometry(height * 0.26, height * 0.31, 24);
  ringGeometry.rotateX(-Math.PI / 2);
  geometries.push(ringGeometry);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: '#f0c46a',
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  materials.push(ringMaterial);
  const selectionRing = new THREE.Mesh(ringGeometry, ringMaterial);
  selectionRing.position.y = 0.03;
  selectionRing.visible = false;
  root.add(selectionRing);

  /*
   * Marqueur de lecture lointaine. Sa géométrie reste volontairement simple et un peu
   * plus grande que la tête : elle survit au recul de la caméra sans transformer la
   * population en nuage d'icônes. Comme elle appartient à `root`, elle reste une cible
   * de raycasting lorsque le corps détaillé est masqué.
   */
  const markerBaseColor = cloth.clone().lerp(new THREE.Color('#f1e4c7'), 0.32);
  const markerSelectedColor = new THREE.Color('#f0c46a');
  const markerGeometry = new THREE.OctahedronGeometry(Math.max(0.28, height * 0.17), 0);
  geometries.push(markerGeometry);
  const markerMaterial = new THREE.MeshBasicMaterial({
    color: markerBaseColor,
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
  });
  materials.push(markerMaterial);
  const distantMarker = new THREE.Mesh(markerGeometry, markerMaterial);
  distantMarker.name = 'human-distant-marker';
  distantMarker.position.y = height + Math.max(0.38, height * 0.24);
  distantMarker.rotation.y = Math.PI / 4;
  distantMarker.visible = false;
  root.add(distantMarker);

  let phase = 0;
  const baseTorsoY = torso.position.y;
  const baseHeadY = head.position.y;
  let distant = false;
  let selected = false;

  const applyVisualState = (): void => {
    body.visible = !distant;
    distantMarker.visible = distant;
    selectionRing.visible = selected;
    selectionRing.scale.setScalar(distant ? 2.35 : 1);
    ringMaterial.opacity = distant ? 0.95 : 0.85;
    distantMarker.scale.setScalar(selected ? 1.35 : 1);
    markerMaterial.color.copy(selected ? markerSelectedColor : markerBaseColor);
    markerMaterial.opacity = selected ? 1 : 0.76;
  };

  return {
    root,

    update(deltaSeconds: number, speedMps: number): void {
      // La cadence suit la vitesse réelle : un individu lent fait de petits pas lents.
      const stride = speedMps / Math.max(0.2, height * 0.45);
      phase += deltaSeconds * stride * Math.PI * 2;

      const amplitude = Math.min(0.85, speedMps * 0.55);
      const swing = Math.sin(phase) * amplitude;

      leftLeg.rotation.x = swing;
      rightLeg.rotation.x = -swing;
      leftArm.rotation.x = -swing * 0.7;
      rightArm.rotation.x = swing * 0.7;

      // Léger balancement vertical, sinon la marche paraît glissée.
      const bob = Math.abs(Math.cos(phase)) * amplitude * height * 0.012;
      torso.position.y = baseTorsoY + bob;
      head.position.y = baseHeadY + bob;
    },

    setDistant(value: boolean): void {
      distant = value;
      applyVisualState();
    },

    setSelected(value: boolean): void {
      selected = value;
      applyVisualState();
    },

    dispose(): void {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

/**
 * Les teintes restent terreuses — peaux, fibres, boue : rien n'est teint chimiquement à la
 * préhistoire — mais assez claires pour se détacher nettement du sol vu de haut. La
 * lisibilité prime sur le réalisme colorimétrique.
 */
function skinColor(tint: number): THREE.Color {
  return new THREE.Color().setHSL(0.075, 0.44, 0.48 + tint * 0.16);
}

function clothColor(tint: number): THREE.Color {
  return new THREE.Color().setHSL(0.06 + tint * 0.06, 0.3, 0.28 + tint * 0.14);
}
