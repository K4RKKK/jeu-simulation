import { describe, expect, it } from 'vitest';
import { createEmptyCognitiveMemory } from '../components/cognitiveMemory.js';
import type { Observation } from './observation.js';
import { decaySpatialMemory, rememberSpatial } from './spatialMemoryModel.js';

const config = {
  freshSpatialConfidence01: 1,
  freshSpatialPrecisionM: 1,
  spatialConfidenceHalfLifeSeconds: 1000,
  spatialPrecisionGrowthPerSecondM: 0.01,
  maxSpatialPrecisionM: 50,
  minSpatialConfidence01: 0.05,
  maxSpatialEntries: 3,
};

function observation(overrides: Partial<Observation> & Pick<Observation, 'kind'>): Observation {
  return { x: 0, z: 0, tick: 1, source: 'directPerception', ...overrides };
}

describe('rememberSpatial', () => {
  it('ajoute un nouveau souvenir avec la confiance/précision fraîches', () => {
    const memory = createEmptyCognitiveMemory();
    rememberSpatial(memory, observation({ kind: 'water', x: 10, z: 20, tick: 100 }), config);

    expect(memory.spatial).toHaveLength(1);
    expect(memory.spatial[0]).toMatchObject({
      id: 0,
      kind: 'water',
      x: 10,
      z: 20,
      lastSeenTick: 100,
      confidence01: 1,
      precisionM: 1,
      encodedConfidence01: 1,
      encodedPrecisionM: 1,
      source: 'directPerception',
    });
  });

  it('rafraîchit un souvenir revu au même endroit plutôt que de le dupliquer', () => {
    const memory = createEmptyCognitiveMemory();
    rememberSpatial(memory, observation({ kind: 'water', x: 10, z: 20, tick: 100 }), config);
    rememberSpatial(memory, observation({ kind: 'water', x: 10.1, z: 20.1, tick: 500 }), config);

    expect(memory.spatial).toHaveLength(1);
    expect(memory.spatial[0]).toMatchObject({ x: 10.1, z: 20.1, lastSeenTick: 500 });
  });

  it('une observation de confiance/précision explicites prime sur les valeurs fraîches par défaut', () => {
    const memory = createEmptyCognitiveMemory();
    rememberSpatial(
      memory,
      observation({ kind: 'water', confidence01: 0.4, precisionM: 8 }),
      config,
    );

    expect(memory.spatial[0]).toMatchObject({
      confidence01: 0.4,
      precisionM: 8,
      encodedConfidence01: 0.4,
      encodedPrecisionM: 8,
    });
  });

  it('identifie deux souvenirs distincts par worldRef, même à la même position', () => {
    const memory = createEmptyCognitiveMemory();
    const worldRefA = {
      type: 'resource' as const,
      resourceId: 'a',
      ownerChunkKey: '0:0',
      localId: 0,
    };
    const worldRefB = {
      type: 'resource' as const,
      resourceId: 'b',
      ownerChunkKey: '0:0',
      localId: 1,
    };
    rememberSpatial(
      memory,
      observation({ kind: 'resource', x: 5, z: 5, worldRef: worldRefA }),
      config,
    );
    rememberSpatial(
      memory,
      observation({ kind: 'resource', x: 5, z: 5, worldRef: worldRefB }),
      config,
    );

    expect(memory.spatial).toHaveLength(2);
  });

  it('ne fusionne jamais deux concepts différents même dans la même cellule', () => {
    const memory = createEmptyCognitiveMemory();
    rememberSpatial(
      memory,
      observation({ kind: 'resource', x: 1, z: 1, subjectConceptId: 'danger:predator' }),
      config,
    );
    rememberSpatial(
      memory,
      observation({ kind: 'resource', x: 1.2, z: 1.2, subjectConceptId: 'shelter:cave' }),
      config,
    );

    expect(memory.spatial).toHaveLength(2);
  });

  it('fusionne deux observations du même concept dans la même cellule', () => {
    const memory = createEmptyCognitiveMemory();
    rememberSpatial(
      memory,
      observation({ kind: 'resource', x: 1, z: 1, subjectConceptId: 'berry_bush' }),
      config,
    );
    rememberSpatial(
      memory,
      observation({ kind: 'resource', x: 1.2, z: 1.2, subjectConceptId: 'berry_bush' }),
      config,
    );

    expect(memory.spatial).toHaveLength(1);
  });

  it('évince le souvenir le moins confiant quand la capacité est dépassée', () => {
    const memory = createEmptyCognitiveMemory();
    // Trois souvenirs distincts (positions éloignées, pas de dédoublonnage).
    for (let i = 0; i < config.maxSpatialEntries; i++) {
      rememberSpatial(memory, observation({ kind: 'place', x: i * 100, z: 0 }), config);
    }
    expect(memory.spatial).toHaveLength(3);
    // Affaiblit le premier souvenir avant d'en ajouter un quatrième.
    memory.spatial[0]!.confidence01 = 0.01;

    rememberSpatial(memory, observation({ kind: 'place', x: 999, z: 0 }), config);

    expect(memory.spatial).toHaveLength(3);
    expect(memory.spatial.some((entry) => entry.x === 0)).toBe(false); // évincé
    expect(memory.spatial.some((entry) => entry.x === 999)).toBe(true); // ajouté
  });

  it('alloue des MemoryId séquentiels via le compteur du composant', () => {
    const memory = createEmptyCognitiveMemory();
    rememberSpatial(memory, observation({ kind: 'water', x: 0, z: 0 }), config);
    rememberSpatial(memory, observation({ kind: 'water', x: 1000, z: 0 }), config);
    expect(memory.spatial.map((entry) => entry.id)).toEqual([0, 1]);
    expect(memory.nextMemoryId).toBe(2);
  });
});

