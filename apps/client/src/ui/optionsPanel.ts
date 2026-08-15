import {
  loadGraphicsSettings,
  presetFor,
  saveGraphicsSettings,
  settingsForPreset,
  type GraphicsPreset,
  type GraphicsSettings,
  type QualityLevel,
} from '../settings/graphicsSettings.js';
import {
  CONTROL_ACTIONS,
  CONTROL_LABELS,
  getControlSettings,
  keyLabel,
  resetControlSettings,
  setControlBinding,
} from '../settings/controlSettings.js';
import { loadInterfaceSettings, saveInterfaceSettings } from '../settings/interfaceSettings.js';

const PRESET_LABELS: Record<GraphicsPreset, string> = {
  low: 'Faible',
  medium: 'Moyen',
  high: 'Élevé',
  custom: 'Personnalisé',
};

const LEVEL_LABELS: Record<QualityLevel, string> = {
  low: 'Faible',
  medium: 'Moyen',
  high: 'Élevé',
};

const FIELDS: readonly { key: keyof GraphicsSettings; label: string }[] = [
  { key: 'renderDistance', label: 'Distance de rendu' },
  { key: 'decorativeDensity', label: 'Densité décorative' },
  { key: 'displayQuality', label: 'Qualité d’affichage' },
];

/**
 * Panneau Options — uniquement des réglages graphiques réellement câblés (voir
 * `graphicsSettings.ts` pour ce à quoi chacun correspond concrètement). Pas de curseur
 * « ombres »/« antialiasing » : rien dans le renderer ne les rend ajustables en direct
 * aujourd'hui (l'antialiasing est fixé à la construction du contexte WebGL, les ombres
 * ne sont pas implémentées) — les ajouter ici sans effet réel serait le « faux code »
 * que CLAUDE.md interdit.
 */
export class OptionsPanel {
  private settings: GraphicsSettings;

  constructor(
    private readonly panel: HTMLElement,
    private readonly content: HTMLElement,
    private readonly onChange: (settings: GraphicsSettings) => void,
  ) {
    this.panel.inert = !this.isOpen;
    this.settings = loadGraphicsSettings();
    this.render();
  }

  get isOpen(): boolean {
    return this.panel.classList.contains('is-open');
  }

  /** Réglages actuels — appelé une fois au démarrage pour appliquer l'état restauré. */
  get current(): GraphicsSettings {
    return this.settings;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.panel.classList.add('is-open');
    this.panel.inert = false;
    this.panel.setAttribute('aria-hidden', 'false');
  }

  close(): void {
    this.panel.classList.remove('is-open');
    this.panel.inert = true;
    this.panel.setAttribute('aria-hidden', 'true');
  }

  private render(): void {
    const preset = presetFor(this.settings);
    const fragment = document.createDocumentFragment();

    const presetRow = document.createElement('div');
    presetRow.className = 'options-presets';
    for (const level of ['low', 'medium', 'high'] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = PRESET_LABELS[level];
      button.className = preset === level ? 'is-active' : '';
      button.addEventListener('click', () => this.applyPreset(level));
      presetRow.append(button);
    }
    const customButton = document.createElement('button');
    customButton.type = 'button';
    customButton.textContent = PRESET_LABELS.custom;
    customButton.className = 'options-presets__custom' + (preset === 'custom' ? ' is-active' : '');
    customButton.disabled = true;
    customButton.title = 'Choisi automatiquement dès qu’un réglage est ajusté individuellement.';
    presetRow.append(customButton);
    fragment.append(presetRow);

    for (const field of FIELDS) {
      const row = document.createElement('label');
      row.className = 'options-field';
      const name = document.createElement('span');
      name.textContent = field.label;
      const select = document.createElement('select');
      for (const level of ['low', 'medium', 'high'] as const) {
        const option = document.createElement('option');
        option.value = level;
        option.textContent = LEVEL_LABELS[level];
        option.selected = this.settings[field.key] === level;
        select.append(option);
      }
      select.addEventListener('change', () => {
        this.setLevel(field.key, select.value as QualityLevel);
      });
      row.append(name, select);
      fragment.append(row);
    }

    fragment.append(this.sectionTitle('Interface'));
    const interfaceSettings = loadInterfaceSettings();
    fragment.append(
      this.checkbox('Interface compacte', interfaceSettings.compact, (checked) => {
        saveInterfaceSettings({ ...loadInterfaceSettings(), compact: checked });
      }),
      this.checkbox('Réduire les animations', interfaceSettings.reducedMotion, (checked) => {
        saveInterfaceSettings({ ...loadInterfaceSettings(), reducedMotion: checked });
      }),
    );

    fragment.append(this.sectionTitle('Commandes'));
    const bindings = getControlSettings();
    const controls = document.createElement('div');
    controls.className = 'options-controls';
    for (const action of CONTROL_ACTIONS) {
      const row = document.createElement('div');
      row.className = 'options-field';
      const label = document.createElement('span');
      label.textContent = CONTROL_LABELS[action];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'options-key';
      button.textContent = keyLabel(bindings[action]);
      button.addEventListener('click', () => {
        button.textContent = 'Appuyez…';
        button.classList.add('is-listening');
        const capture = (event: KeyboardEvent) => {
          event.preventDefault();
          if (event.code !== 'Escape') setControlBinding(action, event.code);
          window.removeEventListener('keydown', capture, true);
          this.render();
        };
        window.addEventListener('keydown', capture, { capture: true, once: true });
      });
      row.append(label, button);
      controls.append(row);
    }
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'options-reset';
    reset.textContent = 'Rétablir les touches par défaut';
    reset.addEventListener('click', () => {
      resetControlSettings();
      this.render();
    });
    controls.append(reset);
    fragment.append(controls);

    this.content.replaceChildren(fragment);
  }

  private applyPreset(level: QualityLevel): void {
    this.settings = settingsForPreset(level);
    this.commit();
  }

  private setLevel(key: keyof GraphicsSettings, level: QualityLevel): void {
    this.settings = { ...this.settings, [key]: level };
    this.commit();
  }

  private commit(): void {
    saveGraphicsSettings(this.settings);
    this.onChange(this.settings);
    this.render();
  }

  private sectionTitle(text: string): HTMLHeadingElement {
    const title = document.createElement('h3');
    title.className = 'options-section-title';
    title.textContent = text;
    return title;
  }

  private checkbox(
    labelText: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
  ): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'options-field options-toggle';
    const text = document.createElement('span');
    text.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    label.append(text, input);
    return label;
  }
}
