import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../constants.js';
import type { ServerMessage } from './messages.js';
import { encodeMessage, parseClientMessage, parseServerMessage } from './messages.js';

const worldDescriptor = {
  worldId: 'world-test',
  seed: 'test',
  sizeMeters: 512,
  chunkSizeMeters: 64,
};

const clock = {
  tick: 12,
  year: 1,
  day: 1,
  hour: 8,
  minute: 30,
  dayProgress: 0.354,
  timeScale: 1,
  paused: false,
};

const environment = {
  ambientTemperatureC: 12.5,
  sunElevation: 0.4,
  isDaytime: true,
  season: 'hiver' as const,
};

const generation = {
  generationVersion: 'worldgen-v1',
  seed: 'test',
  sizeChunks: 8,
  chunkSizeMeters: 64,
  terrainResolution: 16,
  minChunk: -4,
  maxChunk: 3,
  waterLevelM: 0.5,
  regions: { sizeChunks: 6 },
  biomes: [{ index: 0, id: 'grassland', displayName: 'Prairie', color: '#7fa04f' }],
  resources: [
    {
      index: 0,
      id: 'stone',
      displayName: 'Pierre',
      category: 'stone',
      interactive: true,
      visual: {
        shape: 'boulder',
        primaryColor: '#8d8a84',
        heightM: 0.6,
        radiusM: 0.5,
        detailOnly: false,
      },
    },
  ],
  waterBodies: [],
};

const humanState = {
  id: 1,
  x: 1.25,
  y: 12.5,
  z: -3.5,
  yaw: 0.75,
  speed: 1.1,
  activity: 'walking' as const,
  reason: 'se déplace sans but précis',
  targetX: 10,
  targetZ: -20,
  needs: { hydration: 0.82, hunger: 0.74, energy: 0.91 },
};

describe('protocole réseau', () => {
  it('round-trips a full init message', () => {
    const message: ServerMessage = {
      t: 'init',
      protocolVersion: PROTOCOL_VERSION,
      world: worldDescriptor,
      generation,
      clock,
      environment,
      sequenceNumber: 0,
      history: [],
      profiles: [
        {
          id: 1,
          name: 'Kara',
          sex: 'female',
          ageYears: 24,
          heightM: 1.6,
          massKg: 55,
          tint: 0.4,
          walkSpeedMps: 1.2,
          personality: {
            curiosity: 0.6,
            caution: 0.4,
            sociability: 0.5,
            aggression: 0.2,
            patience: 0.7,
            altruism: 0.5,
            courage: 0.4,
            perseverance: 0.6,
          },
          bornAtTick: 0,
        },
      ],
      humans: [humanState],
    };

    const parsed = parseServerMessage(encodeMessage(message));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(message);
  });

  it('round-trips a delta with removals', () => {
    const message: ServerMessage = {
      t: 'delta',
      sequenceNumber: 42,
      clock,
      environment,
      profiles: [],
      humans: [{ ...humanState, targetX: null, targetZ: null }],
      removed: [7, 9],
    };

    const parsed = parseServerMessage(encodeMessage(message));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(message);
  });

  it('round-trips a full snapshot message, including profiles', () => {
    const message: ServerMessage = {
      t: 'snapshot',
      sequenceNumber: 42,
      clock,
      environment,
      profiles: [
        {
          id: 1,
          name: 'Kara',
          sex: 'female',
          ageYears: 24,
          heightM: 1.6,
          massKg: 55,
          tint: 0.4,
          walkSpeedMps: 1.2,
          personality: {
            curiosity: 0.6,
            caution: 0.4,
            sociability: 0.5,
            aggression: 0.2,
            patience: 0.7,
            altruism: 0.5,
            courage: 0.4,
            perseverance: 0.6,
          },
          bornAtTick: 0,
        },
      ],
      humans: [humanState],
    };

    const parsed = parseServerMessage(encodeMessage(message));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(message);
  });

  it('round-trips a resource:removed message', () => {
    const message: ServerMessage = {
      t: 'resource:removed',
      chunkKey: '3:7',
      localId: 42,
      sequenceNumber: 17,
    };

    const parsed = parseServerMessage(encodeMessage(message));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(message);
  });

  it('round-trips resource:updated / resource:added deltas', () => {
    const updated: ServerMessage = {
      t: 'resource:updated',
      chunkKey: '-2:3',
      localId: 7,
      sequenceNumber: 100,
      changedFields: { harvestProgress: 0.42, damaged: true },
      state: 'modified',
    };
    const parsedU = parseServerMessage(encodeMessage(updated));
    expect(parsedU.ok).toBe(true);
    if (parsedU.ok) expect(parsedU.value).toEqual(updated);

    const added: ServerMessage = {
      t: 'resource:added',
      chunkKey: '0:0',
      localId: 12,
      sequenceNumber: 101,
      fields: { fromInteractive: true, definitionIndex: 3 },
    };
    const parsedA = parseServerMessage(encodeMessage(added));
    expect(parsedA.ok).toBe(true);
    if (parsedA.ok) expect(parsedA.value).toEqual(added);
  });

  it('round-trips client messages', () => {
    const hello = parseClientMessage(
      encodeMessage({ t: 'hello', protocolVersion: PROTOCOL_VERSION }),
    );
    expect(hello.ok).toBe(true);

    const control = parseClientMessage(
      encodeMessage({ t: 'control', action: 'setTimeScale', timeScale: 8 }),
    );
    expect(control.ok).toBe(true);
  });

  it('round-trips a client resync request', () => {
    const parsed = parseClientMessage(encodeMessage({ t: 'resync' }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual({ t: 'resync' });
  });

  it('round-trips compact trail updates', () => {
    const message: ServerMessage = {
      t: 'trail:updated',
      chunkKey: '-2:5',
      resolution: 32,
      cells: [
        { index: 18, wear: 12 },
        { index: 19, wear: 80 },
      ],
    };
    const parsed = parseServerMessage(encodeMessage(message));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(message);
  });

  it('rejects malformed JSON', () => {
    const parsed = parseServerMessage('{ not json');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toBe('invalid JSON');
  });

  it('rejects an unknown message type', () => {
    expect(parseServerMessage(JSON.stringify({ t: 'nope' })).ok).toBe(false);
  });

  it('rejects a message with a missing field', () => {
    expect(parseServerMessage(JSON.stringify({ t: 'pong' })).ok).toBe(false);
  });

  it('rejects an out-of-range time scale', () => {
    expect(
      parseClientMessage(JSON.stringify({ t: 'control', action: 'setTimeScale', timeScale: 1000 }))
        .ok,
    ).toBe(false);
  });
});
