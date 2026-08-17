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
    expect(controlCode('backward')).toBe('KeyW');
  });

  it('affiche des libellés lisibles', () => {
    expect(keyLabel('KeyE')).toBe('E');
    expect(keyLabel('Space')).toBe('Espace');
  });

  /**
   * `KeyboardEvent.code` nomme la position physique sur un QWERTY de référence, pas la
   * lettre imprimée. Sur AZERTY, la touche physique portant un Z envoie `KeyW`, celle
   * portant un A envoie `KeyQ`, celle portant un Q envoie `KeyA` — d'où le bug corrigé
   * ici : Z n'avançait pas et la rotation semblait échangée avec le déplacement latéral.
   */
  it('utilise par défaut les positions physiques ZQSD + rotation A/E sur clavier AZERTY', () => {
    expect(controlCode('forward')).toBe('KeyW'); // touche imprimée Z
    expect(controlCode('left')).toBe('KeyA'); // touche imprimée Q
    expect(controlCode('backward')).toBe('KeyS');
    expect(controlCode('right')).toBe('KeyD');
    expect(controlCode('rotateLeft')).toBe('KeyQ'); // touche imprimée A
    expect(controlCode('rotateRight')).toBe('KeyE');
  });

  it('affiche les libellés selon la lettre imprimée sur AZERTY, pas la position QWERTY', () => {
    expect(keyLabel('KeyW')).toBe('Z');
    expect(keyLabel('KeyA')).toBe('Q');
    expect(keyLabel('KeyQ')).toBe('A');
  });
});
