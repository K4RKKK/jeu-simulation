import type {
  EnvironmentSnapshot,
  HumanProfile,
  HumanState,
  WorldGenerationMetadata,
} from '@civ/shared';
import { describe, expect, it, vi } from 'vitest';
import { WorldStore } from './worldStore.js';

const clock = (tick: number) => ({
  tick,
  year: 1,
  day: 1,
  hour: 8,
  minute: 0,
  dayProgress: 0.33,
  timeScale: 1,
  paused: false,
});

const environment: EnvironmentSnapshot = {
  ambientTemperatureC: 12,
  sunElevation: 0.5,
  isDaytime: true,
  season: 'été',
};

function profile(id: number): HumanProfile {
  return {
    id,
    name: `Human${id}`,
    sex: 'female',
    ageYears: 24,
    heightM: 1.6,
    massKg: 55,
    tint: 0.4,
    walkSpeedMps: 1.2,
    personality: {
      curiosity: 0.5,
      caution: 0.5,
      sociability: 0.5,
      aggression: 0.5,
      patience: 0.5,
      altruism: 0.5,
      courage: 0.5,
      perseverance: 0.5,
    },
    bornAtTick: 0,
  };
}

function generation(): WorldGenerationMetadata {
  return {
    generationVersion: 'test',
    seed: 's',
    sizeChunks: 1,
    chunkSizeMeters: 10,
    terrainResolution: 4,
    minChunk: 0,
    maxChunk: 0,
    waterLevelM: 0,
    regions: { sizeChunks: 1 },
    biomes: [],
    resources: [],
    waterBodies: [],
  };
}

function state(id: number, x: number): HumanState {
  return {
    id,
    x,
    y: 0,
    z: 0,
    yaw: 0,
    speed: 0,
    activity: 'idle',
    reason: 'au repos',
    targetX: null,
    targetZ: null,
    needs: { hydration: 1, hunger: 1, energy: 1 },
  };
}

