// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  controlCode,
  keyLabel,
  resetControlSettings,
  setControlBinding,
} from './controlSettings.js';

describe('réglages des commandes', () => {
  beforeEach(() => resetControlSettings());

  it('remappe réellement une action', () => {
    setControlBinding('forward', 'ArrowUp');
    expect(controlCode('forward')).toBe('ArrowUp');
  });

  it('échange les touches en cas de conflit au lieu de créer un doublon', () => {
    setControlBinding('forward', 'KeyS');
    expect(controlCode('forward')).toBe('KeyS');
    expect(controlCode('backward')).toBe('KeyZ');
  });

  it('affiche des libellés lisibles', () => {
    expect(keyLabel('KeyE')).toBe('E');
    expect(keyLabel('Space')).toBe('Espace');
  });
});
