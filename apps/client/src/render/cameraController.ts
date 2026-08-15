import * as THREE from 'three';
import { controlCode } from '../settings/controlSettings.js';

interface CameraLimits {
  minDistance: number;
  maxDistance: number;
  minPolar: number;
  maxPolar: number;
  panLimit: number;
}

/**
 * Caméra d'observation de type « stratégie » : un point visé au sol, une distance, un
 * azimut et une inclinaison.
 *
 * Ce modèle (plutôt qu'une caméra libre) garantit que l'observateur ne se perd jamais :
 * il regarde toujours un endroit du monde, du survol général au suivi d'un individu.
 */
export class CameraController {
  readonly target = new THREE.Vector3(0, 0, 0);
  private distance: number;
  private azimuth = Math.PI * 0.25;
  private polar = Math.PI * 0.32;

  private readonly limits: CameraLimits;
  private readonly pressedKeys = new Set<string>();
  private rotating = false;
  private panning = false;
  private lastPointer = { x: 0, y: 0 };
  private followedId: number | null = null;
  private cinematic = false;
  private cinematicDistance = 20;

  /** Vitesse de déplacement au clavier, en mètres par seconde à distance de référence. */
  private readonly panSpeed = 26;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    worldSizeMeters: number,
  ) {
    this.limits = {
      minDistance: 3,
      maxDistance: worldSizeMeters * 1.1,
      minPolar: 0.12,
      maxPolar: Math.PI * 0.47,
      panLimit: worldSizeMeters * 0.6,
    };
    this.distance = worldSizeMeters * 0.35;
    this.attachListeners();
    this.update(0);
  }

  /** Suit un individu ; `null` rend le contrôle à l'observateur. */
  follow(entityId: number | null): void {
    this.followedId = entityId;
    if (entityId === null) this.cinematic = false;
  }

  toggleCinematic(entityId: number | null): boolean {
    if (entityId === null) {
      this.cinematic = false;
      return false;
    }
    this.followedId = entityId;
    this.cinematic = !this.cinematic;
    if (this.cinematic) this.cinematicDistance = THREE.MathUtils.clamp(this.distance, 12, 32);
    return this.cinematic;
  }

  get followedEntityId(): number | null {
    return this.followedId;
  }

  get viewDistance(): number {
    return this.distance;
  }

  /**
   * Cadre immédiatement une zone du monde. Utilisé à la connexion pour montrer le groupe
   * plutôt que le centre géométrique d'un monde vide.
   */
  focusOn(x: number, z: number, radiusMeters: number): void {
    this.target.set(x, 0, z);
    this.clampTarget();
    // Bornes volontaires : un groupe dispersé sur des centaines de mètres tiendrait dans
    // le cadre, mais les individus deviendraient des points. On privilégie une échelle où
    // un humain reste lisible ; l'observateur dézoome à la molette s'il veut la vue large.
    this.distance = THREE.MathUtils.clamp(radiusMeters * 3.2, 30, 110);
    this.followedId = null;
  }

  /** Recentre sur une position (utilisé par le suivi d'un humain). */
  lookAtPosition(x: number, z: number, smoothing: number): void {
    this.target.x += (x - this.target.x) * smoothing;
    this.target.z += (z - this.target.z) * smoothing;
  }

  update(deltaSeconds: number): void {
    this.applyKeyboardPan(deltaSeconds);
    if (this.cinematic && this.followedId !== null) {
      this.azimuth += deltaSeconds * 0.075;
      this.distance += (this.cinematicDistance - this.distance) * Math.min(1, deltaSeconds * 1.8);
      this.polar += (Math.PI * 0.34 - this.polar) * Math.min(1, deltaSeconds * 1.5);
    }

    const sinPolar = Math.sin(this.polar);
    this.camera.position.set(
      this.target.x + this.distance * sinPolar * Math.sin(this.azimuth),
      this.target.y + this.distance * Math.cos(this.polar),
      this.target.z + this.distance * sinPolar * Math.cos(this.azimuth),
    );
    this.camera.lookAt(this.target);
  }

  private applyKeyboardPan(deltaSeconds: number): void {
    if (this.pressedKeys.size === 0 || deltaSeconds <= 0) return;

    let forward = 0;
    let strafe = 0;
    if (this.pressedKeys.has(controlCode('forward'))) forward += 1;
    if (this.pressedKeys.has(controlCode('backward'))) forward -= 1;
    if (this.pressedKeys.has(controlCode('right'))) strafe += 1;
    if (this.pressedKeys.has(controlCode('left'))) strafe -= 1;
    if (this.pressedKeys.has(controlCode('rotateLeft'))) this.azimuth -= deltaSeconds * 1.2;
    if (this.pressedKeys.has(controlCode('rotateRight'))) this.azimuth += deltaSeconds * 1.2;

    if (forward === 0 && strafe === 0) return;
    this.followedId = null; // Déplacer la caméra à la main annule le suivi.

    // La vitesse suit la distance : de loin on survole vite, de près on se déplace finement.
    const speed = this.panSpeed * deltaSeconds * (this.distance / 60);
    const sin = Math.sin(this.azimuth);
    const cos = Math.cos(this.azimuth);

    this.target.x -= (forward * sin - strafe * cos) * speed;
    this.target.z -= (forward * cos + strafe * -sin) * speed;
    this.clampTarget();
  }

  private clampTarget(): void {
    const limit = this.limits.panLimit;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -limit, limit);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -limit, limit);
  }

  private attachListeners(): void {
    window.addEventListener('keydown', (event) => {
      if (isEditableTarget(event.target)) {
        this.pressedKeys.clear();
        return;
      }
      if (event.repeat) return;
      this.pressedKeys.add(event.code);
    });
    window.addEventListener('keyup', (event) => this.pressedKeys.delete(event.code));
    window.addEventListener('blur', () => this.pressedKeys.clear());

    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button === 2) this.rotating = true;
      else if (event.button === 1) this.panning = true;
      else return;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture(event.pointerId);
    });

    this.canvas.addEventListener('pointerup', (event) => {
      this.rotating = false;
      this.panning = false;
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    });

    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.rotating && !this.panning) return;
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer = { x: event.clientX, y: event.clientY };

      if (this.rotating) {
        this.azimuth -= dx * 0.005;
        this.polar = THREE.MathUtils.clamp(
          this.polar - dy * 0.005,
          this.limits.minPolar,
          this.limits.maxPolar,
        );
      } else {
        this.followedId = null;
        const speed = this.distance * 0.0016;
        const sin = Math.sin(this.azimuth);
        const cos = Math.cos(this.azimuth);
        this.target.x -= (-dx * cos + dy * sin) * speed;
        this.target.z -= (dx * sin + dy * cos) * speed;
        this.clampTarget();
      }
    });

    this.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        // Zoom multiplicatif : la sensation reste identique de très loin comme de très près.
        const factor = Math.exp(event.deltaY * 0.0012);
        this.distance = THREE.MathUtils.clamp(
          this.distance * factor,
          this.limits.minDistance,
          this.limits.maxDistance,
        );
      },
      { passive: false },
    );
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
