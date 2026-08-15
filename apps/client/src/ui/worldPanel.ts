import type { WorldStore } from '../net/worldStore.js';
import type { ChunkStore } from '../world/chunkStore.js';

export class WorldPanel {
  constructor(
    private readonly panel: HTMLElement,
    private readonly content: HTMLElement,
    private readonly store: WorldStore,
    private readonly chunks: ChunkStore,
  ) {
    this.panel.inert = !this.isOpen;
  }

  get isOpen(): boolean {
    return this.panel.classList.contains('is-open');
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.panel.classList.add('is-open');
    this.panel.inert = false;
    this.panel.setAttribute('aria-hidden', 'false');
    this.render();
  }

  close(): void {
    this.panel.classList.remove('is-open');
    this.panel.inert = true;
    this.panel.setAttribute('aria-hidden', 'true');
  }

  refreshIfOpen(): void {
    if (this.isOpen) this.render();
  }

  render(): void {
    const clock = this.store.clock;
    const environment = this.store.environment;
    const metadata = this.chunks.metadata;
    this.content.innerHTML = `
      <div class="overview-number">${clock ? `Année ${clock.year}` : '—'}</div>
      <dl class="overview-list">
        <dt>Jour</dt><dd>${clock?.day ?? '—'}</dd>
        <dt>Saison</dt><dd>${environment ? capitalize(environment.season) : '—'}</dd>
        <dt>Température</dt><dd>${environment ? `${Math.round(environment.ambientTemperatureC)} °C` : '—'}</dd>
        <dt>Météo</dt><dd>${environment?.weather ? weatherLabel(environment.weather.kind) : '—'}</dd>
        <dt>Précipitations</dt><dd>${environment?.weather ? `${Math.round(environment.weather.precipitation01 * 100)} %` : '—'}</dd>
        <dt>Vent</dt><dd>${environment?.weather ? `${environment.weather.windMps.toFixed(1)} m/s` : '—'}</dd>
        <dt>Population</dt><dd>${(this.store.stats?.humanCount ?? this.store.humanCount).toLocaleString('fr-FR')}</dd>
        <dt>Personnes observées</dt><dd>${this.store.humanCount.toLocaleString('fr-FR')}</dd>
        <dt>Régions observées</dt><dd>${metadata ? this.chunks.observedRegionCount : '—'}</dd>
        <dt>Étendues d'eau observées</dt><dd>${metadata ? this.chunks.observedWaterBodyCount : '—'}</dd>
      </dl>
    `;
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase('fr-FR') + value.slice(1);
}

function weatherLabel(
  kind: NonNullable<NonNullable<WorldStore['environment']>['weather']>['kind'],
): string {
  const labels = {
    clear: 'Ciel clair',
    cloudy: 'Nuageux',
    rain: 'Pluie',
    storm: 'Orage',
    fog: 'Brouillard',
    snow: 'Neige',
  } as const;
  return labels[kind];
}
