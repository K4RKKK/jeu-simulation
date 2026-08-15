import type { ServerConnection } from '../net/connection.js';
import type { WorldStore } from '../net/worldStore.js';

const SUPPORTED_SPEEDS = new Set([1, 2, 4, 8]);
type WeatherSnapshot = NonNullable<NonNullable<WorldStore['environment']>['weather']>;

/**
 * Barre de jeu minimale : elle ne montre que le temps du monde, la population,
 * la météo perceptible et les contrôles temporels.
 *
 * Le serveur reste la seule source de vérité. Les clics envoient une intention et
 * `update()` n'affiche le nouvel état qu'une fois celui-ci reçu dans le `WorldStore`.
 */
export class PlayerHud {
  private readonly dateElement: HTMLElement;
  private readonly populationElement: HTMLElement;
  private readonly weatherElement: HTMLElement;
  private readonly speedButtons: readonly HTMLButtonElement[];
  private readonly pauseButton: HTMLButtonElement;

  constructor(
    root: HTMLElement,
    private readonly store: WorldStore,
    private readonly connection: ServerConnection,
  ) {
    this.dateElement = requiredElement(root, '#hud-date');
    this.populationElement = requiredElement(root, '#hud-population');
    this.weatherElement = requiredElement(root, '#hud-weather');
    this.speedButtons = [...root.querySelectorAll<HTMLButtonElement>('button[data-speed]')];
    this.pauseButton = requiredElement(root, 'button[data-action="pause-toggle"]');

    this.bindControls();
    this.update();
  }

  update(): void {
    const { clock, environment } = this.store;

    setText(this.dateElement, clock ? formatDate(clock) : '—');
    setText(
      this.populationElement,
      formatPopulation(this.store.stats?.humanCount ?? this.store.humanCount),
    );
    setText(this.weatherElement, environment ? formatWeather(environment) : '—');

    if (environment) {
      this.weatherElement.title = environment.weather
        ? weatherLabel(environment.weather.kind)
        : capitalize(environment.season);
    } else {
      this.weatherElement.removeAttribute('title');
    }

    const controlsAvailable = clock !== null && this.connection.status === 'open';
    this.pauseButton.disabled = !controlsAvailable;
    this.pauseButton.classList.toggle('is-active', clock?.paused === true);
    this.pauseButton.dataset.state = clock?.paused === true ? 'paused' : 'running';
    this.pauseButton.setAttribute('aria-pressed', String(clock?.paused === true));

    const pauseLabel = clock?.paused === true ? 'Reprendre la simulation' : 'Mettre en pause';
    this.pauseButton.textContent = clock?.paused === true ? '▶' : 'Ⅱ';
    this.pauseButton.setAttribute('aria-label', pauseLabel);
    this.pauseButton.title = pauseLabel;

    for (const button of this.speedButtons) {
      const speed = readSpeed(button);
      const active = clock !== null && !clock.paused && speed === clock.timeScale;
      button.disabled = !controlsAvailable || speed === null;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  private bindControls(): void {
    this.pauseButton.addEventListener('click', () => {
      const clock = this.store.clock;
      if (!clock) return;

      this.connection.send({
        t: 'control',
        action: clock.paused ? 'resume' : 'pause',
      });
    });

    for (const button of this.speedButtons) {
      button.addEventListener('click', () => {
        const timeScale = readSpeed(button);
        if (timeScale === null) return;

        this.connection.send({
          t: 'control',
          action: 'setTimeScale',
          timeScale,
        });
      });
    }
  }
}

function requiredElement<T extends Element>(root: HTMLElement, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`PlayerHud: élément requis introuvable (${selector})`);
  return element;
}

function readSpeed(button: HTMLButtonElement): number | null {
  const value = Number(button.dataset.speed);
  return SUPPORTED_SPEEDS.has(value) ? value : null;
}

function formatDate(clock: NonNullable<WorldStore['clock']>): string {
  const time = `${pad(clock.hour)}:${pad(clock.minute)}`;
  const day = `Jour ${clock.day}`;
  return clock.year > 1 ? `An ${clock.year} · ${day} • ${time}` : `${day} • ${time}`;
}

function formatPopulation(count: number): string {
  return `${count.toLocaleString('fr-FR')} ${count > 1 ? 'habitants' : 'habitant'}`;
}

function formatWeather(environment: NonNullable<WorldStore['environment']>): string {
  const icon = environment.weather
    ? WEATHER_ICONS[environment.weather.kind]
    : environment.isDaytime
      ? '☀'
      : '☾';
  return `${icon} ${Math.round(environment.ambientTemperatureC)} °C`;
}

const WEATHER_ICONS: Record<WeatherSnapshot['kind'], string> = {
  clear: '☀',
  cloudy: '☁',
  rain: '🌧',
  storm: '⛈',
  fog: '🌫',
  snow: '🌨',
};

function weatherLabel(kind: WeatherSnapshot['kind']): string {
  return {
    clear: 'Ciel clair',
    cloudy: 'Nuageux',
    rain: 'Pluie',
    storm: 'Orage',
    fog: 'Brouillard',
    snow: 'Neige',
  }[kind];
}

function setText(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase('fr-FR') + value.slice(1);
}
