import { describe, expect, it } from 'vitest';
import {
  detailDistanceChunksFor,
  pixelRatioFor,
  presetFor,
  renderDistanceChunksFor,
  settingsForPreset,
  type GraphicsSettings,
} from './graphicsSettings.js';

describe('presetFor', () => {
  it('détecte les trois niveaux uniformes', () => {
    expect(
      presetFor({ renderDistance: 'low', decorativeDensity: 'low', displayQuality: 'low' }),
    ).toBe('low');
    expect(
      presetFor({
        renderDistance: 'medium',
        decorativeDensity: 'medium',
        displayQuality: 'medium',
      }),
    ).toBe('medium');
    expect(
      presetFor({ renderDistance: 'high', decorativeDensity: 'high', displayQuality: 'high' }),
    ).toBe('high');
  });

  it('renvoie "custom" dès qu’un seul réglage diffère des autres', () => {
    const mixed: GraphicsSettings = {
      renderDistance: 'high',
      decorativeDensity: 'low',
      displayQuality: 'medium',
    };
    expect(presetFor(mixed)).toBe('custom');
  });
});

describe('settingsForPreset', () => {
  it('applique le même niveau aux trois réglages', () => {
    expect(settingsForPreset('high')).toEqual({
      renderDistance: 'high',
      decorativeDensity: 'high',
      displayQuality: 'high',
    });
  });

  it('est l’inverse exact de presetFor pour un niveau uniforme', () => {
    for (const level of ['low', 'medium', 'high'] as const) {
      expect(presetFor(settingsForPreset(level))).toBe(level);
    }
  });
});

describe('renderDistanceChunksFor / detailDistanceChunksFor', () => {
  it('sont strictement croissantes avec le niveau de qualité', () => {
    expect(renderDistanceChunksFor('low')).toBeLessThan(renderDistanceChunksFor('medium'));
    expect(renderDistanceChunksFor('medium')).toBeLessThan(renderDistanceChunksFor('high'));
    expect(detailDistanceChunksFor('low')).toBeLessThan(detailDistanceChunksFor('medium'));
    expect(detailDistanceChunksFor('medium')).toBeLessThan(detailDistanceChunksFor('high'));
  });

  it('"low" masque entièrement les petits éléments (distance 0)', () => {
    expect(detailDistanceChunksFor('low')).toBe(0);
  });
});

describe('pixelRatioFor', () => {
  it('"low" vaut 1 (aucun suréchantillonnage)', () => {
    expect(pixelRatioFor('low')).toBe(1);
  });

  it('"medium" est strictement entre "low" et un plein pixel ratio', () => {
    expect(pixelRatioFor('medium')).toBeGreaterThan(pixelRatioFor('low'));
  });
});