describe('WorldStore — contrôle des sequence numbers', () => {
  it('ne valide Population qu’au premier snapshot d’intérêt, même vide', () => {
    const onPopulationReady = vi.fn();
    const store = new WorldStore({ onPopulationReady });
    store.apply(
      {
        t: 'init',
        protocolVersion: 1,
        world: { worldId: 'w', seed: 's', sizeMeters: 10, chunkSizeMeters: 10 },
        generation: generation(),
        clock: clock(0),
        environment,
        sequenceNumber: 0,
        history: [],
        profiles: [],
        humans: [],
      },
      0,
    );
    expect(onPopulationReady).not.toHaveBeenCalled();
    store.apply(
      { t: 'snapshot', sequenceNumber: 1, clock: clock(0), environment, profiles: [], humans: [] },
      1,
    );
    expect(onPopulationReady).toHaveBeenCalledOnce();
  });

  it('applique les deltas normalement quand la séquence est continue', () => {
    const store = new WorldStore();
    store.apply(
      { t: 'snapshot', sequenceNumber: 1, clock: clock(0), environment, profiles: [], humans: [] },
      0,
    );
    store.apply(
      {
        t: 'delta',
        sequenceNumber: 2,
        clock: clock(1),
        environment,
        profiles: [profile(1)],
        humans: [state(1, 10)],
        removed: [],
      },
      1,
    );

    expect(store.get(1)?.current.x).toBe(10);
  });

  /**
   * Contrôle réel de la continuité : un saut de séquence signale un message perdu en
   * route. Appliquer quand même le delta laisserait l'état local périmé pour de bon
   * (un retrait manqué ne serait plus jamais renvoyé) — le delta fautif est donc rejeté,
   * et une resynchronisation est demandée à l'appelant plutôt que de deviner.
   */
  it('détecte un saut de séquence, rejette le delta fautif et demande un resync', () => {
    const onDesyncDetected = vi.fn();
    const store = new WorldStore({ onDesyncDetected });

    store.apply(
      { t: 'snapshot', sequenceNumber: 1, clock: clock(0), environment, profiles: [], humans: [] },
      0,
    );

    // Séquence 3 alors que 2 était attendue : un message a été perdu.
    store.apply(
      {
        t: 'delta',
        sequenceNumber: 3,
        clock: clock(1),
        environment,
        profiles: [profile(1)],
        humans: [state(1, 10)],
        removed: [],
      },
      1,
    );

    expect(onDesyncDetected).toHaveBeenCalledTimes(1);
    // Le delta fautif n'a PAS été appliqué : l'humain qu'il introduisait est absent.
    expect(store.get(1)).toBeUndefined();
  });

  /**
   * Bug corrigé : `expectedSequence` était réavancé même sur un delta fautif, donc un
   * delta ultérieur qui reprenait une séquence continue PAR RAPPORT AU FAUTIF (6 après 5,
   * jamais reçu) était accepté avant même que le snapshot de resynchronisation soit
   * arrivé — le miroir local repartait alors avec un trou permanent (un retrait manqué
   * par exemple). Tant qu'aucun `snapshot` n'a levé la resynchronisation, TOUT delta doit
   * être ignoré, quelle que soit sa propre séquence.
   */
  it('ignore tous les deltas suivants tant que le resync n’est pas arrivé, même à séquence continue', () => {
    const onDesyncDetected = vi.fn();
    const store = new WorldStore({ onDesyncDetected });

    store.apply(
      { t: 'snapshot', sequenceNumber: 1, clock: clock(0), environment, profiles: [], humans: [] },
      0,
    );
    store.apply(
      {
        t: 'delta',
        sequenceNumber: 5, // saut : 2 était attendu
        clock: clock(1),
        environment,
        profiles: [],
        humans: [],
        removed: [],
      },
      1,
    );
    expect(onDesyncDetected).toHaveBeenCalledTimes(1);

    // Séquence continue par rapport au fautif (6 après 5) — mais le resync n'est pas
    // encore arrivé : ce delta doit être ignoré, pas appliqué.
    store.apply(
      {
        t: 'delta',
        sequenceNumber: 6,
        clock: clock(2),
        environment,
        profiles: [profile(2)],
        humans: [state(2, 20)],
        removed: [],
      },
      2,
    );
    expect(onDesyncDetected).toHaveBeenCalledTimes(1); // pas de second appel
    expect(store.get(2)).toBeUndefined(); // le delta 6 n'a PAS été appliqué

    // Le snapshot de resync arrive enfin : il lève l'attente.
    store.apply(
      {
        t: 'snapshot',
        sequenceNumber: 100,
        clock: clock(3),
        environment,
        profiles: [profile(2)],
        humans: [state(2, 20)],
      },
      3,
    );
    expect(store.get(2)?.current.x).toBe(20);

    // Un delta continu APRÈS le snapshot est de nouveau appliqué normalement.
    store.apply(
      {
        t: 'delta',
        sequenceNumber: 101,
        clock: clock(4),
        environment,
        profiles: [],
        humans: [state(2, 30)],
        removed: [],
      },
      4,
    );
    expect(store.get(2)?.current.x).toBe(30);
  });

  it('un `snapshot` complet est toujours accepté et redevient la référence, même après un saut', () => {
    const onDesyncDetected = vi.fn();
    const store = new WorldStore({ onDesyncDetected });
    store.apply(
      { t: 'snapshot', sequenceNumber: 1, clock: clock(0), environment, profiles: [], humans: [] },
      0,
    );
    store.apply(
      {
        t: 'delta',
        sequenceNumber: 99, // saut énorme, resync demandé côté appelant
        clock: clock(1),
        environment,
        profiles: [],
        humans: [],
        removed: [],
      },
      1,
    );
    expect(onDesyncDetected).toHaveBeenCalledTimes(1);

    // Le serveur répond au resync par un snapshot complet : accepté sans condition.
    // Il porte aussi les fiches (`profiles`) : un client en resync n'a par définition
    // aucune fiche fiable — le delta manquant pouvait justement en introduire une.
    store.apply(
      {
        t: 'snapshot',
        sequenceNumber: 100,
        clock: clock(2),
        environment,
        profiles: [profile(4)],
        humans: [state(4, 40)],
      },
      2,
    );
    expect(store.get(4)?.current.x).toBe(40); // introduit PAR le snapshot, pas par un delta

    // Une séquence continue après CE snapshot ne redéclenche pas de désync.
    store.apply(
      {
        t: 'delta',
        sequenceNumber: 101,
        clock: clock(3),
        environment,
        profiles: [],
        humans: [state(4, 41)],
        removed: [],
      },
      3,
    );
    expect(onDesyncDetected).toHaveBeenCalledTimes(1); // pas de second appel
    expect(store.get(4)?.current.x).toBe(41);
  });

  /**
   * `init` porte désormais sa propre séquence de départ (voir `serverInitSchema`) : le
   * tout premier `delta`/`snapshot` qui suit doit reprendre à `sequenceNumber + 1`. Avant
   * ce champ, `expectedSequence` restait `null` jusqu'au premier `snapshot`, donc un
   * premier delta perdu juste après la connexion passait totalement inaperçu.
   */
  it('`init` ancre la séquence attendue : un premier delta déjà en saut est détecté', () => {
    const onDesyncDetected = vi.fn();
    const store = new WorldStore({ onDesyncDetected });

    store.apply(
      {
        t: 'init',
        protocolVersion: 1,
        world: { worldId: 'w', seed: 's', sizeMeters: 100, chunkSizeMeters: 10 },
        generation: generation(),
        clock: clock(0),
        environment,
        sequenceNumber: 0,
        history: [],
        profiles: [],
        humans: [],
      },
      0,
    );

    // Le delta 2 arrive directement (le delta 1 a été perdu juste après l'init).
    store.apply(
      {
        t: 'delta',
        sequenceNumber: 2,
        clock: clock(1),
        environment,
        profiles: [profile(5)],
        humans: [state(5, 50)],
        removed: [],
      },
      1,
    );

    expect(onDesyncDetected).toHaveBeenCalledTimes(1);
    expect(store.get(5)).toBeUndefined();
  });

  it('`init` accepte un delta 1 continu sans faux positif', () => {
    const onDesyncDetected = vi.fn();
    const store = new WorldStore({ onDesyncDetected });

    store.apply(
      {
        t: 'init',
        protocolVersion: 1,
        world: { worldId: 'w', seed: 's', sizeMeters: 100, chunkSizeMeters: 10 },
        generation: generation(),
        clock: clock(0),
        environment,
        sequenceNumber: 0,
        history: [],
        profiles: [],
        humans: [],
      },
      0,
    );

    store.apply(
      {
        t: 'delta',
        sequenceNumber: 1,
        clock: clock(1),
        environment,
        profiles: [profile(6)],
        humans: [state(6, 60)],
        removed: [],
      },
      1,
    );

    expect(onDesyncDetected).not.toHaveBeenCalled();
    expect(store.get(6)?.current.x).toBe(60);
  });
});