describe('decaySpatialMemory', () => {
  it("ne fait rien tant qu'aucun temps ne s'est écoulé", () => {
    const memory = createEmptyCognitiveMemory();
    rememberSpatial(memory, observation({ kind: 'water', tick: 100 }), config);

    decaySpatialMemory(memory, 100, 0.05, config);

    expect(memory.spatial[0]!.confidence01).toBe(1);
    expect(memory.spatial[0]!.precisionM).toBe(1);
  });

  it('divise la confiance par deux après exactement une demi-vie', () => {
    const memory = createEmptyCognitiveMemory();
    rememberSpatial(memory, observation({ kind: 'water', tick: 0 }), config);

    const ticksPerHalfLife = config.spatialConfidenceHalfLifeSeconds / 0.05;
    decaySpatialMemory(memory, ticksPerHalfLife, 0.05, config);

    expect(memory.spatial[0]!.confidence01).toBeCloseTo(0.5, 6);
  });

  it('décroît depuis la confiance ENCODÉE du souvenir, pas depuis la confiance fraîche par défaut', () => {
    const memory = createEmptyCognitiveMemory();
    // Encodé à 0.4 (ex. une observation sociale future), pas 1.0.
    rememberSpatial(memory, observation({ kind: 'water', tick: 0, confidence01: 0.4 }), config);

    const ticksPerHalfLife = config.spatialConfidenceHalfLifeSeconds / 0.05;
    decaySpatialMemory(memory, ticksPerHalfLife, 0.05, config);

    // La moitié de 0.4, jamais la moitié de 1.0 (0.5).
    expect(memory.spatial[0]!.confidence01).toBeCloseTo(0.2, 6);
  });

  it('ne réhausse jamais un souvenir de confiance basse au-dessus de sa valeur encodée', () => {
    const memory = createEmptyCognitiveMemory();
    rememberSpatial(memory, observation({ kind: 'water', tick: 0, confidence01: 0.3 }), config);

    decaySpatialMemory(memory, 1, 0.05, config); // temps quasi nul écoulé

    expect(memory.spatial[0]!.confidence01).toBeLessThanOrEqual(0.3);
  });

  it('est idempotente : appeler deux fois de suite au même tick ne change rien de plus', () => {
    const memory = createEmptyCognitiveMemory();
    rememberSpatial(memory, observation({ kind: 'water', tick: 0 }), config);

    decaySpatialMemory(memory, 5000, 0.05, config);
    const afterFirst = { ...memory.spatial[0]! };
    decaySpatialMemory(memory, 5000, 0.05, config);

    expect(memory.spatial[0]).toEqual(afterFirst);
  });

  it('donne le même résultat qu’on décroisse en une fois ou en plusieurs passes intermédiaires', () => {
    const a = createEmptyCognitiveMemory();
    rememberSpatial(a, observation({ kind: 'water', tick: 0 }), config);
    decaySpatialMemory(a, 20000, 0.05, config);

    const b = createEmptyCognitiveMemory();
    rememberSpatial(b, observation({ kind: 'water', tick: 0 }), config);
    decaySpatialMemory(b, 5000, 0.05, config);
    decaySpatialMemory(b, 12000, 0.05, config);
    decaySpatialMemory(b, 20000, 0.05, config);

    expect(b.spatial[0]!.confidence01).toBeCloseTo(a.spatial[0]!.confidence01, 9);
    expect(b.spatial[0]!.precisionM).toBeCloseTo(a.spatial[0]!.precisionM, 9);
  });

  it('purge un souvenir dont la confiance tombe sous le seuil minimal', () => {
    const memory = createEmptyCognitiveMemory();
    rememberSpatial(memory, observation({ kind: 'water', tick: 0 }), config);

    // Largement au-delà du seuil de purge (0.5^(N) < 0.05 pour N > ~4.3 demi-vies).
    const farFutureTicks = (config.spatialConfidenceHalfLifeSeconds * 10) / 0.05;
    decaySpatialMemory(memory, farFutureTicks, 0.05, config);

    expect(memory.spatial).toHaveLength(0);
  });

  it('plafonne precisionM à maxSpatialPrecisionM', () => {
    const memory = createEmptyCognitiveMemory();
    rememberSpatial(memory, observation({ kind: 'water', tick: 0 }), config);

    // Peu de temps (confiance reste au-dessus du seuil), mais suffisamment pour dépasser
    // le plafond de précision au rythme de croissance configuré.
    const ticks = 200000 / 0.05;
    decaySpatialMemory(memory, ticks, 0.05, {
      ...config,
      spatialConfidenceHalfLifeSeconds: 1e9, // confiance quasi figée pour isoler precisionM
    });

    expect(memory.spatial[0]!.precisionM).toBe(config.maxSpatialPrecisionM);
  });
});
