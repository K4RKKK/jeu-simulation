import * as THREE from 'three';
import type { Application } from './application.js';
import type { TerrainColorMode } from './render/terrainColorModes.js';
import { resolveEntityId } from './render/humanView.js';
import type { TerrainInspector } from './debug/TerrainInspector.js';
import { controlCode } from './settings/controlSettings.js';

export class InputController {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private pointerDownAt = { x: 0, y: 0 };
  private terrainInspectMode = false;
  private readonly humanTooltip = document.querySelector<HTMLElement>('#human-tooltip');
  private lastHoverRaycastAt = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly app: Application,
    private readonly terrainInspector: TerrainInspector,
    private readonly onEscape?: () => boolean,
  ) {
    this.setupMouseEvents();
    this.setupKeyboardEvents();
    this.setupUIControls();
  }

  private setupMouseEvents(): void {
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button === 0) this.pointerDownAt = { x: event.clientX, y: event.clientY };
    });

    this.canvas.addEventListener('pointerup', (event) => {
      if (event.button !== 0 || !this.app.sceneRenderer) return;

      const travelled = Math.hypot(
        event.clientX - this.pointerDownAt.x,
        event.clientY - this.pointerDownAt.y,
      );
      if (travelled > 5) return;

      if (!this.setPointerFromEvent(event)) return;
      this.raycaster.setFromCamera(this.pointer, this.app.sceneRenderer.camera);

      const humanHits = this.raycaster.intersectObjects(this.app.humanView.pickables, true);
      if (humanHits.length > 0) {
        this.app.selectEntity(resolveEntityId(humanHits[0]!.object));
        return;
      }

      if (this.terrainInspectMode) {
        const groundHits = this.raycaster.intersectObjects(this.app.worldView.terrainMeshes, false);
        const point = groundHits[0]?.point;
        if (point) {
          const probe = this.app.chunkStore.probe(point.x, point.z);
          if (probe) this.terrainInspector.show(probe, this.app.chunkStore.metadata);
        }
        return;
      }

      this.app.selectEntity(null);
    });

    this.canvas.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch' || event.buttons !== 0) {
        this.hideHumanTooltip();
        return;
      }
      const now = performance.now();
      if (now - this.lastHoverRaycastAt < 70) return;
      this.lastHoverRaycastAt = now;
      this.updateHumanTooltip(event);
    });
    this.canvas.addEventListener('pointerleave', () => this.hideHumanTooltip());
  }

  private setupKeyboardEvents(): void {
    window.addEventListener('keydown', (event) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.code === 'Escape') {
        if (this.onEscape?.() === true) return;
        this.app.selectEntity(null);
        this.terrainInspector.hide();
      }
      if (event.code === controlCode('follow') && this.app.selectedId !== null) {
        this.app.camera?.follow(this.app.selectedId);
      }
      if (event.code === controlCode('cinematic')) {
        this.app.camera?.toggleCinematic(this.app.selectedId);
      }
      if (event.code === controlCode('interface')) {
        this.app.cycleUiLevel();
      }
      if (event.code === 'F3') {
        event.preventDefault();
        this.terrainInspectMode = !this.terrainInspectMode;
        if (!this.terrainInspectMode) this.terrainInspector.hide();
        this.app.worldView.setChunkBordersVisible(this.terrainInspectMode);

        const bordersCheckbox = document.querySelector<HTMLInputElement>(
          'input[data-action="chunkborders"]',
        );
        if (bordersCheckbox) bordersCheckbox.checked = this.terrainInspectMode;
      }
    });
  }

  private setPointerFromEvent(event: PointerEvent): boolean {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return false;
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    return true;
  }

  private updateHumanTooltip(event: PointerEvent): void {
    const tooltip = this.humanTooltip;
    const renderer = this.app.sceneRenderer;
    if (!tooltip || !renderer || !this.setPointerFromEvent(event)) {
      this.hideHumanTooltip();
      return;
    }

    this.raycaster.setFromCamera(this.pointer, renderer.camera);
    const hit = this.raycaster.intersectObjects(this.app.humanView.pickables, true)[0];
    const id = resolveEntityId(hit?.object ?? null);
    const record = id === null ? undefined : this.app.store.get(id);
    if (!record) {
      this.hideHumanTooltip();
      return;
    }

    const name = document.createElement('strong');
    name.textContent = record.profile.name;
    const activity = document.createElement('span');
    activity.textContent = activityLabel(record.current.activity);
    tooltip.replaceChildren(name, activity);
    tooltip.classList.remove('hidden');

    const bounds = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - bounds.width - 8, event.clientX + 14))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - bounds.height - 8, event.clientY + 14))}px`;
  }

  private hideHumanTooltip(): void {
    this.humanTooltip?.classList.add('hidden');
  }

  private setupUIControls(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-action]')) {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        const connection = this.app.connection;

        if (action === 'pause' || action === 'resume') {
          connection.send({ t: 'control', action });
        }
        if (action === 'regenerate') {
          const seedInput = document.querySelector<HTMLInputElement>('#seed-input');
          const seed = seedInput?.value.trim() ?? '';
          connection.send({ t: 'regenerate', ...(seed.length > 0 ? { seed } : {}) });
        }
      });
    }

    const timeScaleSelect = document.querySelector<HTMLSelectElement>(
      'select[data-action="timescale"]',
    );
    if (timeScaleSelect) {
      timeScaleSelect.addEventListener('change', () => {
        this.app.connection.send({
          t: 'control',
          action: 'setTimeScale',
          timeScale: Number(timeScaleSelect.value),
        });
      });
    }

    const colorModeSelect = document.querySelector<HTMLSelectElement>(
      'select[data-action="colormode"]',
    );
    if (colorModeSelect) {
      colorModeSelect.addEventListener('change', () => {
        this.app.worldView.setColorMode(colorModeSelect.value as TerrainColorMode);
      });
    }

    const bordersCheckbox = document.querySelector<HTMLInputElement>(
      'input[data-action="chunkborders"]',
    );
    if (bordersCheckbox) {
      bordersCheckbox.addEventListener('change', () => {
        this.app.worldView.setChunkBordersVisible(bordersCheckbox.checked);
      });
    }

    document
      .querySelector<HTMLButtonElement>('button[data-action="close-inspector"]')
      ?.addEventListener('click', () => this.app.selectEntity(null));
  }
}

function activityLabel(activity: string): string {
  switch (activity) {
    case 'walking':
      return 'En déplacement';
    case 'drink':
      return 'Boit';
    case 'eat':
      return 'Mange';
    case 'rest':
      return 'Se repose';
    default:
      return 'Observe';
  }
}
