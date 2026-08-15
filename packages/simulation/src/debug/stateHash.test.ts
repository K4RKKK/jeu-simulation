import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation.js';
import { hashSnapshot, hashWorldState } from './stateHash.js';

function makeSimulation(seed: string, population = 6): Simulation {
  return new Simulation({ seed, population, config: { time: { gameSecondsPerTick: 1 } } });
}

describe('hashSnapshot', () => {
  it("égale hashWorldState(source) au moment MÊME de la capture — sans passer par restoreSnapshot", () => {
    const source = makeSimulation('hash-snapshot-capture', 8);
    source.start();
    source.step(400);

    const hashOfSource = hashWorldState(source);
    const snapshot = source.captureSnapshot();

    expect(hashSnapshot(snapshot)).toBe(hashOfSource);
    source.dispose();
  });

  it('égale hashWorldState(target) après restoreSnapshot dans une simulation fraîche', () => {
    const source = makeSimulation('hash-snapshot-restore', 8);
    source.start();
    source.step(400);
    const snapshot = source.captureSnapshot();
    source.dispose();

    const target = makeSimulation('hash-snapshot-restore', 8);
    target.restoreSnapshot(snapshot);

    expect(hashSnapshot(snapshot)).toBe(hashWorldState(target));
    target.dispose();
  });

  it('change quand le contenu du snapshot change (population différente)', () => {
    const a = makeSimulation('hash-snapshot-diff-a', 4);
    a.step(50);
    const snapshotA = a.captureSnapshot();
    a.dispose();

    const b = makeSimulation('hash-snapshot-diff-b', 5);
    b.step(50);
    const snapshotB = b.captureSnapshot();
    b.dispose();

    expect(hashSnapshot(snapshotA)).not.toBe(hashSnapshot(snapshotB));
  });
});
