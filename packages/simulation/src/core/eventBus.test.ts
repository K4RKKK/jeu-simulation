import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './eventBus.js';
import { EventRecorder } from './eventRecorder.js';

describe('EventBus', () => {
  it('delivers a published event to its subscribers', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('HumanDied', handler);

    bus.emit('HumanDied', { tick: 5, entity: 1, name: 'Kara', cause: 'faim' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ tick: 5, entity: 1, name: 'Kara', cause: 'faim' });
  });

  it('does not deliver an event to subscribers of another event', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('HumanDied', handler);

    bus.emit('HumanBorn', { tick: 1, entity: 1, name: 'Kara', ageYears: 20 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribes through the returned function and through off()', () => {
    const bus = new EventBus();
    const viaReturn = vi.fn();
    const viaOff = vi.fn();

    const unsubscribe = bus.on('SimulationPaused', viaReturn);
    bus.on('SimulationPaused', viaOff);

    unsubscribe();
    expect(bus.off('SimulationPaused', viaOff)).toBe(true);
    bus.emit('SimulationPaused', { tick: 1 });

    expect(viaReturn).not.toHaveBeenCalled();
    expect(viaOff).not.toHaveBeenCalled();
    expect(bus.listenerCount('SimulationPaused')).toBe(0);
  });

  it('fires a once() subscriber a single time', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.once('SimulationResumed', handler);

    bus.emit('SimulationResumed', { tick: 1 });
    bus.emit('SimulationResumed', { tick: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('lets a handler unsubscribe during emission without skipping others', () => {
    const bus = new EventBus();
    const calls: string[] = [];

    const first = (): void => {
      calls.push('first');
      bus.off('SimulationPaused', second);
    };
    const second = (): void => {
      calls.push('second');
    };

    bus.on('SimulationPaused', first);
    bus.on('SimulationPaused', second);
    bus.emit('SimulationPaused', { tick: 1 });

    expect(calls).toEqual(['first', 'second']);
  });

  it('isolates a throwing handler', () => {
    const bus = new EventBus();
    const errors: string[] = [];
    bus.setErrorReporter((_error, name) => errors.push(name));

    const healthy = vi.fn();
    bus.on('SimulationPaused', () => {
      throw new Error('boom');
    });
    bus.on('SimulationPaused', healthy);

    expect(() => bus.emit('SimulationPaused', { tick: 1 })).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(errors).toEqual(['SimulationPaused']);
  });

  it('notifies onAny subscribers of every event', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.onAny((name) => seen.push(name));

    bus.emit('SimulationPaused', { tick: 1 });
    bus.emit('SimulationResumed', { tick: 2 });

    expect(seen).toEqual(['SimulationPaused', 'SimulationResumed']);
  });
});

describe('EventRecorder', () => {
  it('buffers events and drains them once', () => {
    const bus = new EventBus();
    const recorder = new EventRecorder(bus, 10);

    bus.emit('SimulationPaused', { tick: 1 });
    bus.emit('SimulationResumed', { tick: 2 });

    expect(recorder.drain()).toHaveLength(2);
    expect(recorder.drain()).toHaveLength(0);
    expect(recorder.totalCount).toBe(2);
  });

  it('drops the oldest events beyond capacity', () => {
    const bus = new EventBus();
    const recorder = new EventRecorder(bus, 3);

    for (let tick = 1; tick <= 5; tick++) bus.emit('SimulationPaused', { tick });

    const drained = recorder.drain();
    expect(drained).toHaveLength(3);
    expect(drained.map((event) => event.payload.tick)).toEqual([3, 4, 5]);
    expect(recorder.droppedCount).toBe(2);
    expect(recorder.totalCount).toBe(5);
  });

  it('counts events by name', () => {
    const bus = new EventBus();
    const recorder = new EventRecorder(bus);

    bus.emit('SimulationPaused', { tick: 1 });
    bus.emit('SimulationPaused', { tick: 2 });
    bus.emit('SimulationResumed', { tick: 3 });

    expect(recorder.countsByName()).toEqual({ SimulationPaused: 2, SimulationResumed: 1 });
  });

  it('stops recording after dispose', () => {
    const bus = new EventBus();
    const recorder = new EventRecorder(bus);
    recorder.dispose();

    bus.emit('SimulationPaused', { tick: 1 });
    expect(recorder.totalCount).toBe(0);
  });
});
