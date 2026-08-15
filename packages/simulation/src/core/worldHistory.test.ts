import { describe, expect, it } from 'vitest';
import { EventBus } from './eventBus.js';
import { WorldHistory } from './worldHistory.js';

describe('WorldHistory', () => {
  it('conserve les événements majeurs et ignore le trafic courant', () => {
    const bus = new EventBus();
    const history = new WorldHistory(bus);

    bus.emit('HumanBorn', { tick: 4, entity: 1, name: 'Nara', ageYears: 20 });
    bus.emit('ActionStarted', { tick: 5, entity: 1, action: 'walk', reason: 'explore' });
    bus.emit('HumanDied', { tick: 90, entity: 1, name: 'Nara', cause: 'vieillesse' });

    expect(history.values().map((event) => event.name)).toEqual(['HumanBorn', 'HumanDied']);
  });

  it('reste borné et restaure une copie indépendante', () => {
    const bus = new EventBus();
    const history = new WorldHistory(bus, 2);
    for (let entity = 1; entity <= 3; entity++) {
      bus.emit('HumanBorn', { tick: entity, entity, name: `Human${entity}`, ageYears: 20 });
    }

    const state = history.getState();
    expect(state.map((event) => event.payload.tick)).toEqual([2, 3]);

    const restored = new WorldHistory(new EventBus(), 2);
    restored.setState(state);
    state.length = 0;
    expect(restored.values()).toHaveLength(2);
  });
});
