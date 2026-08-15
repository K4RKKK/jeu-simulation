import { describe, expect, it } from 'vitest';
import { ProceduralGenerator } from './core/proceduralGenerator.js';
import { analyzeWorld } from './debug/proceduralDebugData.js';

/**
 * Validation statistique multi-seeds.
 *
 * Un monde procédural ne se juge pas sur une seed : celle qu'on a sous les yeux pendant le
 * réglage finit toujours par bien se comporter. Ces assertions vérifient que *toutes* les
 * seeds produisent un monde habitable — pas de désert monobiome, pas de monde sans eau, pas
 * de valeur aberrante.
 */
const SEEDS = [
  'DEBUG_WORLD_001',
  'DEBUG_WORLD_002',
  'ALPHA',
  'STONE',
  '123456',
  'prehistory-01',
  'test',
  'rivière',
  'aa',
  'zzzzzzzzzzzz',
  '0',
  'seed-with-a-very-long-name-that-nobody-would-type',
  'x1',
  'x2',
  'x3',
  'x4',
  'x5',
  'x6',
  'x7',
  'x8',
];

const reports = SEEDS.map((seed) =>
  analyzeWorld(new ProceduralGenerator({ seed, overrides: { layout: { sizeChunks: 8 } } }), {
    maxChunks: 16,
  }),
);

describe(`génération du monde sur ${SEEDS.length} seeds`, () => {
  it('produit toujours un relief varié et fini', () => {
    for (const report of reports) {
      expect(Number.isFinite(report.minHeightM), report.seed).toBe(true);
      expect(Number.isFinite(report.maxHeightM), report.seed).toBe(true);
      expect(report.maxHeightM - report.minHeightM, report.seed).toBeGreaterThan(10);
    }
  });

  it('ne produit jamais un monde monobiome', () => {
    for (const report of reports) {
      const shares = Object.values(report.biomeShare);
      expect(Math.max(...shares), report.seed).toBeLessThan(0.85);
      const present = shares.filter((share) => share > 0.02).length;
      expect(present, report.seed).toBeGreaterThanOrEqual(3);
    }
  });

  it('ne produit jamais un monde sans eau', () => {
    for (const report of reports) {
      const total =
        report.water.lakes + report.water.ponds + report.water.rivers + report.water.springs;
      expect(total, report.seed).toBeGreaterThan(0);
      expect(report.water.coverage, report.seed).toBeGreaterThan(0.005);
      // Un monde noyé serait tout aussi injouable qu'un monde sec.
      expect(report.water.coverage, report.seed).toBeLessThan(0.45);
    }
  });

  it('laisse toujours assez de terrain praticable', () => {
    for (const report of reports) {
      expect(report.walkableRatio, report.seed).toBeGreaterThan(0.3);
    }
  });

  it('génère toujours des arbres, des pierres et de la nourriture', () => {
    for (const report of reports) {
      const trees =
        (report.resourceCounts.tree_broadleaf ?? 0) + (report.resourceCounts.tree_conifer ?? 0);
      expect(trees, `arbres — ${report.seed}`).toBeGreaterThan(0);
      expect(report.resourceCounts.stone ?? 0, `pierres — ${report.seed}`).toBeGreaterThan(0);
      expect(
        (report.resourceCounts.berry_bush ?? 0) + (report.resourceCounts.mushroom ?? 0),
        `nourriture — ${report.seed}`,
      ).toBeGreaterThan(0);
    }
  });

  it('garde le silex rare mais présent à l’échelle du monde', () => {
    const flintPerChunk = reports.map(
      (report) => (report.resourceCounts.flint ?? 0) / report.chunksAnalyzed,
    );
    const mean = flintPerChunk.reduce((a, b) => a + b, 0) / flintPerChunk.length;
    expect(mean).toBeGreaterThan(0.02);
    expect(mean).toBeLessThan(4);
  });

  it('n’explose jamais en nombre de ressources par chunk', () => {
    for (const report of reports) {
      const total = Object.values(report.resourceCounts).reduce((a, b) => a + b, 0);
      expect(total / report.chunksAnalyzed, report.seed).toBeLessThan(600);
    }
  });

  it('place toujours le campement initial sur un site nommé et proche de l’eau', () => {
    for (const report of reports) {
      expect(report.spawn.biomeId.length, report.seed).toBeGreaterThan(0);
      expect(Number.isFinite(report.spawn.distanceToWaterM), report.seed).toBe(true);
    }
  });

  it('reste dans un budget de temps raisonnable', () => {
    for (const report of reports) {
      expect(report.averageChunkMs, report.seed).toBeLessThan(60);
      expect(report.hydrologyMs, report.seed).toBeLessThan(2000);
    }
  });

  it('produit des mondes statistiquement différents', () => {
    const signature = (index: number): string =>
      Object.entries(reports[index]?.biomeShare ?? {})
        .map(([id, share]) => `${id}:${share.toFixed(2)}`)
        .join('|');
    const signatures = new Set(reports.map((_, index) => signature(index)));
    expect(signatures.size).toBeGreaterThan(SEEDS.length * 0.8);
  });
});
