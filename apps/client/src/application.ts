import type { WorldGenerationMetadata } from '@civ/shared';
import type { DebugMetrics } from './debug/DebugMetrics.js';
import type { ServerConnection } from './net/connection.js';
import type { WorldStore } from './net/worldStore.js';
import { CameraController } from './render/cameraController.js';
import type { HumanView } from './render/humanView.js';
import { SceneRenderer } from './render/sceneRenderer.js';
import { updateWaterFrame } from './render/waterShader.js';
import type { WorldView } from './render/worldView.js';
import type { DebugPanel } from './ui/debugPanel.js';
import type { InspectorPanel } from './ui/inspectorPanel.js';
import type { WorldMinimap } from './ui/worldMinimap.js';
import type { ChunkStore } from './world/chunkStore.js';

export class Application {
  public sceneRenderer: SceneRenderer | null = null;
  public camera: CameraController | null = null;

  private lastFrameMs = performance.now();
  private fps = 0;
  private lastMinimapMs = 0;
  private lastInspectorUpdateAt = -1;
  private lastInterest = { x: Number.NaN, z: Number.NaN };
  public selectedId: number | null = null;
  private uiLevel: 'full' | 'minimal' | 'off' = 'full';
  private selectionObserver: ((id: number | null) => void) | null = null;
  /** Rayon (en chunks) déclaré au serveur — voir `OptionsPanel` / `GraphicsSettings`. */
  private renderDistanceChunks = 4;

  constructor(
    public readonly canvas: HTMLCanvasElement,
    public readonly store: WorldStore,
    public readonly chunkStore: ChunkStore,
    public readonly connection: ServerConnection,
    public readonly humanView: HumanView,
    public readonly worldView: WorldView,
    public readonly debugPanel: DebugPanel,
    public readonly inspector: InspectorPanel,
    public readonly minimap: WorldMinimap,
    public readonly debugMetrics: DebugMetrics,
  ) {}

  public setupScene(generation: WorldGenerationMetadata): void {
    const worldSizeMeters = generation.sizeChunks * generation.chunkSizeMeters;

    if (!this.sceneRenderer) {
      this.sceneRenderer = new SceneRenderer(this.canvas, worldSizeMeters);
      this.camera = new CameraController(this.sceneRenderer.camera, this.canvas, worldSizeMeters);
      this.sceneRenderer.scene.add(this.worldView.group);
      this.sceneRenderer.scene.add(this.humanView.group);
    }

    this.chunkStore.setMetadata(generation);
    this.lastInterest = { x: Number.NaN, z: Number.NaN };
  }

  public frameOnPopulation(): void {
    const positions = [...this.store.values()].map((record) => record.current);
    if (positions.length === 0 || !this.camera) return;

    const centerX = positions.reduce((sum, state) => sum + state.x, 0) / positions.length;
    const centerZ = positions.reduce((sum, state) => sum + state.z, 0) / positions.length;
    const radius = positions.reduce(
      (max, state) => Math.max(max, Math.hypot(state.x - centerX, state.z - centerZ)),
      0,
    );
    this.camera.focusOn(centerX, centerZ, radius);
  }

  public cameraChunk(): { x: number; z: number } {
    const size = this.chunkStore.chunkSizeMeters;
    const target = this.camera?.target ?? { x: 0, y: 0, z: 0 };
    return { x: Math.floor(target.x / size), z: Math.floor(target.z / size) };
  }

  private updateChunkInterest(): void {
    const chunk = this.cameraChunk();
    if (chunk.x === this.lastInterest.x && chunk.z === this.lastInterest.z) return;
    this.lastInterest = chunk;
    this.connection.send({ t: 'chunkInterest', center: chunk, radius: this.renderDistanceChunks });
  }

  /**
   * Change le rayon de chunks déclaré au serveur — voir `GraphicsSettings.renderDistance`
   * (`OptionsPanel`). Force un renvoi immédiat de `chunkInterest` même si la caméra n'a
   * pas changé de chunk depuis le dernier envoi : sans ça, un rayon agrandi n'aurait
   * d'effet qu'au prochain déplacement de caméra.
   */
  public setRenderDistanceChunks(chunks: number): void {
    if (this.renderDistanceChunks === chunks) return;
    this.renderDistanceChunks = chunks;
    this.lastInterest = { x: Number.NaN, z: Number.NaN };
  }

