import { describe, expect, it } from 'vitest';
import { ProceduralGenerator } from '../core/proceduralGenerator.js';
import type { WorldGenerationConfig } from '../config/worldGenerationConfig.js';
import { CoarseGrid } from './coarseGrid.js';
import { computeDistanceTransform } from './distanceTransform.js';
import { computeFlowField } from './flowField.js';
import { growRivers } from './hydrologyGenerator.js';
import { fillDepressions } from './priorityFlood.js';
import { smoothChain, type RiverPoint } from './riverNetwork.js';

function grid(size: number): CoarseGrid {
  return new CoarseGrid(0, 0, size, 1);
}

describe('fillDepressions', () => {
  it('comble une cuvette jusqu’à son exutoire', () => {
    const g = grid(5);
    const elevation = new Float64Array(25).fill(1);
    elevation[g.index(2, 2)] = 0.2; // creux central

    const { filled, flooded } = fillDepressions(g, elevation);

    expect(filled[g.index(2, 2)]).toBeGreaterThan(0.99);
    expect(flooded[g.index(2, 2)]).toBe(1);
    expect(flooded[g.index(0, 0)]).toBe(0);
  });

  it('ne touche pas un versant régulier', () => {
    const g = grid(6);
    const elevation = new Float64Array(36);
    for (let row = 0; row < 6; row++) {
      for (let column = 0; column < 6; column++) elevation[g.index(column, row)] = row * 0.1;
    }

    const { filled, flooded } = fillDepressions(g, elevation);
    for (let i = 0; i < elevation.length; i++) {
      expect(filled[i]).toBeCloseTo(elevation[i] as number, 6);
    }
    // Un versant strictement descendant ne comporte aucune cuvette.
    expect([...flooded].every((value) => value === 0)).toBe(true);
  });

  it('ne fait jamais descendre le terrain', () => {
    const g = grid(12);
    const elevation = new Float64Array(144);
    for (let i = 0; i < elevation.length; i++) elevation[i] = Math.sin(i * 0.7) * 0.5 + 0.5;

    const { filled } = fillDepressions(g, elevation);
    for (let i = 0; i < elevation.length; i++) {
      expect(filled[i]).toBeGreaterThanOrEqual((elevation[i] as number) - 1e-9);
    }
  });
});

describe('computeFlowField', () => {
  it('fait descendre l’écoulement', () => {
    const g = grid(8);
    const elevation = new Float64Array(64);
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 8; column++) elevation[g.index(column, row)] = 1 - row * 0.1;
    }

    const { filled } = fillDepressions(g, elevation);
    const flow = computeFlowField(g, filled);

    for (let i = 0; i < g.cellCount; i++) {
      const target = flow.downstream[i] as number;
      if (target < 0) continue;
      expect(filled[target] as number).toBeLessThan(filled[i] as number);
    }
  });

  it('accumule vers l’aval', () => {
    const g = grid(10);
    const elevation = new Float64Array(100);
    for (let row = 0; row < 10; row++) {
      for (let column = 0; column < 10; column++) {
        elevation[g.index(column, row)] = 1 - row * 0.1 + Math.abs(column - 5) * 0.01;
      }
    }

    const { filled } = fillDepressions(g, elevation);
    const flow = computeFlowField(g, filled);

    // Chaque cellule draine au moins elle-même, et l'aval en draine toujours davantage.
    for (let i = 0; i < g.cellCount; i++) {
      expect(flow.accumulation[i] as number).toBeGreaterThanOrEqual(1);
      const target = flow.downstream[i] as number;
      if (target >= 0) {
        expect(flow.accumulation[target] as number).toBeGreaterThan(flow.accumulation[i] as number);
      }
    }
  });
});

describe('computeDistanceTransform', () => {
  it('mesure la distance à la cellule marquée la plus proche', () => {
    const g = grid(9);
    const mask = new Uint8Array(81);
    mask[g.index(4, 4)] = 1;

    const distance = computeDistanceTransform(g, mask, 2);

    expect(distance[g.index(4, 4)]).toBe(0);
    expect(distance[g.index(5, 4)]).toBeCloseTo(2, 5);
    expect(distance[g.index(4, 0)]).toBeCloseTo(8, 5);
    // Diagonale : ~sqrt(2) fois le pas, à la tolérance du chanfrein près.
    expect(distance[g.index(6, 6)]).toBeGreaterThan(5);
    expect(distance[g.index(6, 6)]).toBeLessThan(6);
  });
});

