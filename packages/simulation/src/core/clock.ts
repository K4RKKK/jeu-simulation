import type { ClockSnapshot } from '@civ/shared';
import type { TimeConfig } from '../config/simulationConfig.js';

export interface SimulationClockState {
  currentTick: number;
  totalGameSeconds: number;
  timeScale: number;
  paused: boolean;
}

/**
 * Horloge du monde (CLAUDE.md règle 4).
 *
 * Elle ne connaît pas le temps réel : elle ne sait qu'avancer d'un tick. C'est la boucle
 * (`SimulationLoop`) qui décide *quand* appeler `advance()`, en fonction de `timeScale`.
 * Ce découplage est ce qui permet d'exécuter 10 jours de simulation en quelques secondes
 * dans le CLI headless sans changer une ligne des systèmes.
 */
export class SimulationClock {
  private tick = 0;
  private gameSecondsTotal: number;
  private scale = 1;
  private isPaused = false;

  constructor(private readonly config: TimeConfig) {
    this.gameSecondsTotal = config.startHourOfDay * 3600;
  }

  /* ---- Progression -------------------------------------------------- */

  /** Avance d'un nombre entier de ticks. Ignore volontairement l'état de pause :
   * la décision de ne pas avancer appartient à l'appelant (boucle ou `Simulation`). */
  advance(ticks = 1): void {
    if (ticks < 0 || !Number.isInteger(ticks)) {
      throw new RangeError(`advance(${ticks}) requires a non-negative integer`);
    }
    this.tick += ticks;
    this.gameSecondsTotal += ticks * this.config.gameSecondsPerTick;
  }

  /* ---- Lecture ------------------------------------------------------ */

  get currentTick(): number {
    return this.tick;
  }

  /** Temps de jeu absolu depuis le début du monde, en secondes. */
  get totalGameSeconds(): number {
    return this.gameSecondsTotal;
  }

  /** Durée d'un tick en secondes de jeu — utilisée par les systèmes pour intégrer. */
  get gameSecondsPerTick(): number {
    return this.config.gameSecondsPerTick;
  }

  private get secondsPerDay(): number {
    return this.config.hoursPerDay * 3600;
  }

  private get secondsPerYear(): number {
    return this.secondsPerDay * this.config.daysPerYear;
  }

  /** Secondes dans la minute courante (0..59). */
  get gameSeconds(): number {
    return Math.floor(this.gameSecondsTotal % 60);
  }

  /** Minutes dans l'heure courante (0..59). */
  get gameMinutes(): number {
    return Math.floor((this.gameSecondsTotal / 60) % 60);
  }

  /** Heure du jour (0..hoursPerDay-1). */
  get gameHours(): number {
    return Math.floor((this.gameSecondsTotal / 3600) % this.config.hoursPerDay);
  }

  /** Jour de l'année, à partir de 1. */
  get day(): number {
    return Math.floor((this.gameSecondsTotal % this.secondsPerYear) / this.secondsPerDay) + 1;
  }

  /** Jour absolu depuis le début du monde, à partir de 1. */
  get totalDays(): number {
    return Math.floor(this.gameSecondsTotal / this.secondsPerDay) + 1;
  }

  /** Année, à partir de 1. */
  get year(): number {
    return Math.floor(this.gameSecondsTotal / this.secondsPerYear) + 1;
  }

  /** Progression dans la journée, 0 = minuit, 0.5 = midi. */
  get dayProgress(): number {
    return (this.gameSecondsTotal % this.secondsPerDay) / this.secondsPerDay;
  }

  /** Progression dans l'année, 0 = premier jour. */
  get yearProgress(): number {
    return (this.gameSecondsTotal % this.secondsPerYear) / this.secondsPerYear;
  }

  /* ---- Contrôle ----------------------------------------------------- */

  get timeScale(): number {
    return this.scale;
  }

  setTimeScale(value: number): void {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`setTimeScale(${value}) requires a positive finite number`);
    }
    this.scale = value;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
  }

  /* ---- Sérialisation ------------------------------------------------ */

  getState(): SimulationClockState {
    return {
      currentTick: this.tick,
      totalGameSeconds: this.gameSecondsTotal,
      timeScale: this.scale,
      paused: this.isPaused,
    };
  }

  setState(state: SimulationClockState): void {
    this.tick = state.currentTick;
    this.gameSecondsTotal = state.totalGameSeconds;
    this.scale = state.timeScale;
    this.isPaused = state.paused;
  }

  toSnapshot(): ClockSnapshot {
    return {
      tick: this.tick,
      year: this.year,
      day: this.day,
      hour: this.gameHours,
      minute: this.gameMinutes,
      dayProgress: Math.round(this.dayProgress * 1000) / 1000,
      timeScale: this.scale,
      paused: this.isPaused,
    };
  }

  /** Date de jeu déterministe d'un événement, indépendante de sa date de réception. */
  dateAtTick(tick: number): Pick<ClockSnapshot, 'year' | 'day' | 'hour' | 'minute'> {
    if (tick < 0 || !Number.isInteger(tick)) {
      throw new RangeError(`dateAtTick(${tick}) requires a non-negative integer`);
    }
    const totalSeconds = this.config.startHourOfDay * 3600 + tick * this.config.gameSecondsPerTick;
    const secondsPerDay = this.config.hoursPerDay * 3600;
    const secondsPerYear = secondsPerDay * this.config.daysPerYear;
    return {
      year: Math.floor(totalSeconds / secondsPerYear) + 1,
      day: Math.floor((totalSeconds % secondsPerYear) / secondsPerDay) + 1,
      hour: Math.floor((totalSeconds / 3600) % this.config.hoursPerDay),
      minute: Math.floor((totalSeconds / 60) % 60),
    };
  }

  format(): string {
    const hh = String(this.gameHours).padStart(2, '0');
    const mm = String(this.gameMinutes).padStart(2, '0');
    return `Y${this.year} D${this.day} ${hh}:${mm}`;
  }
}
