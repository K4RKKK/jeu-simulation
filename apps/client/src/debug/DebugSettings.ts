import type { TerrainColorMode } from '../render/terrainColorModes.js';

/**
 * Réglages du panneau de développement (F2).
 *
 * Volontairement réduit à ce qui a un effet visuel réel :
 * - `chunkBorders` pilote `WorldView.setChunkBordersVisible` (existant, fonctionnel) ;
 * - `colorMode` pilote `WorldView.setColorMode` (existant, fonctionnel — un seul calque
 *   de couleur peut être actif à la fois, d'où un mode plutôt qu'un ensemble de cases
 *   indépendantes).
 *
 * Bug corrigé : l'ancienne version proposait des cases à cocher (« NavGrid », « Chemins
 * A* », « Chunks actifs », « Walkability »…) qui ne pilotaient rien — aucun calque de
 * rendu correspondant n'existe côté client. CLAUDE.md interdit le faux code : mieux
 * vaut un panneau plus court mais dont chaque contrôle fait exactement ce qu'il dit.
 */
export interface DebugSettings {
  showOverlay: boolean;
  activeTab: 'layers' | 'metrics' | 'network';
  chunkBorders: boolean;
  colorMode: TerrainColorMode;
}

export type DebugSettingsListener = (settings: DebugSettings) => void;

export class DebugStore {
  private settings: DebugSettings = {
    showOverlay: false,
    activeTab: 'layers',
    chunkBorders: false,
    colorMode: 'natural',
  };

  private listeners = new Set<DebugSettingsListener>();

  get(): Readonly<DebugSettings> {
    return this.settings;
  }

  set(patch: Partial<DebugSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.notify();
  }

  toggle(key: 'showOverlay' | 'chunkBorders'): void {
    this.settings = { ...this.settings, [key]: !this.settings[key] };
    this.notify();
  }

  subscribe(listener: DebugSettingsListener): void {
    this.listeners.add(listener);
  }

  unsubscribe(listener: DebugSettingsListener): void {
    this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.settings);
    }
  }
}