describe('growRivers', () => {
  const hydrology: Pick<
    WorldGenerationConfig['hydrology'],
    'riverAccumulationThreshold' | 'riverContinuationRatio'
  > = {
    riverAccumulationThreshold: 420,
    riverContinuationRatio: 0.55,
  };

  /** Écoulement nord→sud : l'aval est la cellule du dessous. */
  function southFlow(g: CoarseGrid): { downstream: Int32Array; accumulation: Float64Array } {
    const downstream = new Int32Array(g.cellCount).fill(-1);
    for (let row = 0; row < g.height - 1; row++) {
      for (let column = 0; column < g.width; column++) {
        downstream[g.index(column, row)] = g.index(column, row + 1);
      }
    }
    return { downstream, accumulation: new Float64Array(g.cellCount).fill(1) };
  }

  it('absorbe l’amont d’une rivière établie dès qu’il s’écoule vers elle', () => {
    const g = grid(6);
    const flow = southFlow(g);

    const riverCell = g.index(3, 3);
    const upstream = g.index(3, 2);
    // L'amont reste sous le seuil principal (420) mais draine dans la rivière.
    flow.accumulation[riverCell] = 800;
    flow.accumulation[upstream] = 300;

    const grown = growRivers(g, flow, [riverCell], hydrology);

    expect(grown).toContain(upstream);
    expect(grown).toContain(riverCell);
  });

  it('n’absorbe jamais une cellule qui ne s’écoule pas vers une rivière', () => {
    const g = grid(6);
    const flow = southFlow(g);

    const riverCell = g.index(3, 3);
    const bystander = g.index(0, 2); // même accumulation, mais coule vers la colonne 0.
    flow.accumulation[riverCell] = 800;
    flow.accumulation[bystander] = 300;

    const grown = growRivers(g, flow, [riverCell], hydrology);

    expect(grown).not.toContain(bystander);
  });

  it('n’absorbe pas une accumulation trop faible, même en amont d’une rivière', () => {
    const g = grid(6);
    const flow = southFlow(g);

    const riverCell = g.index(3, 3);
    const weakUpstream = g.index(3, 2);
    flow.accumulation[riverCell] = 800;
    flow.accumulation[weakUpstream] = 100; // sous le seuil de continuation (231).

    const grown = growRivers(g, flow, [riverCell], hydrology);

    expect(grown).not.toContain(weakUpstream);
  });
});

