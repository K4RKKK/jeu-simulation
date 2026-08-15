// @vitest-environment happy-dom

import type { NetworkEvent } from '@civ/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerConnection } from '../net/connection.js';
import type { HumanRecord, WorldStore } from '../net/worldStore.js';
import type { ChunkStore } from '../world/chunkStore.js';
import { InspectorPanel } from './inspectorPanel.js';
import { PlayerHud } from './playerHud.js';
import { PopulationPanel } from './populationPanel.js';
import { WorldChronicle } from './worldChronicle.js';
import { WorldPanel } from './worldPanel.js';

function record(id: number, name: string): HumanRecord {
  const current = {
    id,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    speed: 0,
    activity: 'idle' as const,
    reason: 'observe les environs',
    targetX: null,
    targetZ: null,
    needs: { hydration: 0.8, hunger: 0.7, energy: 0.9 },
  };
  return {
    profile: {
      id,
      name,
      sex: 'female',
      ageYears: 24,
      heightM: 1.65,
      massKg: 58,
      tint: 0.4,
      walkSpeedMps: 1.2,
      personality: {
        curiosity: 0.7,
        caution: 0.4,
        sociability: 0.6,
        aggression: 0.2,
        patience: 0.5,
        altruism: 0.6,
        courage: 0.5,
        perseverance: 0.7,
      },
      bornAtTick: 0,
    },
    current,
    previous: current,
    currentAt: 0,
    previousAt: 0,
  };
}

function event(tick: number, message = `Événement ${tick}`): NetworkEvent {
  return {
    type: 'HumanBorn',
    tick,
    year: 1,
    day: Math.floor(tick / 24) + 1,
    hour: tick % 24,
    minute: 0,
    entityId: tick + 1,
    message,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe('WorldChronicle', () => {
  it('ignore les doublons, borne son historique et ouvre/ferme son tiroir', () => {
    const panel = document.createElement('aside');
    const list = document.createElement('div');
    const toasts = document.createElement('div');
    document.body.append(panel, list, toasts);
    const chronicle = new WorldChronicle(panel, list, toasts);

    chronicle.ingest([event(1), event(1)]);
    expect(chronicle.size).toBe(1);

    chronicle.ingest(Array.from({ length: 260 }, (_, index) => event(index + 2)));
    expect(chronicle.size).toBe(240);
    expect(list.querySelectorAll('.world-chronicle__entry')).toHaveLength(240);

    chronicle.open();
    expect(panel.getAttribute('aria-hidden')).toBe('false');
    chronicle.close();
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    chronicle.dispose();
  });
});

describe('PopulationPanel', () => {
  it('filtre la population et conserve un favori', () => {
    const records = new Map([
      [1, record(1, 'Nara')],
      [2, record(2, 'Kelan')],
    ]);
    const store = {
      values: () => records.values(),
      get: (id: number) => records.get(id),
    } as unknown as WorldStore;
    const panel = document.createElement('aside');
    const list = document.createElement('div');
    const search = document.createElement('input');
    const population = new PopulationPanel(panel, list, search, store, vi.fn());
    population.setWorld('world-ui');
    population.open();

    search.value = 'nar';
    search.dispatchEvent(new Event('input'));
    expect(list.querySelectorAll('.population-row')).toHaveLength(1);
    expect(list.textContent).toContain('Nara');

    search.value = '';
    search.dispatchEvent(new Event('input'));
    list.querySelector<HTMLButtonElement>('[data-entity-id="2"] .favorite-button')?.click();
    expect(list.querySelector('[data-entity-id="2"] .favorite-button')?.textContent).toBe('★');
    expect(localStorage.getItem('civ:world-ui:favorites')).toBe('[2]');
  });
});

describe('PlayerHud', () => {
  it('envoie la bonne intention avec le bouton pause/reprise', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <span id="hud-date"></span><span id="hud-population"></span><span id="hud-weather"></span>
      <button data-action="pause-toggle"></button><button data-speed="1"></button>
    `;
    const store = {
      clock: { year: 1, day: 2, hour: 9, minute: 5, paused: false, timeScale: 1 },
      environment: {
        ambientTemperatureC: 14,
        isDaytime: true,
        season: 'été',
        weather: { kind: 'rain' },
      },
      humanCount: 2,
    } as unknown as WorldStore;
    const send = vi.fn();
    const connection = { status: 'open', send } as unknown as ServerConnection;
    new PlayerHud(root, store, connection);

    root.querySelector<HTMLButtonElement>('[data-action="pause-toggle"]')?.click();

    expect(send).toHaveBeenCalledWith({ t: 'control', action: 'pause' });
    expect(root.querySelector('#hud-date')?.textContent).toBe('Jour 2 • 09:05');
    expect(root.querySelector('#hud-weather')?.textContent).toContain('🌧');
    expect(root.querySelector('#hud-weather')?.getAttribute('title')).toBe('Pluie');
  });
});

describe('InspectorPanel', () => {
  it('préserve les sections ouvertes lors du rafraîchissement', () => {
    const panel = document.createElement('aside');
    const content = document.createElement('div');
    document.body.append(panel, content);
    const inspector = new InspectorPanel(panel, content);
    inspector.show(record(1, 'Nara'));

    const physiology = content.querySelector<HTMLDetailsElement>('[data-section="physiology"]')!;
    physiology.open = true;
    physiology.querySelector<HTMLElement>('summary')?.focus();
    inspector.show(record(1, 'Nara'));

    const restored = content.querySelector<HTMLDetailsElement>('[data-section="physiology"]')!;
    expect(restored.open).toBe(true);
    expect(document.activeElement).toBe(restored.querySelector('summary'));
  });
});

describe('WorldPanel', () => {
  it('affiche les observations réelles plutôt que les totaux générés', () => {
    const panel = document.createElement('aside');
    const content = document.createElement('div');
    const store = {
      clock: { year: 1, day: 4 },
      environment: {
        season: 'été',
        ambientTemperatureC: 18,
        weather: { kind: 'storm', precipitation01: 0.82, windMps: 12.4 },
      },
      humanCount: 3,
    } as unknown as WorldStore;
    const chunks = {
      metadata: { waterBodies: Array.from({ length: 99 }) },
      observedRegionCount: 2,
      observedWaterBodyCount: 1,
    } as unknown as ChunkStore;
    const world = new WorldPanel(panel, content, store, chunks);

    world.open();

    expect(content.textContent).toContain('Régions observées2');
    expect(content.textContent).toContain("Étendues d'eau observées1");
    expect(content.textContent).not.toContain('99');
    expect(content.textContent).toContain('MétéoOrage');
    expect(content.textContent).toContain('Précipitations82 %');
    expect(content.textContent).toContain('Vent12.4 m/s');
  });
});
