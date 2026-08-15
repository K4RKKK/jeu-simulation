import type { HumanProfile, HumanState, NetworkEvent } from '@civ/shared';
import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { ClientSession } from './clientSession.js';
import { EntityInterestManager, eventsForInterest } from './entityInterestManager.js';

function state(id: number, x: number, z: number): HumanState {
  return {
    id,
    x,
    y: 0,
    z,
    yaw: 0,
    speed: 0,
    activity: 'idle',
    reason: 'test',
    targetX: null,
    targetZ: null,
    needs: { hydration: 1, hunger: 1, energy: 1 },
  };
}

function profile(id: number): HumanProfile {
  return {
    id,
    name: `Human ${id}`,
    sex: 'female',
    ageYears: 20,
    heightM: 1.7,
    massKg: 60,
    tint: 0.5,
    walkSpeedMps: 1,
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

function event(type: string, entityId: number | null): NetworkEvent {
  return { type, entityId, tick: 1, year: 1, day: 1, hour: 0, minute: 0, message: type };
}

function fakeSocket(): WebSocket {
  return { readyState: 1, OPEN: 1, send: () => {} } as unknown as WebSocket;
}

describe('EntityInterestManager', () => {
  it('ne sélectionne que les humains de la zone observée avec une couronne de stabilité', () => {
    const manager = new EntityInterestManager(64, { maxRadiusChunks: 4, paddingChunks: 1 });
    const states = [state(1, 10, 10), state(2, 120, 10), state(3, 260, 10)];
    manager.rebuild(
      states.map(({ id }) => profile(id)),
      states,
    );

    const selected = manager.select({ x: 0, z: 0 }, 0);

    expect(selected.humans.map(({ id }) => id).sort()).toEqual([1, 2]);
    expect(selected.profiles.map(({ id }) => id).sort()).toEqual([1, 2]);
    expect(selected.entityIds).toEqual(new Set([1, 2]));
  });

  it('ne révèle rien avant la première déclaration de zone du client', () => {
    const manager = new EntityInterestManager(64);
    manager.rebuild([profile(1)], [state(1, 10, 10)]);
    expect(manager.select(null, 999).humans).toEqual([]);
  });

  it('borne une demande de rayon excessive', () => {
    const manager = new EntityInterestManager(64, { maxRadiusChunks: 1, paddingChunks: 0 });
    const states = [state(1, 10, 10), state(2, 200, 10)];
    manager.rebuild(
      states.map(({ id }) => profile(id)),
      states,
    );
    expect(manager.select({ x: 0, z: 0 }, 10_000).humans.map(({ id }) => id)).toEqual([1]);
  });

  it('borne aussi une foule dense avec une sélection stable', () => {
    const manager = new EntityInterestManager(64, {
      maxRadiusChunks: 2,
      paddingChunks: 0,
      maxEntitiesPerSession: 2,
    });
    const states = [state(1, 30, 30), state(2, 34, 32), state(3, 60, 60)];
    manager.rebuild(
      states.map(({ id }) => profile(id)),
      states,
    );
    expect(manager.select({ x: 0, z: 0 }, 1).humans.map(({ id }) => id)).toEqual([1, 2]);
  });

  it('garde les événements mondiaux et majeurs, mais filtre les actions lointaines', () => {
    const filtered = eventsForInterest(
      [
        event('SimulationPaused', null),
        event('HumanBorn', 9),
        event('HumanDied', 8),
        event('ActionStarted', 1),
        event('ActionStarted', 2),
      ],
      new Set([1]),
    );
    expect(filtered.map(({ type, entityId }) => [type, entityId])).toEqual([
      ['SimulationPaused', null],
      ['HumanBorn', 9],
      ['HumanDied', 8],
      ['ActionStarted', 1],
    ]);
  });

  it('produit un retrait puis une réintroduction propres quand la caméra change de zone', () => {
    const manager = new EntityInterestManager(64, { paddingChunks: 0 });
    const states = [state(1, 10, 10), state(2, 650, 10)];
    manager.rebuild(
      states.map(({ id }) => profile(id)),
      states,
    );
    const session = new ClientSession(fakeSocket());
    const west = manager.select({ x: 0, z: 0 }, 0);
    session.rememberFullState(west.profiles, west.humans);

    const east = manager.select({ x: 10, z: 0 }, 0);
    const movedEast = session.computeDelta(east.profiles, east.humans);
    expect(movedEast.removed).toEqual([1]);
    expect(movedEast.profiles.map(({ id }) => id)).toEqual([2]);
    expect(movedEast.humans.map(({ id }) => id)).toEqual([2]);

    const returnedWest = session.computeDelta(west.profiles, west.humans);
    expect(returnedWest.removed).toEqual([2]);
    expect(returnedWest.profiles.map(({ id }) => id)).toEqual([1]);
    expect(returnedWest.humans.map(({ id }) => id)).toEqual([1]);
  });
});
