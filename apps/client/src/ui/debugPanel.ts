import type { ServerConnection } from '../net/connection.js';
import type { WorldStore } from '../net/worldStore.js';
import type { ChunkStore } from '../world/chunkStore.js';

export interface DebugPanelInputs {
  fps: number;
  drawnHumans: number;
  store: WorldStore;
  connection: ServerConnection;
  chunkStore: ChunkStore;
  renderedChunks: number;
  cameraChunk: { x: number; z: number };
}

/**
 * Panneau d'instrumentation.
 *
 * Il mélange volontairement deux origines : ce que mesure le client (FPS, latence, octets)
 * et ce que rapporte le serveur (durée de tick, coût par système). C'est la seule façon de
 * savoir, quand la simulation ralentit, de quel côté regarder.
 */
export class DebugPanel {
  private readonly rows = new Map<string, HTMLElement>();

  constructor(private readonly container: HTMLElement) {}

  update(inputs: DebugPanelInputs): void {
    const { store, connection } = inputs;
    const stats = store.stats;
    const clock = store.clock;

    this.set('FPS', inputs.fps.toFixed(0));
    this.set('Latence', `${connection.latencyMs} ms`);
    this.set('Connexion', connection.status);
    this.set('Reçu', formatBytes(connection.bytesReceived));
    this.set('Observateurs', String(store.clientCount));

    this.set(
      'Date du monde',
      clock ? `A${clock.year} J${clock.day} ${pad(clock.hour)}:${pad(clock.minute)}` : '—',
    );
    this.set('Tick', clock ? clock.tick.toLocaleString('fr-FR') : '—');
    this.set('Vitesse', clock ? (clock.paused ? 'en pause' : `×${clock.timeScale}`) : '—');
    this.set(
      'Saison',
      store.environment
        ? `${store.environment.season} (${store.environment.ambientTemperatureC.toFixed(1)} °C)`
        : '—',
    );

    this.set('Population', String(store.humanCount));
    this.set('Affichés', String(inputs.drawnHumans));
    this.set('Entités', stats ? String(stats.entityCount) : '—');

    const metadata = inputs.chunkStore.metadata;
    this.set('Monde', metadata ? `${metadata.sizeChunks}² chunks` : '—');
    this.set('Génération', metadata ? metadata.generationVersion : '—');
    this.set('Seed', metadata ? metadata.seed : '—');
    this.set('Points d’eau', metadata ? String(metadata.waterBodies.length) : '—');
    this.set('Caméra', `${inputs.cameraChunk.x}:${inputs.cameraChunk.z}`);
    this.set('Chunks reçus', String(inputs.chunkStore.size));
    this.set('Chunks rendus', String(inputs.renderedChunks));

    const chunkStats = store.chunkStats;
    this.set('Chunks en cache', chunkStats ? String(chunkStats.cached) : '—');
    this.set('Chunks actifs', chunkStats ? String(chunkStats.active) : '—');
    this.set('En file', chunkStats ? String(chunkStats.queued) : '—');
    this.set(
      'Génération chunk',
      chunkStats ? `${chunkStats.averageGenerationMs.toFixed(2)} ms` : '—',
    );

    this.set('Tick serveur', stats ? `${stats.averageTickMs.toFixed(3)} ms` : '—');
    this.set('Ticks/s', stats ? stats.ticksPerSecond.toFixed(1) : '—');

    for (const system of stats?.systems ?? []) {
      this.set(`  ${shortName(system.name)}`, `${system.averageMs.toFixed(3)} ms`);
    }
  }

  private set(label: string, value: string): void {
    let row = this.rows.get(label);
    if (!row) {
      const term = document.createElement('dt');
      term.textContent = label;
      const definition = document.createElement('dd');
      this.container.append(term, definition);
      row = definition;
      this.rows.set(label, row);
    }
    if (row.textContent !== value) row.textContent = value;
  }
}

function shortName(name: string): string {
  return name.replace(/System$/, '');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}