describe('WorldStore — délégation `resync` (usage réel)', () => {
  it('un consommateur (ex: main.ts) peut brancher onDesyncDetected pour déclencher une action réseau', () => {
    let resyncRequested = false;
    const store = new WorldStore({
      onDesyncDetected: () => {
        resyncRequested = true; // dans main.ts : connection.send({ t: 'resync' })
      },
    });

    store.apply(
      { t: 'snapshot', sequenceNumber: 1, clock: clock(0), environment, profiles: [], humans: [] },
      0,
    );
    store.apply(
      {
        t: 'delta',
        sequenceNumber: 9,
        clock: clock(1),
        environment,
        profiles: [],
        humans: [],
        removed: [],
      },
      1,
    );

    expect(resyncRequested).toBe(true);
  });
});

describe('WorldStore — resource:updated / resource:added', () => {
  it('resource:updated relaie chunkKey/localId/changedFields à onResourceUpdated', () => {
    const onResourceUpdated = vi.fn();
    const store = new WorldStore({ onResourceUpdated });

    store.apply(
      {
        t: 'resource:updated',
        chunkKey: '2:-1',
        localId: 7,
        sequenceNumber: 1,
        changedFields: { remainingFraction01: 0.5 },
        state: 'modified',
      },
      0,
    );

    expect(onResourceUpdated).toHaveBeenCalledWith('2:-1', 7, { remainingFraction01: 0.5 });
  });

  it('resource:added relaie la réactivation de l’emplacement procédural existant', () => {
    const onResourceAdded = vi.fn();
    const store = new WorldStore({ onResourceAdded });
    store.apply(
      {
        t: 'resource:added',
        chunkKey: '0:0',
        localId: 3,
        sequenceNumber: 1,
        fields: { remainingFraction01: 1 },
      },
      0,
    );
    expect(onResourceAdded).toHaveBeenCalledWith('0:0', 3, { remainingFraction01: 1 });
  });
});
