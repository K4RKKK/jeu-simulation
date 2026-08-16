import type { EnvironmentSnapshot } from '@civ/shared';
import type { EnvironmentConfig } from '../config/simulationConfig.js';
import type { SimulationClock } from '../core/clock.js';
import { TAU, clamp } from '../core/math.js';

export type SeasonName = 'hiver' | 'printemps' | 'été' | 'automne';

export interface EnvironmentSample {
  ambientTemperatureC: number;
  /** Élévation solaire normalisée : -1 au plus profond de la nuit, 1 au zénith. */
  sunElevation: number;
  isDaytime: boolean;
  season: SeasonName;
}

/** Type de fournisseur du climat procédural : retourne la température normalisée du lieu. */
export type SpatialTemperatureProvider = (x: number, z: number) => number;

/**
 * État ambiant du monde, dérivé **uniquement** de l'horloge et du relief.
 *
 * Il n'y a pas d'état stocké : la température d'un instant donné est une fonction pure du
 * temps de jeu et de la position. Conséquence utile : rien à sauvegarder, rien à
 * resynchroniser, et un tick sauté ne fait pas dériver le climat.
 *
 * Depuis la phase 2, la variation spatiale existe : le climat procédural fournit une
 * température normalisée par lieu (latitude simulée et altitude comprises). Quand on
 * l'interroge avec une position, l'environnement l'intègre ; sans position, il reste
 * global (c'est le snapshot diffusé au client).
 */
export class Environment {
  private readonly seasons: readonly SeasonName[] = ['hiver', 'printemps', 'été', 'automne'];

  constructor(
    private readonly config: EnvironmentConfig,
    private readonly spatialTemperature?: SpatialTemperatureProvider,
  ) {}

  sample(clock: SimulationClock, x?: number, z?: number): EnvironmentSample {
    const dayPhase = clock.dayProgress;
    const yearPhase = clock.yearProgress;

    // Le pic thermique est décalé après midi : le sol restitue la chaleur avec du retard.
    const dailyCycle = Math.sin((dayPhase - 0.375) * TAU);
    const seasonalCycle = Math.sin((yearPhase - 0.25) * TAU);

    const spatialOffsetC =
      x !== undefined && z !== undefined && this.spatialTemperature
        ? // La température procédurale est normalisée : 0,5 est la moyenne du monde.
          (this.spatialTemperature(x, z) - 0.5) * this.config.spatialTemperatureAmplitudeC
        : 0;

    const ambientTemperatureC =
      this.config.baseTemperatureC +
      dailyCycle * this.config.dailyAmplitudeC +
      seasonalCycle * this.config.seasonalAmplitudeC +
      spatialOffsetC;

    // Élévation solaire : 0 au lever et au coucher, maximale au milieu de la journée.
    const sunriseProgress = this.config.sunriseHour / 24;
    const sunsetProgress = this.config.sunsetHour / 24;
    const isDaytime = dayPhase >= sunriseProgress && dayPhase <= sunsetProgress;

    let sunElevation: number;
    if (isDaytime) {
      const t = (dayPhase - sunriseProgress) / (sunsetProgress - sunriseProgress);
      sunElevation = Math.sin(t * Math.PI);
    } else {
      const nightLength = 1 - (sunsetProgress - sunriseProgress);
      const t =
        (dayPhase > sunsetProgress ? dayPhase - sunsetProgress : dayPhase + 1 - sunsetProgress) /
        nightLength;
      sunElevation = -Math.sin(t * Math.PI);
    }

    return {
      ambientTemperatureC: Math.round(ambientTemperatureC * 100) / 100,
      sunElevation: Math.round(clamp(sunElevation, -1, 1) * 1000) / 1000,
      isDaytime,
      season: this.seasonName(clock),
    };
  }

  /**
   * Saison dérivée de la progression annuelle.
   *
   * Le cycle thermique est le plus froid à `yearProgress = 0` et le plus chaud à 0,5 : les
   * quatre quarts de l'année sont donc hiver, printemps, été puis automne.
   */
  seasonName(clock: SimulationClock): SeasonName {
    const quarter = Math.min(3, Math.floor(clock.yearProgress * 4));
    return this.seasons[quarter] as SeasonName;
  }

  toSnapshot(clock: SimulationClock): EnvironmentSnapshot {
    return this.sample(clock);
  }
}
