export type ControlAction =
  | 'forward'
  | 'backward'
  | 'left'
  | 'right'
  | 'rotateLeft'
  | 'rotateRight'
  | 'follow'
  | 'cinematic'
  | 'interface';

export type ControlSettings = Record<ControlAction, string>;

export const CONTROL_LABELS: Readonly<Record<ControlAction, string>> = {
  forward: 'Avancer',
  backward: 'Reculer',
  left: 'Aller à gauche',
  right: 'Aller à droite',
  rotateLeft: 'Tourner à gauche',
  rotateRight: 'Tourner à droite',
  follow: 'Suivre la personne',
  cinematic: 'Mode cinématique',
  interface: 'Afficher/masquer l’interface',
};

export const CONTROL_ACTIONS = Object.keys(CONTROL_LABELS) as ControlAction[];

export const DEFAULT_CONTROL_SETTINGS: ControlSettings = {
  forward: 'KeyZ',
  backward: 'KeyS',
  left: 'KeyQ',
  right: 'KeyD',
  rotateLeft: 'KeyA',
  rotateRight: 'KeyE',
  follow: 'KeyF',
  cinematic: 'KeyC',
  interface: 'KeyH',
};

const STORAGE_KEY = 'civ:settings:controls';
let current = load();

export function controlCode(action: ControlAction): string {
  return current[action];
}

export function getControlSettings(): ControlSettings {
  return { ...current };
}

export function setControlBinding(action: ControlAction, code: string): ControlSettings {
  const duplicate = CONTROL_ACTIONS.find(
    (candidate) => candidate !== action && current[candidate] === code,
  );
  const previous = current[action];
  current = { ...current, [action]: code };
  if (duplicate) current[duplicate] = previous;
  persist();
  window.dispatchEvent(new CustomEvent('civ:controls-changed'));
  return getControlSettings();
}

export function resetControlSettings(): ControlSettings {
  current = { ...DEFAULT_CONTROL_SETTINGS };
  persist();
  window.dispatchEvent(new CustomEvent('civ:controls-changed'));
  return getControlSettings();
}

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return (
    (
      {
        Space: 'Espace',
        Escape: 'Échap',
        ArrowUp: '↑',
        ArrowDown: '↓',
        ArrowLeft: '←',
        ArrowRight: '→',
      } as Record<string, string>
    )[code] ?? code
  );
}

function load(): ControlSettings {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_CONTROL_SETTINGS };
    const values = parsed as Partial<Record<ControlAction, unknown>>;
    const result = { ...DEFAULT_CONTROL_SETTINGS };
    for (const action of CONTROL_ACTIONS) {
      if (typeof values[action] === 'string' && values[action].length > 0)
        result[action] = values[action];
    }
    return result;
  } catch {
    return { ...DEFAULT_CONTROL_SETTINGS };
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Les commandes restent actives pour la session si le stockage est indisponible.
  }
}
