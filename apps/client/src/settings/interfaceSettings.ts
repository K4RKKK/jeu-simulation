export interface InterfaceSettings {
  compact: boolean;
  reducedMotion: boolean;
}

const STORAGE_KEY = 'civ:settings:interface';

export function loadInterfaceSettings(): InterfaceSettings {
  try {
    const value = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? 'null',
    ) as Partial<InterfaceSettings> | null;
    return { compact: value?.compact === true, reducedMotion: value?.reducedMotion === true };
  } catch {
    return { compact: false, reducedMotion: false };
  }
}

export function saveInterfaceSettings(settings: InterfaceSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* session uniquement */
  }
  applyInterfaceSettings(settings);
}

export function applyInterfaceSettings(settings = loadInterfaceSettings()): void {
  document.body.dataset.interfaceDensity = settings.compact ? 'compact' : 'comfortable';
  document.body.dataset.motion = settings.reducedMotion ? 'reduced' : 'full';
}