  /**
   * Capture le canvas tel qu'affiché à l'instant présent — pour la miniature de
   * sauvegarde (« Mes mondes »). `null` tant que la scène n'existe pas encore. Le
   * Une frame est rendue explicitement juste avant la lecture : le tampon WebGL peut
   * ainsi rester non persistant, ce qui évite son coût permanent sur chaque frame.
   */
  public captureThumbnail(): string | null {
    if (!this.sceneRenderer) return null;
    this.sceneRenderer.render();
    return this.sceneRenderer.domElement.toDataURL('image/jpeg', 0.7);
  }

  public selectEntity(id: number | null): void {
    const wasFollowing = this.camera?.followedEntityId !== null;
    this.selectedId = id;
    this.humanView.select(id);
    if (id === null || wasFollowing) this.camera?.follow(id);
    this.lastInspectorUpdateAt = -1;

    const record = id === null ? undefined : this.store.get(id);
    if (record) this.inspector.show(record);
    else this.inspector.hide();
    this.selectionObserver?.(id);
  }

  public observeSelection(observer: (id: number | null) => void): void {
    this.selectionObserver = observer;
  }

  public cycleUiLevel(): void {
    this.uiLevel =
      this.uiLevel === 'full' ? 'minimal' : this.uiLevel === 'minimal' ? 'off' : 'full';
    document.body.dataset.uiLevel = this.uiLevel;
  }

  public start(): void {
    const frame = () => {
      requestAnimationFrame(frame);
      this.renderFrame();
    };
    requestAnimationFrame(frame);
  }

  public renderFrame(): void {
    const now = performance.now();
    const frameMs = now - this.lastFrameMs;
    const deltaSeconds = Math.min(0.1, frameMs / 1000);
    this.lastFrameMs = now;
    this.fps += ((deltaSeconds > 0 ? 1 / deltaSeconds : 0) - this.fps) * 0.1;
    this.debugMetrics.recordFrame(frameMs);

    if (!this.sceneRenderer || !this.camera) return;

    this.humanView.update(this.store, now, deltaSeconds);

    const followed = this.camera.followedEntityId;
    if (followed !== null) {
      const record = this.store.get(followed);
      if (record) {
        const pose = this.store.poseOf(record, now);
        this.camera.lookAtPosition(pose.x, pose.z, 0.12);
      }
    }

    this.camera.update(deltaSeconds);
    this.humanView.setViewDistance(this.camera.viewDistance);
    this.worldView.setMapMode(this.camera.viewDistance >= 230);
    this.updateChunkInterest();

    const observed = this.cameraChunk();
    this.worldView.updateDetail(observed.x, observed.z);

    if (this.store.environment) {
      this.sceneRenderer.applyEnvironment(this.store.environment);
      this.worldView.applySeason(this.store.environment.season);
      this.worldView.applyWeather(this.store.environment);
      updateWaterFrame(
        now / 1000,
        this.sceneRenderer.sunDirection,
        this.sceneRenderer.skyColor,
        this.sceneRenderer.fogNear,
        this.sceneRenderer.fogFar,
        this.store.environment.weather?.precipitation01 ?? 0,
      );
    }
    this.sceneRenderer.render();

    if (this.selectedId !== null) {
      const record = this.store.get(this.selectedId);
      if (record && record.currentAt !== this.lastInspectorUpdateAt) {
        this.lastInspectorUpdateAt = record.currentAt;
        this.inspector.show(record);
      }
    }

    if (now - this.lastMinimapMs > 320) {
      this.lastMinimapMs = now;
      this.minimap.draw(this.chunkStore, this.worldView.currentColorMode, observed);
    }

    this.debugPanel.update({
      fps: this.fps,
      drawnHumans: this.humanView.pickables.length,
      store: this.store,
      connection: this.connection,
      chunkStore: this.chunkStore,
      renderedChunks: this.worldView.chunkCount,
      cameraChunk: observed,
    });
  }
}
