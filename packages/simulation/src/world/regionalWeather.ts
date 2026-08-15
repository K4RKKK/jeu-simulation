import { HashDomain, type RegionCoordinate } from '@civ/procedural';
import type { WeatherConfig } from '../config/simulationConfig.js';
import type { SimulationClock } from '../core/clock.js';
import type { RegionAggregator } from './regionAggregator.js';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow';

export interface RegionalWeatherSample {
  readonly region: RegionCoordinate;
  readonly kind: WeatherKind;
  readonly precipitation01: number;
  readonly cloudCover01: number;
  readonly humidity01: number;
  readonly windMps: number;
  readonly visibility01: number;
  readonly temperatureDeltaC: number;
  readonly periodIndex: number;
  readonly transition01: number;
}

interface RawWeather {
  precipitation01: number;
  cloudCover01: number;
  humidity01: number;
  windMps: number;
  temperatureDeltaC: number;
}

/**
 * Météo macroscopique sans état mutable.
 *
 * Chaque régime est une fonction de `(seed, région, période)`. La fin d'une période
 * interpole vers la suivante : aucun saut brutal, aucune file d'événements à sauver,
 * et une restauration retombe exactement sur le même ciel au même tick.
 */
export class RegionalWeather {
  private readonly hash: HashDomain;

  constructor(
    seed: string,
    private readonly config: WeatherConfig,
    private readonly regions: RegionAggregator,
  ) {
    if (config.periodHours <= 0) throw new RangeError('weather.periodHours must be positive');
    if (config.transitionHours <= 0 || config.transitionHours > config.periodHours) {
      throw new RangeError('weather.transitionHours must be in ]0, periodHours]');
    }
    this.hash = new HashDomain(seed, 'regional-weather-v1');
  }

  sample(
    clock: SimulationClock,
    coordinate: RegionCoordinate,
    ambientTemperatureC: number,
  ): RegionalWeatherSample {
    const periodSeconds = this.config.periodHours * 3600;
    const periodIndex = Math.floor(clock.totalGameSeconds / periodSeconds);
    const progress = (clock.totalGameSeconds % periodSeconds) / periodSeconds;
    const transitionStart = 1 - this.config.transitionHours / this.config.periodHours;
    const transition01 = smoothstep(clamp01((progress - transitionStart) / (1 - transitionStart)));
    const current = this.raw(coordinate, periodIndex);
    const next = this.raw(coordinate, periodIndex + 1);
    const blended = blend(current, next, transition01);
    const temperatureC = ambientTemperatureC + blended.temperatureDeltaC;
    const fogStrength =
      blended.humidity01 >= this.config.fogHumidityThreshold01 && blended.windMps < 4
        ? clamp01(
            (blended.humidity01 - this.config.fogHumidityThreshold01) /
              (1 - this.config.fogHumidityThreshold01),
          )
        : 0;
    const visibility01 = clamp01(1 - blended.precipitation01 * 0.5 - fogStrength * 0.75);

    return {
      region: { ...coordinate },
      kind: weatherKind(blended, temperatureC, fogStrength, this.config.snowThresholdC),
      precipitation01: round3(blended.precipitation01),
      cloudCover01: round3(blended.cloudCover01),
      humidity01: round3(blended.humidity01),
      windMps: round2(blended.windMps),
      visibility01: round3(visibility01),
      temperatureDeltaC: round2(blended.temperatureDeltaC),
      periodIndex,
      transition01: round3(transition01),
    };
  }

  private raw(coordinate: RegionCoordinate, periodIndex: number): RawWeather {
    const staticStats = this.regions.staticStats(coordinate);
    const chance = clamp01(
      this.config.precipitationBaseChance01 +
        staticStats.moistureMean01 * this.config.moistureInfluence01,
    );
    const precipitationRoll = this.hash.unitSalted(0, coordinate.x, coordinate.z, periodIndex);
    const precipitation01 =
      precipitationRoll < chance
        ? clamp01(0.2 + this.hash.unitSalted(1, coordinate.x, coordinate.z, periodIndex) * 0.8)
        : 0;
    const cloudCover01 = clamp01(
      0.08 +
        staticStats.moistureMean01 * 0.32 +
        this.hash.unitSalted(2, coordinate.x, coordinate.z, periodIndex) * 0.35 +
        precipitation01 * 0.5,
    );
    const humidity01 = clamp01(
      staticStats.moistureMean01 * 0.58 + cloudCover01 * 0.24 + precipitation01 * 0.34,
    );
    const windMps =
      0.5 +
      this.hash.unitSalted(3, coordinate.x, coordinate.z, periodIndex) * this.config.maxWindMps;
    const naturalVariation =
      (this.hash.unitSalted(4, coordinate.x, coordinate.z, periodIndex) - 0.5) * 2;
    const temperatureDeltaC =
      naturalVariation -
      (cloudCover01 * 0.25 + precipitation01 * 0.75) * this.config.maxTemperatureDropC;
    return { precipitation01, cloudCover01, humidity01, windMps, temperatureDeltaC };
  }
}

function weatherKind(
  weather: RawWeather,
  temperatureC: number,
  fogStrength: number,
  snowThresholdC: number,
): WeatherKind {
  if (weather.precipitation01 > 0.12) {
    if (temperatureC <= snowThresholdC) return 'snow';
    if (weather.precipitation01 >= 0.72 && weather.windMps >= 9) return 'storm';
    return 'rain';
  }
  if (fogStrength > 0.08) return 'fog';
  return weather.cloudCover01 >= 0.52 ? 'cloudy' : 'clear';
}

function blend(from: RawWeather, to: RawWeather, amount: number): RawWeather {
  return {
    precipitation01: lerp(from.precipitation01, to.precipitation01, amount),
    cloudCover01: lerp(from.cloudCover01, to.cloudCover01, amount),
    humidity01: lerp(from.humidity01, to.humidity01, amount),
    windMps: lerp(from.windMps, to.windMps, amount),
    temperatureDeltaC: lerp(from.temperatureDeltaC, to.temperatureDeltaC, amount),
  };
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
