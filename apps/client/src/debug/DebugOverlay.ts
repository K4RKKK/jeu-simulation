import {
  TERRAIN_COLOR_MODES,
  TERRAIN_COLOR_MODE_LABELS,
  type TerrainColorMode,
} from '../render/terrainColorModes.js';
import type { DebugStore } from './DebugSettings.js';
import type { DebugMetrics } from './DebugMetrics.js';
import type { WeatherPreview } from '../render/sceneRenderer.js';

/** Dépendances réelles du panneau — interfaces minimales, pas les classes entières. */
export interface DebugOverlayDeps {
  worldView: {
    setChunkBordersVisible(visible: boolean): void;
    setColorMode(mode: TerrainColorMode): void;
    readonly currentColorMode: TerrainColorMode;
  };
  netStore: {
    readonly clientCount: number;
    readonly stats: {
      averageTickMs: number;
      tickMsP95: number;
      tickMsP99: number;
      ticksPerSecond: number;
    } | null;
    readonly chunkStats: {
      cached: number;
      active: number;
      queued: number;
      averageGenerationMs: number;
    } | null;
  };
  connection: {
    readonly latencyMs: number;
    readonly bytesReceived: number;
    readonly status: string;
  };
  chunkStore: { readonly size: number };
  setWeatherPreview(preview: WeatherPreview): void;
}

/**
 * Panneau de développement — F2 pour l'afficher, trois onglets réels.
 *
 * Bug corrigé (CLAUDE.md « pas de faux code ») : la version précédente n'était
 * construite nulle part dans l'application — code mort depuis son introduction — et
 * ses cases à cocher de calques ne pilotaient aucun rendu. Cette version est
 * instanciée par `main.ts`, chaque contrôle a un effet réel, et `recordFrame`/
 * `recordChunkGen` sont appelés depuis `Application.renderFrame` et `main.ts`
 * respectivement plutôt que jamais.
 */
export class DebugOverlay {
  private readonly overlay: HTMLElement;
  private readonly content: HTMLElement;
  private readonly tabs: HTMLElement[] = [];
  private currentTabId: 'layers' | 'metrics' | 'network' | 'visual' = 'layers';
  private readonly sparklineCanvas: HTMLCanvasElement;
  private readonly onKeydown: (event: KeyboardEvent) => void;
  private readonly onStoreChange: (settings: ReturnType<DebugStore['get']>) => void;
  private animationFrame: number | null = null;
  private disposed = false;

  constructor(
    private readonly store: DebugStore,
    private readonly metrics: DebugMetrics,
    private readonly deps: DebugOverlayDeps,
  ) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'dev-overlay hidden';
    document.body.appendChild(this.overlay);

    const tabBar = document.createElement('div');
    tabBar.className = 'dev-tab-bar';
    this.overlay.appendChild(tabBar);

    this.content = document.createElement('div');
    this.content.className = 'dev-section';
    this.overlay.appendChild(this.content);

    this.sparklineCanvas = document.createElement('canvas');
    this.sparklineCanvas.width = 200;
    this.sparklineCanvas.height = 40;
    this.sparklineCanvas.className = 'dev-sparkline';

    const tabConfig: { id: 'layers' | 'metrics' | 'network' | 'visual'; label: string }[] = [
      { id: 'layers', label: 'Calques' },
      { id: 'metrics', label: 'Métriques' },
      { id: 'network', label: 'Réseau' },
      { id: 'visual', label: 'Visual Lab' },
    ];

    for (const tab of tabConfig) {
      const btn = document.createElement('button');
      btn.className = 'dev-tab';
      btn.textContent = tab.label;
      btn.onclick = () => this.setTab(tab.id);
      tabBar.appendChild(btn);
      this.tabs.push(btn);
    }

    this.onKeydown = (event) => {
      if (event.key === 'F2' && !event.repeat) {
        event.preventDefault();
        this.store.toggle('showOverlay');
      }
    };
    document.addEventListener('keydown', this.onKeydown);

    this.onStoreChange = (settings) => {
      this.overlay.classList.toggle('hidden', !settings.showOverlay);
      document.body.classList.toggle('debug-mode', settings.showOverlay);
      if (settings.activeTab !== this.currentTabId) this.setTab(settings.activeTab, false);
      this.renderCurrentTab();
    };
    this.store.subscribe(this.onStoreChange);
    this.onStoreChange(this.store.get());

    const loop = (): void => {
      if (this.disposed) return;
      if (this.store.get().showOverlay && this.currentTabId === 'metrics') this.renderCurrentTab();
      this.animationFrame = requestAnimationFrame(loop);
    };
    this.animationFrame = requestAnimationFrame(loop);

