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

/**
 * `KeyboardEvent.code` nomme la POSITION physique de la touche sur un clavier QWERTY de
 * référence, jamais ce qui est réellement imprimé dessus — indépendant de la disposition
 * réelle de l'utilisateur. Sur un clavier AZERTY (celui visé ici, comme tout le reste de
 * l'interface en français), les touches Z et A sont physiquement à l'emplacement QWERTY
 * de W et Q (et réciproquement) : coder `KeyZ` pour « avancer » revient donc à écouter la
 * touche physique portant un W, jamais la touche imprimée « Z ». D'où le bug signalé :
 * Z n'avançait pas, et la rotation semblait inversée avec le strafe latéral.
 *
 * Correspondance code physique → touche imprimée sur AZERTY : KeyQ→A, KeyW→Z, KeyA→Q
 * (S, D, E identiques sur les deux dispositions, donc inchangés).
 */
export const DEFAULT_CONTROL_SETTINGS: ControlSettings = {
  forward: 'KeyW', // touche imprimée « Z » sur AZERTY
  backward: 'KeyS',
  left: 'KeyA', // touche imprimée « Q » sur AZERTY
  right: 'KeyD',
  rotateLeft: 'KeyQ', // touche imprimée « A » sur AZERTY
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

/**
 * Les trois seules touches dont la lettre imprimée diffère entre QWERTY et AZERTY parmi
 * celles utilisées ici (voir la doc de `DEFAULT_CONTROL_SETTINGS`) — affichées selon ce
 * que l'utilisateur voit réellement sur son clavier, pas selon le nom de position `code`.
 */
const AZERTY_KEY_LABELS: Readonly<Record<string, string>> = {
  KeyQ: 'A',
  KeyW: 'Z',
  KeyA: 'Q',
};

export function keyLabel(code: string): string {
  if (code in AZERTY_KEY_LABELS) return AZERTY_KEY_LABELS[code] as string;
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
