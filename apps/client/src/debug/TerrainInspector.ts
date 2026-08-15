import type { WorldGenerationMetadata } from '@civ/shared';
import type { TerrainProbe } from '../world/chunkStore.js';

/**
 * Inspecteur de terrain — panneau `#terrain-panel` togglé par F3.
 *
 * Cliquer sur le sol répond à la question qui revient sans cesse pendant le réglage
 * d'une génération : « pourquoi *ça*, ici ? ». Tous les champs affichés sont ceux qui
 * ont servi à décider du biome et des ressources — pas des valeurs recalculées côté
 * client. En particulier, la praticabilité (`walkable`) est celle transmise par le
 * serveur (pente + eau guéable), jamais un seuil approximatif réinventé ici : un bug
 * corrigé affichait « marchable » d'après `pente < 0.5` seul, en désaccord possible
 * avec ce que le pathfinding refusait réellement.
 */
export class TerrainInspector {
  constructor(
    private readonly panel: HTMLElement,
    private readonly content: HTMLElement,
  ) {}

  show(probe: TerrainProbe, metadata: WorldGenerationMetadata | null): void {
    const biome = metadata?.biomes[probe.biomeIndex];

    this.content.innerHTML = `
      <div style="margin-bottom:8px">
        <span style="color:#6b7280">Position monde :</span>
        <span style="color:#e2e8f0">x=${probe.worldX.toFixed(1)} z=${probe.worldZ.toFixed(1)}</span>
      </div>
      <div style="margin-bottom:12px">
        <span style="color:#6b7280">Chunk :</span>
        <span style="color:#e2e8f0">${probe.chunkKey}</span>
      </div>

      <div class="dev-section-title">TERRAIN</div>
      <dl>
        <dt>altitude</dt><dd>${probe.heightM.toFixed(2)} m</dd>
        <dt>pente</dt><dd>${probe.slope01.toFixed(2)}</dd>
        <dt>biome</dt><dd>${biome ? biome.displayName : 'Inconnu'}</dd>
        <dt>région</dt><dd>(${probe.regionX}, ${probe.regionZ})</dd>
        <dt>praticable</dt><dd>${probe.walkable ? '✓ marchable' : '✗ bloqué'}</dd>
      </dl>
      <br/>
      <div class="dev-section-title">CONDITIONS</div>
      <dl>
        <dt>humidité</dt><dd>${probe.moisture01.toFixed(2)}</dd>
        <dt>fertilité</dt><dd>${probe.fertility01.toFixed(2)}</dd>
        <dt>roche</dt><dd>${probe.rockiness01.toFixed(2)}</dd>
        <dt>température</dt><dd>${probe.temperature01.toFixed(2)}</dd>
        <dt>végétation</dt><dd>${probe.vegetation01.toFixed(2)}</dd>
      </dl>
      <br/>
      <div class="dev-section-title">HYDROLOGIE</div>
      <dl>
        <dt>type eau</dt><dd>${probe.waterHeightM !== null ? 'eau' : 'aucune'}</dd>
        <dt>profondeur</dt><dd>${probe.waterHeightM !== null ? (probe.waterHeightM - probe.heightM).toFixed(2) + ' m' : '-'}</dd>
      </dl>
    `;
    this.panel.classList.remove('hidden');
  }

  hide(): void {
    this.panel.classList.add('hidden');
    this.content.innerHTML = '';
  }
}