    this.setTab(this.store.get().activeTab, false);
  }

  /**
   * Libère toutes les ressources : sans cela, une reconstruction du client (hot reload,
   * changement de scène) accumulerait des listeners `keydown` et des boucles
   * `requestAnimationFrame` fantômes.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    document.removeEventListener('keydown', this.onKeydown);
    this.store.unsubscribe(this.onStoreChange);
    document.body.classList.remove('debug-mode');
    this.overlay.remove();
  }

  private setTab(tabId: 'layers' | 'metrics' | 'network' | 'visual', updateStore = true): void {
    this.currentTabId = tabId;
    if (updateStore && tabId !== 'visual') this.store.set({ activeTab: tabId });

    const tabNames: readonly string[] = ['layers', 'metrics', 'network', 'visual'];
    this.tabs.forEach((t, i) => t.classList.toggle('active', tabNames[i] === tabId));

    this.renderCurrentTab();
  }

  private renderCurrentTab(): void {
    if (!this.store.get().showOverlay) return;
    this.content.innerHTML = '';

    switch (this.currentTabId) {
      case 'layers':
        this.renderLayers();
        return;
      case 'metrics':
        this.renderMetrics();
        return;
      case 'network':
        this.renderNetwork();
        return;
      case 'visual':
        this.renderVisualLab();
        return;
      default: {
        const exhaustive: never = this.currentTabId;
        throw new Error(`Onglet debug inconnu: ${String(exhaustive)}`);
      }
    }
  }

  private renderLayers(): void {
    const settings = this.store.get();

    const bordersLabel = document.createElement('label');
    bordersLabel.className = 'dev-toggle';
    const bordersCheckbox = document.createElement('input');
    bordersCheckbox.type = 'checkbox';
    bordersCheckbox.checked = settings.chunkBorders;
    bordersCheckbox.onchange = () => {
      this.store.toggle('chunkBorders');
      this.deps.worldView.setChunkBordersVisible(this.store.get().chunkBorders);
    };
    bordersLabel.append(bordersCheckbox, document.createTextNode(' Bordures de chunks'));
    this.content.appendChild(bordersLabel);

    const title = document.createElement('div');
    title.className = 'dev-section-title';
    title.style.marginTop = '14px';
    title.textContent = 'Calque de couleur du terrain';
    this.content.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'dev-toggle-grid';
    for (const mode of TERRAIN_COLOR_MODES) {
      const label = document.createElement('label');
      label.className = 'dev-toggle';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'dev-color-mode';
      radio.checked = settings.colorMode === mode;
      radio.onchange = () => {
        this.store.set({ colorMode: mode });
        this.deps.worldView.setColorMode(mode);
      };
      label.append(radio, document.createTextNode(` ${TERRAIN_COLOR_MODE_LABELS[mode]}`));
      grid.appendChild(label);
    }
    this.content.appendChild(grid);
  }

  private renderMetrics(): void {
    const frame = this.metrics.frameStats();
    const chunkGen = this.metrics.chunkStats();
    const fpsAvg = frame.avg > 0 ? (1000 / frame.avg).toFixed(1) : '0';

    // Bug corrigé : l'ancienne version affichait "FPS p95/p99" en inversant
    // `1000 / frameTimeP95`, ce qui donne un percentile BAS de FPS (le pire des cas),
    // pas un FPS "au 95e centile" au sens usuel — trompeur. On garde un seul FPS moyen
    // et les temps de frame en millisecondes, sans ambiguïté.
    this.content.innerHTML = `
      <div class="dev-section-title">Framerate</div>
      <div class="dev-metric-row"><span>FPS moyen</span><span>${fpsAvg}</span></div>
      <div class="dev-metric-stats">
        Frame (ms) : p50=${frame.p50.toFixed(1)} p95=${frame.p95.toFixed(1)} p99=${frame.p99.toFixed(1)} max=${frame.max.toFixed(1)}
      </div>
    `;
    this.content.appendChild(this.sparklineCanvas);
    this.drawSparkline();

    this.content.insertAdjacentHTML(
      'beforeend',
      `
      <div class="dev-section-title" style="margin-top:10px">Génération de chunks</div>
      <div class="dev-metric-stats">
        ${chunkGen.count === 0 ? 'aucune donnée' : `avg=${chunkGen.avg.toFixed(1)} p95=${chunkGen.p95.toFixed(1)} p99=${chunkGen.p99.toFixed(1)} max=${chunkGen.max.toFixed(1)} ms (serveur)`}
      </div>
      `,
    );
  }

  private drawSparkline(): void {
    const ctx = this.sparklineCanvas.getContext('2d');
    if (!ctx) return;
    const width = this.sparklineCanvas.width;
    const height = this.sparklineCanvas.height;
    ctx.clearRect(0, 0, width, height);

    const history = this.metrics.getFrameHistory();
    if (history.length === 0) return;

    const maxMs = 33; // 30 FPS comme repère haut du graphe
    const barWidth = width / 60;

    ctx.fillStyle = '#4ade80';
    const startIdx = Math.max(0, history.length - 60);
    for (let i = 0; i < Math.min(60, history.length); i++) {
      const ms = history[startIdx + i] as number;
      const barHeight = Math.min(height, (ms / maxMs) * height);
      ctx.fillRect(i * barWidth, height - barHeight, barWidth - 1, barHeight);
    }
  }

  private renderNetwork(): void {
    const { netStore, connection, chunkStore } = this.deps;
    const chunkStats = netStore.chunkStats;
    const stats = netStore.stats;

    this.content.innerHTML = `
      <div class="dev-metric-row"><span>Statut</span><span>${connection.status}</span></div>
      <div class="dev-metric-row"><span>Latence</span><span>${connection.latencyMs} ms</span></div>
      <div class="dev-metric-row"><span>Reçu</span><span>${formatBytes(connection.bytesReceived)}</span></div>
      <div class="dev-metric-row"><span>Observateurs</span><span>${netStore.clientCount}</span></div>
      <div class="dev-section-title" style="margin-top:10px">Chunks</div>
      <div class="dev-metric-row"><span>En cache (client)</span><span>${chunkStore.size}</span></div>
      <div class="dev-metric-row"><span>En cache (serveur)</span><span>${chunkStats?.cached ?? '—'}</span></div>
      <div class="dev-metric-row"><span>Actifs</span><span>${chunkStats?.active ?? '—'}</span></div>
      <div class="dev-metric-row"><span>En file</span><span>${chunkStats?.queued ?? '—'}</span></div>
      <div class="dev-metric-row"><span>Génération moy.</span><span>${chunkStats ? chunkStats.averageGenerationMs.toFixed(2) + ' ms' : '—'}</span></div>
      <div class="dev-section-title" style="margin-top:10px">Simulation</div>
      <div class="dev-metric-row"><span>Tick moyen</span><span>${stats ? stats.averageTickMs.toFixed(3) + ' ms' : '—'}</span></div>
      <div class="dev-metric-row"><span>Tick p95 / p99</span><span>${stats ? `${stats.tickMsP95.toFixed(2)} / ${stats.tickMsP99.toFixed(2)} ms` : '—'}</span></div>
      <div class="dev-metric-row"><span>Ticks/s</span><span>${stats ? stats.ticksPerSecond.toFixed(1) : '—'}</span></div>
    `;
  }

  private renderVisualLab(): void {
    const title = document.createElement('div');
    title.className = 'dev-section-title';
    title.textContent = 'Aperçu météo local (simulation inchangée)';
    const grid = document.createElement('div');
    grid.className = 'dev-toggle-grid';
    const previews: readonly [WeatherPreview, string][] = [
      ['live', 'Réel'],
      ['clear', 'Clair'],
      ['rain', 'Pluie'],
      ['snow', 'Neige'],
      ['storm', 'Orage'],
      ['fog', 'Brouillard'],
    ];
    for (const [value, label] of previews) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dev-tab';
      button.textContent = label;
      button.onclick = () => this.deps.setWeatherPreview(value);
      grid.append(button);
    }
    const benchmark = document.createElement('button');
    benchmark.type = 'button';
    benchmark.className = 'dev-tab';
    benchmark.textContent = 'Lancer le benchmark 5 s';
    const result = document.createElement('div');
    result.className = 'dev-metric-stats';
    benchmark.onclick = async () => {
      benchmark.disabled = true;
      benchmark.textContent = 'Mesure en cours…';
      const stats = await this.metrics.runBenchmark();
      const fps = stats.avg > 0 ? 1000 / stats.avg : 0;
      result.textContent = `${fps.toFixed(1)} FPS · frame p95 ${stats.p95.toFixed(1)} ms · p99 ${stats.p99.toFixed(1)} ms`;
      benchmark.disabled = false;
      benchmark.textContent = 'Relancer le benchmark 5 s';
    };
    this.content.append(title, grid, benchmark, result);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}
