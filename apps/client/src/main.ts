import { getBootstrapContext } from './bootstrapContext.js';
import { DebugMetrics } from './debug/DebugMetrics.js';
import { DebugOverlay } from './debug/DebugOverlay.js';
import { DebugStore } from './debug/DebugSettings.js';
import { TerrainInspector } from './debug/TerrainInspector.js';
import { ServerConnection, resolveServerUrl } from './net/connection.js';
import { WorldStore } from './net/worldStore.js';
import { HumanView } from './render/humanView.js';
import { WorldView } from './render/worldView.js';
import {
  detailDistanceChunksFor,
  pixelRatioFor,
  renderDistanceChunksFor,
  type GraphicsSettings,
} from './settings/graphicsSettings.js';
import { ConnectionOverlay } from './ui/connectionOverlay.js';
import { DebugPanel } from './ui/debugPanel.js';
import { InspectorPanel } from './ui/inspectorPanel.js';
import { LoadingScreen } from './ui/loadingScreen.js';
import { OptionsPanel } from './ui/optionsPanel.js';
import { PlayerHud } from './ui/playerHud.js';
import { PopulationPanel } from './ui/populationPanel.js';
import { WorldChronicle } from './ui/worldChronicle.js';
import { WorldMinimap } from './ui/worldMinimap.js';
import { WorldPanel } from './ui/worldPanel.js';
import { PauseMenu } from './ui/pauseMenu.js';
import { DrawerManager } from './ui/drawerManager.js';
import { ThumbnailController } from './ui/thumbnailController.js';
import { ChunkStore } from './world/chunkStore.js';
import { Application } from './application.js';
import { InputController } from './input.js';
import { TERRAIN_COLOR_MODES, TERRAIN_COLOR_MODE_LABELS } from './render/terrainColorModes.js';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Élément introuvable dans le document: ${selector}`);
  return element;
}

// 1. DOM Elements
const canvas = requireElement<HTMLCanvasElement>('#viewport');
const loadingScreen = new LoadingScreen(requireElement<HTMLElement>('#loading-screen'));
const debugPanel = new DebugPanel(requireElement<HTMLElement>('#debug-content'));
const inspector = new InspectorPanel(
  requireElement<HTMLElement>('#inspector-panel'),
  requireElement<HTMLElement>('#inspector-content'),
);
const terrainInspector = new TerrainInspector(
  requireElement<HTMLElement>('#terrain-panel'),
  requireElement<HTMLElement>('#terrain-content'),
);
const minimap = new WorldMinimap(requireElement<HTMLCanvasElement>('#minimap'));

const { appDialog, worldMenu } = getBootstrapContext();

let chronicle: WorldChronicle | null = null;
let playerHud: PlayerHud | null = null;
let populationPanel: PopulationPanel | null = null;
let worldPanel: WorldPanel | null = null;
let optionsPanel: OptionsPanel | null = null;
let hasFramedInitialPopulation = false;
let hasCompletedInitialFrame = false;
let gameStarted = false;

// 2. Views
const humanView = new HumanView();
const worldView = new WorldView();

// 2b. Debug (F2 overlay + F3 terrain inspector)
const debugStore = new DebugStore();
const debugMetrics = new DebugMetrics();

// 3. Stores
const chunkStore = new ChunkStore({
  onChunkAdded: (chunk) => worldView.add(chunk),
  onChunkRemoved: (key) => worldView.remove(key),
  onMetadata: (metadata) => {
    worldView.setMetadata(metadata);
    minimap.setMetadata(metadata);
  },
});

const store = new WorldStore({
  onHumanAdded: (record) => humanView.add(record),
  onHumanRemoved: (id) => {
    humanView.remove(id);
    if (app.selectedId === id) app.selectEntity(null);
  },
  onWorldReady: (_world, generation) => {
    hasCompletedInitialFrame = false;
    app.setupScene(generation);
    // `sceneRenderer` n'existe qu'à partir d'ici : le pixel ratio (voir
    // `applyGraphicsSettings`) n'a pas pu être appliqué avant, faute de renderer à régler.
    if (optionsPanel) applyGraphicsSettings(optionsPanel.current);
    // La population visible arrive juste après, une fois la zone de caméra annoncée au
    // serveur. Cette étape signifie donc « miroir de population prêt », pas « monde entier
    // téléchargé » — précisément ce qui garde une grande population soutenable.
    loadingScreen.markComplete('world');
  },
  onPopulationReady: () => loadingScreen.markComplete('population'),
  onChunk: (payload) => {
    // `chunkStore.apply` construit déjà les instances (via `onChunkAdded` → `worldView.add`)
    // avant de revenir : les états `modified` d'un chunk rechargé (récolte partielle, voir
    // `ChunkPayload.resourceStates`) peuvent donc être réappliqués immédiatement après,
    // sans attendre un futur `resource:updated` qui ne repasse plus tant que rien de neuf
    // ne se produit sur cette ressource.
    chunkStore.apply(payload);
    for (const state of payload.resourceStates ?? []) {
      worldView.updateResourceAppearance(payload.key, state.localId, state.changedFields);
    }
    debugMetrics.recordChunkGen(payload.generationMs);
    // Premier chunk reçu : le terrain autour de l'observateur a commencé à exister.
    loadingScreen.markComplete('terrain');
    // La synchronisation n'est vraie qu'après une frame contenant effectivement ce chunk.
    if (!hasCompletedInitialFrame) {
      hasCompletedInitialFrame = true;
      requestAnimationFrame(() => {
        app.renderFrame();
        loadingScreen.markComplete('ready');
        loadingScreen.hide();
      });
    }
  },
  onChunkUnload: (keys) => chunkStore.remove([...keys]),
  onResourceRemoved: (chunkKey, localId) => worldView.removeResourceByLocalId(chunkKey, localId),
  onResourceAdded: (chunkKey, localId) => worldView.restoreResourceByLocalId(chunkKey, localId),
  onResourceUpdated: (chunkKey, localId, changedFields) =>
    worldView.updateResourceAppearance(chunkKey, localId, changedFields),
  onTrailUpdated: (chunkKey, resolution, cells) => {
    if (chunkStore.applyTrailUpdate(chunkKey, resolution, cells)) {
      worldView.updateTrails(chunkKey, cells);
    }
  },
  onEvents: (events) => chronicle?.ingest(events),
  // `connection` est déclarée plus bas dans ce module mais déjà initialisée au moment
  // où cet écouteur peut réellement s'exécuter (un message réseau, jamais synchrone
  // pendant la construction) — même schéma que `app` référencé plus haut (`onHumanRemoved`).
  onDesyncDetected: () => connection.send({ t: 'resync' }),
});

// 4. Connection
const connection = new ServerConnection(resolveServerUrl(), {
  onMessage: (message, receivedAt) => {
    if (message.t === 'init') {
      const previousWorldId = store.world?.worldId ?? null;
      const previousTick = store.clock?.tick ?? -1;
      const worldWasReplaced =
        previousWorldId !== null &&
        (previousWorldId !== message.world.worldId || message.clock.tick < previousTick);
      chronicle?.setWorld(message.world.worldId, worldWasReplaced);
      populationPanel?.setWorld(message.world.worldId, worldWasReplaced);
      hasFramedInitialPopulation = false;
    }
    store.apply(message, receivedAt);
    if (message.t === 'init' || message.t === 'snapshot' || message.t === 'delta') {
      playerHud?.update();
      populationPanel?.refreshIfOpen();
      worldPanel?.refreshIfOpen();
    } else if (message.t === 'stats') {
      playerHud?.update();
      worldPanel?.refreshIfOpen();
    } else if (message.t === 'chunk' || message.t === 'chunkUnload') {
      worldPanel?.refreshIfOpen();
    }
    if (!hasFramedInitialPopulation && store.humanCount > 0) {
      hasFramedInitialPopulation = true;
      app.frameOnPopulation();
    }
  },
  onStatusChange: (status) => {
    // Coché seulement à l'ouverture réussie de la socket, jamais à la simple tentative
    // (`connecting`) : sans quoi l'étape s'affichait « faite » avant même de savoir si le
    // serveur répond, ce que `LoadingScreen` interdit explicitement par convention.
    if (status === 'open') {
      loadingScreen.markComplete('connect');
      connectionOverlay.hide();
    }
    if (status === 'closed') {
      // Avant la première connexion réussie : l'écran de génération est visible mais
      // n'a aucun moyen de montrer qu'une tentative échoue et se retente en coulisses.
      // Après : c'est une vraie perte de connexion en cours de partie. Les deux cas
      // utilisent le même overlay, avec un message adapté à chacun.
      if (connection.hasConnectedOnce) connectionOverlay.showLost();
      else connectionOverlay.showConnecting();
    }
    playerHud?.update();
  },
  onReconnectScheduled: (delayMs) => connectionOverlay.startCountdown(delayMs),
});

const connectionOverlay = new ConnectionOverlay(
  requireElement<HTMLElement>('#reconnect-overlay'),
  connection,
);

// 5. App & Input Controllers
const app = new Application(
  canvas,
  store,
  chunkStore,
  connection,
  humanView,
  worldView,
  debugPanel,
  inspector,
  minimap,
  debugMetrics,
);

playerHud = new PlayerHud(requireElement<HTMLElement>('#player-hud'), store, connection);
worldPanel = new WorldPanel(
  requireElement<HTMLElement>('#world-panel'),
  requireElement<HTMLElement>('#world-content'),
  store,
  chunkStore,
);
populationPanel = new PopulationPanel(
  requireElement<HTMLElement>('#population-panel'),
  requireElement<HTMLElement>('#population-list'),
  requireElement<HTMLInputElement>('#population-search'),
  store,
  (id) => {
    app.selectEntity(id);
    populationPanel?.close();
    drawerManager.updateNavigation();
  },
);
app.observeSelection((id) => {
  if (id !== null) populationPanel?.noteSelection(id);
});
chronicle = new WorldChronicle(
  requireElement<HTMLElement>('#chronicle-panel'),
  requireElement<HTMLElement>('#chronicle-list'),
  requireElement<HTMLElement>('#notification-stack'),
);
optionsPanel = new OptionsPanel(
  requireElement<HTMLElement>('#options-panel'),
  requireElement<HTMLElement>('#options-content'),
  (settings) => applyGraphicsSettings(settings),
);
// Applique tout de suite les réglages restaurés (localStorage) aux éléments qui
// n'attendent pas la scène 3D — `sceneRenderer` (pixel ratio) n'existe pas encore à ce
// stade, `onWorldReady` s'en charge dès qu'il apparaît.
applyGraphicsSettings(optionsPanel.current);

type DrawerName = 'world' | 'population' | 'chronicle' | 'options';
const drawers = {
  world: worldPanel,
  population: populationPanel,
  chronicle,
  options: optionsPanel,
};
const drawerManager = new DrawerManager<DrawerName>(drawers);
drawerManager.bind();

const pauseMenu = new PauseMenu(requireElement<HTMLElement>('#pause-menu'), {
  onOptions: () => {
    drawerManager.closeAll();
    optionsPanel?.open();
    drawerManager.updateNavigation();
  },
  onWorlds: () => void worldMenu.showWorlds(),
});

new InputController(canvas, app, terrainInspector, () => {
  if (appDialog.isOpen) return true;
  if (!gameStarted) return false;
  if (worldMenu.isOpen) {
    worldMenu.hide();
    return true;
  }
  if (drawerManager.anyOpen) {
    drawerManager.closeAll();
    drawerManager.updateNavigation();
    return true;
  }
  pauseMenu.toggle();
  return true;
});

// 5b. Debug overlay (F2) — construit après `app` : il a besoin de refs déjà réunies là.
new DebugOverlay(debugStore, debugMetrics, {
  worldView,
  netStore: store,
  connection,
  chunkStore,
  setWeatherPreview: (preview) => app.sceneRenderer?.setWeatherPreview(preview),
});

// 6. UI Populations (color modes etc.)
const colorModeSelect = document.querySelector<HTMLSelectElement>(
  'select[data-action="colormode"]',
);
if (colorModeSelect) {
  for (const mode of TERRAIN_COLOR_MODES) {
    const option = document.createElement('option');
    option.value = mode;
    option.textContent = TERRAIN_COLOR_MODE_LABELS[mode];
    colorModeSelect.append(option);
  }
}

// 7. Démarrage du jeu et aperçus de sauvegarde
const thumbnails = new ThumbnailController(
  () => worldMenu.activeWorldName,
  () => app.captureThumbnail(),
);

/** Rejoint le monde actuellement actif sur le serveur — aucun appel HTTP nécessaire. */
export function startGame(): void {
  worldMenu.hide();
  pauseMenu.close();
  if (gameStarted) return;
  gameStarted = true;
  loadingScreen.show();
  connection.connect();
  app.start();
  thumbnails.start();
}

/**
 * Applique chaque réglage à son mécanisme réel — voir `graphicsSettings.ts` pour ce à
 * quoi chaque niveau correspond concrètement. `sceneRenderer` peut ne pas encore exister
 * (avant `onWorldReady`) : le pixel ratio sera réappliqué dès qu'il apparaît.
 */
function applyGraphicsSettings(settings: GraphicsSettings): void {
  app.setRenderDistanceChunks(renderDistanceChunksFor(settings.renderDistance));
  worldView.setDetailDistanceChunks(detailDistanceChunksFor(settings.decorativeDensity));
  app.sceneRenderer?.setPixelRatio(pixelRatioFor(settings.displayQuality));
}

/**
 * Miniature d'aperçu pour « Mes mondes » — pas liée à un événement de sauvegarde précis
 * (le serveur autosave sans qu'aucun client soit forcément là pour capturer une image) :
 * une capture périodique côté client, tant que quelqu'un observe activement ce monde,
 * atteint le même résultat pratique (une image raisonnablement fraîche) sans inventer de
 * notification serveur→client dédiée.
 */
// 8. Dev Mode Exposures
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__civ = {
    store,
    chunkStore,
    connection,
    humanView,
    worldView,
    renderOnce: () => app.renderFrame(),
    get scene() {
      return app.sceneRenderer?.scene ?? null;
    },
    get camera() {
      return app.sceneRenderer?.camera ?? null;
    },
  };
}
