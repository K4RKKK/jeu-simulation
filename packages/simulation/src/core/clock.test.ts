import { describe, expect, it } from 'vitest';
import type { TimeConfig } from '../config/simulationConfig.js';
import { SimulationClock } from './clock.js';

const config: TimeConfig = {
  tickRateHz: 20,
  gameSecondsPerTick: 1,
  hoursPerDay: 24,
  daysPerYear: 360,
  startHourOfDay: 0,
};

describe('SimulationClock', () => {
  it('starts at tick zero, day one, year one', () => {
    const clock = new SimulationClock(config);
    expect(clock.currentTick).toBe(0);
    expect(clock.totalGameSeconds).toBe(0);
    expect(clock.day).toBe(1);
    expect(clock.year).toBe(1);
    expect(clock.gameHours).toBe(0);
  });

  it('advances tick and game time together', () => {
    const clock = new SimulationClock(config);
    clock.advance(90);

    expect(clock.currentTick).toBe(90);
    expect(clock.totalGameSeconds).toBe(90);
    expect(clock.gameMinutes).toBe(1);
    expect(clock.gameSeconds).toBe(30);
  });

  it('rolls over hours, days and years', () => {
    const clock = new SimulationClock(config);
    clock.advance(3600 * 24); // exactement un jour
    expect(clock.day).toBe(2);
    expect(clock.gameHours).toBe(0);
    expect(clock.dayProgress).toBe(0);

    clock.advance(3600 * 24 * 359); // fin de la première année
    expect(clock.year).toBe(2);
    expect(clock.day).toBe(1);
  });

  it('reports progress through the day', () => {
    const clock = new SimulationClock(config);
    clock.advance(3600 * 12);
    expect(clock.gameHours).toBe(12);
    expect(clock.dayProgress).toBeCloseTo(0.5, 10);
  });

  it('scales game time with gameSecondsPerTick', () => {
    const clock = new SimulationClock({ ...config, gameSecondsPerTick: 0.05 });
    clock.advance(20);
    expect(clock.currentTick).toBe(20);
    expect(clock.totalGameSeconds).toBeCloseTo(1, 10);
  });

  it('exposes pause without altering time', () => {
    const clock = new SimulationClock(config);
    clock.advance(10);
    clock.pause();

    expect(clock.paused).toBe(true);
    expect(clock.currentTick).toBe(10);

    clock.resume();
    expect(clock.paused).toBe(false);
  });

  it('validates timeScale', () => {
    const clock = new SimulationClock(config);
    clock.setTimeScale(8);
    expect(clock.timeScale).toBe(8);

    expect(() => clock.setTimeScale(0)).toThrow(/positive/);
    expect(() => clock.setTimeScale(-1)).toThrow(/positive/);
    expect(() => clock.setTimeScale(Number.NaN)).toThrow(/positive/);
  });

  it('rejects invalid advances', () => {
    const clock = new SimulationClock(config);
    expect(() => clock.advance(-1)).toThrow(/non-negative integer/);
    expect(() => clock.advance(1.5)).toThrow(/non-negative integer/);
  });

  it('round-trips its state', () => {
    const clock = new SimulationClock(config);
    clock.advance(12345);
    clock.setTimeScale(4);
    clock.pause();

    const restored = new SimulationClock(config);
    restored.setState(clock.getState());

    expect(restored.getState()).toEqual(clock.getState());
    expect(restored.format()).toBe(clock.format());
  });

  it("date précisément un ancien tick sans dépendre de l'heure actuelle", () => {
    const clock = new SimulationClock({ ...config, startHourOfDay: 8 });
    clock.advance(3600 * 30);

    expect(clock.dateAtTick(0)).toEqual({ year: 1, day: 1, hour: 8, minute: 0 });
    expect(clock.dateAtTick(3600 * 18 + 90)).toEqual({
      year: 1,
      day: 2,
      hour: 2,
      minute: 1,
    });
  });
});
