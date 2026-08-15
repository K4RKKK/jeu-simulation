import { describe, expect, it } from 'vitest';
import { computeAlpha, lerp, lerpAngle } from './interpolation.js';

describe('computeAlpha', () => {
  it('returns the relative position between two samples', () => {
    expect(computeAlpha(1000, 1100, 1050)).toBeCloseTo(0.5, 10);
    expect(computeAlpha(1000, 1100, 1000)).toBe(0);
    expect(computeAlpha(1000, 1100, 1100)).toBe(1);
  });

  it('clamps outside the sample window', () => {
    // Retard réseau : on affiche le dernier état connu plutôt que d'extrapoler.
    expect(computeAlpha(1000, 1100, 5000)).toBe(1);
    expect(computeAlpha(1000, 1100, 0)).toBe(0);
  });

  it('handles identical timestamps without dividing by zero', () => {
    expect(computeAlpha(1000, 1000, 1000)).toBe(1);
    expect(computeAlpha(1100, 1000, 1050)).toBe(1);
  });
});

describe('lerpAngle', () => {
  it('interpolates within a simple range', () => {
    expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5, 10);
  });

  it('takes the short way around the circle', () => {
    // De 170° à -170° : 20° par le plus court chemin, pas 340° dans l'autre sens.
    const from = (170 * Math.PI) / 180;
    const to = (-170 * Math.PI) / 180;
    const middle = lerpAngle(from, to, 0.5);

    expect(Math.abs(middle)).toBeGreaterThan(Math.PI * 0.97);
  });

  it('returns the endpoints exactly', () => {
    expect(lerpAngle(0.3, 1.2, 0)).toBeCloseTo(0.3, 10);
    expect(lerpAngle(0.3, 1.2, 1)).toBeCloseTo(1.2, 10);
  });
});

describe('lerp', () => {
  it('interpolates linearly', () => {
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });
});
