import { describe, expect, it } from 'vitest';
import { Noise2D, NoiseProvider } from './noiseProvider.js';

describe('Noise2D', () => {
  const noise = new Noise2D('seed', 'test');

  it('reste dans [-1, 1]', () => {
    for (let i = 0; i < 4000; i++) {
      const value = noise.sample(i * 0.37, i * -0.21);
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('est reproductible pour la même seed', () => {
    const other = new Noise2D('seed', 'test');
    for (let i = 0; i < 200; i++) {
      expect(noise.sample(i * 1.7, i * 0.3)).toBe(other.sample(i * 1.7, i * 0.3));
    }
  });

  it('diffère pour un autre domaine', () => {
    const other = new Noise2D('seed', 'autre');
    let difference = 0;
    const samples = 400;

    for (let i = 0; i < samples; i++) {
      const x = i * 0.73 + 0.31;
      const z = i * -0.41 + 0.17;
      difference += Math.abs(noise.sample(x, z) - other.sample(x, z));
    }

    // Deux domaines tirent dans des permutations distinctes : les champs doivent être
    // franchement décorrélés. On mesure l'écart moyen plutôt que des égalités exactes —
    // deux bruits indépendants coïncident forcément de temps en temps, notamment près des
    // nœuds de la grille simplex où les deux valent zéro.
    expect(difference / samples).toBeGreaterThan(0.15);
  });

  it('est continu : deux points proches donnent des valeurs proches', () => {
    // C'est cette propriété qui garantit l'absence de fissure entre chunks.
    for (let i = 0; i < 500; i++) {
      const x = i * 0.9;
      const a = noise.sample(x, 3.3);
      const b = noise.sample(x + 0.001, 3.3);
      expect(Math.abs(a - b)).toBeLessThan(0.02);
    }
  });

  it('ne renvoie pas une constante', () => {
    const values = new Set<number>();
    for (let i = 0; i < 200; i++) values.add(Math.round(noise.sample(i * 3.1, i * 1.9) * 1000));
    expect(values.size).toBeGreaterThan(50);
  });

  it('fbm01 reste dans [0, 1]', () => {
    for (let i = 0; i < 2000; i++) {
      const value = noise.fbm01(i * 2.3, i * -1.1, { scaleMeters: 60, octaves: 4 });
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('fbm ajoute du détail sans changer la structure d’ensemble', () => {
    const options = { scaleMeters: 200, octaves: 1 };
    const detailed = { scaleMeters: 200, octaves: 4 };
    let closeEnough = 0;
    for (let i = 0; i < 200; i++) {
      const base = noise.fbm(i * 7, 0, options);
      const rich = noise.fbm(i * 7, 0, detailed);
      if (Math.abs(base - rich) < 0.45) closeEnough++;
    }
    expect(closeEnough).toBeGreaterThan(150);
  });
});

describe('NoiseProvider', () => {
  it('réutilise la même instance par domaine', () => {
    const provider = new NoiseProvider('seed');
    expect(provider.get('elevation')).toBe(provider.get('elevation'));
    expect(provider.get('elevation')).not.toBe(provider.get('moisture'));
  });
});