describe('hydrologie d’un monde réel', () => {
  const generator = new ProceduralGenerator({
    seed: 'hydro',
    overrides: { layout: { sizeChunks: 8 } },
  });

  it('crée des étendues d’eau', () => {
    expect(generator.hydrology.bodies.length).toBeGreaterThan(0);
  });

  it('ne garde aucun cours d’eau minuscule (rivière de deux cellules, source isolée)', () => {
    const hydrology = generator.config.hydrology;
    const cellAreaM2 = hydrology.coarseCellMeters * hydrology.coarseCellMeters;
    for (const body of generator.hydrology.bodies) {
      if (body.type === 'river') {
        expect(body.areaM2, body.id).toBeGreaterThanOrEqual(hydrology.minRiverCells * cellAreaM2);
      }
      if (body.type === 'spring') {
        expect(body.areaM2, body.id).toBeGreaterThanOrEqual(hydrology.minSpringCells * cellAreaM2);
      }
    }
  });

  it('donne à chaque étendue des propriétés physiques valides', () => {
    for (const body of generator.hydrology.bodies) {
      expect(body.volume).toBeGreaterThanOrEqual(0);
      expect(body.areaM2).toBeGreaterThan(0);
      expect(body.meanDepthM).toBeGreaterThanOrEqual(0);
      expect(body.maxDepthM).toBeGreaterThanOrEqual(body.meanDepthM);
      for (const value of [
        body.contamination,
        body.pathogenLoad,
        body.turbidity,
        body.flowRenewal,
      ]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(Number.isFinite(body.temperatureC)).toBe(true);
    }
  });

  it('distingue les eaux courantes des eaux stagnantes', () => {
    const rivers = generator.hydrology.bodies.filter((body) => body.type === 'river');
    const ponds = generator.hydrology.bodies.filter((body) => body.type === 'pond');
    if (rivers.length === 0 || ponds.length === 0) return;

    const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
    // La propriété qui comptera pour la survie : une mare est plus risquée qu'une rivière.
    expect(mean(ponds.map((body) => body.pathogenLoad))).toBeGreaterThan(
      mean(rivers.map((body) => body.pathogenLoad)),
    );
    expect(mean(rivers.map((body) => body.flowRenewal))).toBeGreaterThan(
      mean(ponds.map((body) => body.flowRenewal)),
    );
  });

  it('place la surface de l’eau au-dessus du fond', () => {
    const bounds = generator.bounds;
    let found = 0;
    for (let x = -bounds.halfSizeMeters + 4; x < bounds.halfSizeMeters; x += 11) {
      for (let z = -bounds.halfSizeMeters + 4; z < bounds.halfSizeMeters; z += 11) {
        const height = generator.sampler.sampleHeight(x, z);
        const water = generator.hydrology.sampleWater(x, z, height);
        if (!water) continue;
        found++;
        expect(water.surfaceHeightM).toBeGreaterThan(height);
        expect(water.depthM).toBeGreaterThan(0);
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('rend l’eau profonde impraticable et le sol sec praticable', () => {
    const bounds = generator.bounds;
    let deepWaterChecked = 0;
    for (let x = -bounds.halfSizeMeters + 4; x < bounds.halfSizeMeters; x += 7) {
      for (let z = -bounds.halfSizeMeters + 4; z < bounds.halfSizeMeters; z += 7) {
        const height = generator.sampler.sampleHeight(x, z);
        const water = generator.hydrology.sampleWater(x, z, height);
        if (water && water.depthM > 1.5) {
          expect(generator.sampler.isTerrainWalkable(x, z)).toBe(false);
          deepWaterChecked++;
        }
      }
    }
    expect(deepWaterChecked).toBeGreaterThan(0);
  });

  it('garantit une marge de creusement sous la surface des plans d’eau stagnants', () => {
    // Bug corrigé : rien ne creusait le terrain fin sous un lac/étang — sa présence
    // dépendait entièrement de la cuvette que le bruit formait par hasard à la
    // résolution grossière de la grille hydrologique, si bien que le sol pouvait
    // localement remonter au-dessus de la surface calculée (une eau qui semblait posée
    // sur le terrain plutôt que nichée dedans). Vérifié au CENTRE de chaque plan d'eau
    // stagnant (le point le moins sujet aux effets de bord du raccord de berge).
    const hydrology = generator.config.hydrology;
    const standingBodies = generator.hydrology.bodies.filter(
      (body) => body.type === 'lake' || body.type === 'pond',
    );
    expect(standingBodies.length).toBeGreaterThan(0);

    for (const body of standingBodies) {
      const height = generator.sampler.sampleHeight(body.centerX, body.centerZ);
      const water = generator.hydrology.sampleWater(body.centerX, body.centerZ, height);
      expect(water, `${body.id} sans eau à son propre centre`).not.toBeNull();
      // Tolérance : le raccord de berge (`smoothCarve`) et l'interpolation bilinéaire de
      // la grille grossière peuvent légèrement entamer la marge nominale au centre d'un
      // petit étang proche du bord de sa composante — on vérifie donc une fraction
      // généreuse plutôt que la marge exacte, ce qui reste largement suffisant pour
      // exclure le bug (marge nulle ou négative) que ce test verrouille.
      expect(water?.depthM).toBeGreaterThan(hydrology.standingWaterCarveMarginMeters * 0.5);
    }
  });

  it('respecte l’invariante de creusement des berges (riverBankFalloff < 1 - riverFillRatio)', () => {
    // Bug corrigé : `riverBankFalloff` (0.5) dépassait `1 - riverFillRatio` (0.38), ce qui
    // creusait les berges plus profond que la surface de l'eau voisine — le maillage
    // d'eau inondait alors la berge trop creusée et semblait flotter au-dessus du sol
    // (voir la doc de `riverBankFalloff`). Verrou de non-régression : une valeur future
    // qui violerait de nouveau cette invariante doit échouer ici, pas seulement se voir
    // à l'écran.
    const hydrology = generator.config.hydrology;
    expect(hydrology.riverBankFalloff).toBeLessThan(1 - hydrology.riverFillRatio);
  });

  it('produit une carte de distance à l’eau cohérente', () => {
    const grid = generator.hydrology.grid;
    // Le centre de gravité d'un cours d'eau sinueux peut être loin de toute eau : on ne
    // vérifie donc pas les corps mais chaque cellule effectivement en eau, qui doit se
    // trouver à moins d'un pas de grille de l'eau.
    let waterCellsChecked = 0;
    for (let row = 0; row < grid.height; row++) {
      for (let column = 0; column < grid.width; column++) {
        const x = grid.centerX(column);
        const z = grid.centerZ(row);
        const height = generator.sampler.sampleHeight(x, z);
        if (!generator.hydrology.sampleWater(x, z, height)) continue;
        waterCellsChecked++;
        expect(generator.hydrology.distanceToWaterMeters(x, z)).toBeLessThan(grid.cellMeters);
      }
    }
    expect(waterCellsChecked).toBeGreaterThan(0);
  });
});

describe('ligne centrale vectorielle', () => {
  it('lisse les angles sans faire remonter la surface vers l’aval', () => {
    const point = (x: number, z: number, surface01: number): RiverPoint => ({
      x,
      z,
      surface01,
      widthMeters: 3,
      carveDepth01: 0.01,
      bodyIndex: 0,
    });
    const raw = [point(0, 0, 0.5), point(6, 0, 0.4), point(6, 6, 0.3)];
    const smoothed = smoothChain(smoothChain(raw));

    expect(smoothed.some((sample) => sample.x > 0 && sample.x < 6 && sample.z > 0)).toBe(true);
    for (let index = 1; index < smoothed.length; index++) {
      expect((smoothed[index] as RiverPoint).surface01).toBeLessThanOrEqual(
        (smoothed[index - 1] as RiverPoint).surface01,
      );
    }
  });

  it('garde chaque rivière continue au pas fin du maillage de terrain', () => {
    const generator = new ProceduralGenerator({
      seed: 'hydro',
      overrides: { layout: { sizeChunks: 8 } },
    });
    const step = generator.config.layout.sampleLatticeMeters;
    const halfSize = generator.bounds.halfSizeMeters;
    const side = Math.floor((halfSize * 2) / step) + 1;
    const samplesByBody = new Map<string, number[]>();

    for (let row = 0; row < side; row++) {
      for (let column = 0; column < side; column++) {
        const x = -halfSize + column * step;
        const z = -halfSize + row * step;
        const height = generator.sampler.sampleHeight(x, z);
        const water = generator.hydrology.sampleWater(x, z, height);
        if (water?.body.type !== 'river') continue;
        const samples = samplesByBody.get(water.body.id);
        const index = row * side + column;
        if (samples) samples.push(index);
        else samplesByBody.set(water.body.id, [index]);
      }
    }

    expect(samplesByBody.size).toBeGreaterThan(0);
    const offsets = [-side - 1, -side, -side + 1, -1, 1, side - 1, side, side + 1];
    for (const [bodyId, samples] of samplesByBody) {
      const remaining = new Set(samples);
      const first = samples[0];
      expect(first).toBeDefined();
      const stack = [first as number];
      remaining.delete(first as number);
      while (stack.length > 0) {
        const current = stack.pop() as number;
        for (const offset of offsets) {
          const neighbor = current + offset;
          if (!remaining.delete(neighbor)) continue;
          stack.push(neighbor);
        }
      }
      expect(remaining.size, `${bodyId} est fragmentée sur le maillage fin`).toBe(0);
    }
  });
});
