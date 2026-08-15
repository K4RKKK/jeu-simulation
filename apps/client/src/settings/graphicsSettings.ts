export type QualityLevel = 'low' | 'medium' | 'high';
export type GraphicsPreset = QualityLevel | 'custom';

/**
 * Trois réglages, chacun câblé à un mécanisme RÉEL déjà existant — jamais un curseur
 * décoratif sans effet :
 * - `renderDistance` → rayon de chunks déclaré au serveur (`Application.setRenderDistanceChunks`).
 * - `decorativeDensity` → distance de LOD des petits éléments (`WorldView.setDetailDistanceChunks`).
 * - `displayQuality` → pixel ratio du renderer (`SceneRenderer.setPixelRatio`).
 */
export interface GraphicsSettings {
  renderDistance: QualityLevel;
  decorativeDensity: QualityLevel;
  displayQuality: QualityLevel;
}

const RENDER_DISTANCE_CHUNKS: Record<QualityLevel, number> = { low: 3, medium: 5, high: 7 };
const DETAIL_DISTANCE_CHUNKS: Record<QualityLevel, number> = { low: 0, medium: 2, high: 4 };

export const DEFAULT_GRAPHICS_SETTINGS: GraphicsSettings = {
  renderDistance: 'medium',
  decorativeDensity: 'medium',
  displayQuality: 'medium',
};

const STORAGE_KEY = 'civ:settings:graphics';
const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];

function isQualityLevel(value: unknown): value is QualityLevel {
  return typeof value === 'string' && (QUALITY_LEVELS as readonly string[]).includes(value);
}

export function loadGraphicsSettings(): GraphicsSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GRAPHICS_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_GRAPHICS_SETTINGS };
    const record = parsed as Partial<Record<keyof GraphicsSettings, unknown>>;
    return {
      renderDistance: isQualityLevel(record.renderDistance)
        ? record.renderDistance
        : DEFAULT_GRAPHICS_SETTINGS.renderDistance,
      decorativeDensity: isQualityLevel(record.decorativeDensity)
        ? record.decorativeDensity
        : DEFAULT_GRAPHICS_SETTINGS.decorativeDensity,
      displayQuality: isQualityLevel(record.displayQuality)
        ? record.displayQuality
        : DEFAULT_GRAPHICS_SETTINGS.displayQuality,
    };
  } catch {
    // Stockage indisponible (mode privé) ou valeur corrompue : les réglages par défaut
    // restent valides pour la session, jamais un écran cassé.
    return { ...DEFAULT_GRAPHICS_SETTINGS };
  }
}

export function saveGraphicsSettings(settings: GraphicsSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Le mode privé peut refuser localStorage : les réglages restent valides pour la session.
  }
}

/** `'custom'` dès que les trois réglages ne sont pas alignés sur un même niveau. */
export function presetFor(settings: GraphicsSettings): GraphicsPreset {
  for (const level of QUALITY_LEVELS) {
    if (
      settings.renderDistance === level &&
      settings.decorativeDensity === level &&
      settings.displayQuality === level
    ) {
      return level;
    }
  }
  return 'custom';
}

export function settingsForPreset(preset: QualityLevel): GraphicsSettings {
  return { renderDistance: preset, decorativeDensity: preset, displayQuality: preset };
}

export function renderDistanceChunksFor(level: QualityLevel): number {
  return RENDER_DISTANCE_CHUNKS[level];
}

export function detailDistanceChunksFor(level: QualityLevel): number {
  return DETAIL_DISTANCE_CHUNKS[level];
}

/**
 * `window` lu à l'appel, jamais au chargement du module : ce fichier doit rester
 * important-able (et donc testable) sans DOM disponible — voir les autres fonctions
 * pures de ce module, réellement exercées par `graphicsSettings.test.ts`.
 */
export function pixelRatioFor(level: QualityLevel): number {
  if (level === 'low') return 1;
  if (level === 'medium') return 1.5;
  return Math.min(window.devicePixelRatio, 2);
}
