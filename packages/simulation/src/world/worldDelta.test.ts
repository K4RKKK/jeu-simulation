import { describe, expect, it } from 'vitest';
import { WorldChangeJournal, WorldDelta } from './worldDelta.js';

describe('WorldDelta trails', () => {
  it('accumulates wear and reports only transmitted byte changes', () => {
    const delta = new WorldDelta();
    expect(delta.addTrailWear('1:2', 4, 5, 0.001)).toBeNull();
    expect(delta.addTrailWear('1:2', 4, 5, 0.004)).toBeGreaterThan(0);
    expect(delta.trailGrid('1:2', 4)[5]).toBeCloseTo(0.005, 5);
  });

  it('survives save and restore without sharing mutable storage', () => {
    const source = new WorldDelta();
    source.addTrailWear('-1:0', 8, 17, 0.42);
    const restored = new WorldDelta();
    restored.restoreFrom(source.toJSON());

    expect(restored.trailGrid('-1:0', 8)[17]).toBeCloseTo(0.42, 5);
    restored.addTrailWear('-1:0', 8, 17, 0.1);
    expect(source.trailGrid('-1:0', 8)[17]).toBeCloseTo(0.42, 5);
  });

  /**
   * Bug corrigé (première version) : `addTrailWear` incrémentait un compteur GLOBAL
   * partagé avec les ressources. Comme `ChunkManager.payloadUpToDate` comparait ce
   * compteur pour décider s'il devait re-scanner les ressources d'un chunk, un pas
   * d'humain n'importe où dans le monde faisait croire à TOUS les chunks actifs
   * qu'une ressource avait peut-être changé — un balayage inutile à chaque appel.
   * Sentiers et ressources ont maintenant chacun leur propre révision PAR CHUNK,
   * entièrement indépendantes l'une de l'autre.
   */
  it('l’usure d’un sentier ne fait jamais bouger la révision des ressources du même chunk', () => {
    const delta = new WorldDelta();
    const before = delta.resourceRevision('2:3');

    delta.addTrailWear('2:3', 8, 10, 0.5);
    delta.addTrailWear('2:3', 8, 11, 0.5);
    delta.addTrailWear('5:-1', 8, 3, 0.5);

    expect(delta.resourceRevision('2:3')).toBe(before);
  });

  describe('resourceRevision', () => {
    it('bouge pour patch/markDepleted/markRemoved/restore, uniquement pour LEUR chunk', () => {
      const delta = new WorldDelta();
      const r0 = delta.resourceRevision('0:0');
      expect(delta.resourceRevision('9:9')).toBe(0); // jamais touché : reste à 0

      delta.patch('res-a', '0:0', 0, { remainingFraction01: 0.5 }, 10);
      expect(delta.resourceRevision('0:0')).toBeGreaterThan(r0);
      const r1 = delta.resourceRevision('0:0');

      delta.markDepleted('res-b', '0:0', 1, 11);
      expect(delta.resourceRevision('0:0')).toBeGreaterThan(r1);
      const r2 = delta.resourceRevision('0:0');

      delta.markRemoved('res-c', '0:0', 2, 12);
      expect(delta.resourceRevision('0:0')).toBeGreaterThan(r2);
      const r3 = delta.resourceRevision('0:0');

      // `restore` ne reprend pas la clé de chunk : elle vient du delta déjà stocké.
      delta.restore('res-c');
      expect(delta.resourceRevision('0:0')).toBeGreaterThan(r3);

      // Rien de tout cela n'a jamais concerné un autre chunk.
      expect(delta.resourceRevision('9:9')).toBe(0);
    });

    it('reste indépendante entre chunks — symétrique à `trailRevision`', () => {
      const delta = new WorldDelta();
      delta.markDepleted('res-a', '0:0', 0, 1);
      const revA0 = delta.resourceRevision('0:0');
      const revB0 = delta.resourceRevision('1:1');

      delta.markDepleted('res-b', '1:1', 0, 1);
      expect(delta.resourceRevision('0:0')).toBe(revA0); // inchangé
      expect(delta.resourceRevision('1:1')).toBeGreaterThan(revB0);
    });
  });

  it('les révisions de sentiers restent indépendantes entre chunks', () => {
    const delta = new WorldDelta();
    delta.addTrailWear('0:0', 4, 0, 0.5);
    const revA0 = delta.trailRevision('0:0');
    const revB0 = delta.trailRevision('1:1');

    delta.addTrailWear('1:1', 4, 0, 0.5);
    expect(delta.trailRevision('0:0')).toBe(revA0); // inchangé
    expect(delta.trailRevision('1:1')).toBeGreaterThan(revB0);
  });

  describe('trailSparseCells', () => {
    it('renvoie un tableau vide sans rien allouer pour un chunk jamais foulé', () => {
      const delta = new WorldDelta();
      expect(delta.trailSparseCells('never-touched', 8)).toEqual([]);
    });

    it('ne renvoie que les cellules dont l’octet transmis est visible (> 0)', () => {
      const delta = new WorldDelta();
      delta.addTrailWear('0:0', 4, 2, 1); // usure maximale, bien visible
      delta.addTrailWear('0:0', 4, 7, 0.001); // sous le seuil d’un octet, reste à 0
      expect(delta.trailSparseCells('0:0', 4)).toEqual([{ index: 2, wear: 255 }]);
    });

    it('renvoie un tableau vide pour une résolution différente de celle enregistrée', () => {
      const delta = new WorldDelta();
      delta.addTrailWear('0:0', 4, 2, 1);
      expect(delta.trailSparseCells('0:0', 8)).toEqual([]);
    });
  });
});

describe('WorldChangeJournal — resourceUpdates', () => {
  it('drain vide un journal vide', () => {
    const journal = new WorldChangeJournal();
    expect(journal.consumeResourceUpdates()).toEqual([]);
  });

  it('vide le journal après lecture (comme consumeRemovals/consumeTrailChanges)', () => {
    const journal = new WorldChangeJournal();
    journal.pushResourceUpdate({
      resourceId: 'res-a',
      ownerChunkKey: '0:0',
      localId: 3,
      changedFields: { remainingFraction01: 0.5 },
      tick: 10,
    });
    expect(journal.consumeResourceUpdates()).toHaveLength(1);
    expect(journal.consumeResourceUpdates()).toEqual([]);
  });

  /**
   * Dédoublonnage par `resourceId` — même principe que `pushTrailChange` : une même
   * ressource récoltée deux fois avant la prochaine diffusion ne part qu'une fois,
   * avec son état le plus récent (pas les deux, pas le premier).
   */
  it('ne conserve que la mise à jour la plus récente pour une même ressource', () => {
    const journal = new WorldChangeJournal();
    journal.pushResourceUpdate({
      resourceId: 'res-a',
      ownerChunkKey: '0:0',
      localId: 3,
      changedFields: { remainingFraction01: 0.66 },
      tick: 10,
    });
    journal.pushResourceUpdate({
      resourceId: 'res-a',
      ownerChunkKey: '0:0',
      localId: 3,
      changedFields: { remainingFraction01: 0.33 },
      tick: 11,
    });

    const updates = journal.consumeResourceUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0]!.changedFields.remainingFraction01).toBe(0.33);
    expect(updates[0]!.tick).toBe(11);
  });

  it('conserve des mises à jour indépendantes pour des ressources différentes', () => {
    const journal = new WorldChangeJournal();
    journal.pushResourceUpdate({
      resourceId: 'res-a',
      ownerChunkKey: '0:0',
      localId: 1,
      changedFields: { remainingFraction01: 0.5 },
      tick: 10,
    });
    journal.pushResourceUpdate({
      resourceId: 'res-b',
      ownerChunkKey: '1:1',
      localId: 2,
      changedFields: { remainingFraction01: 0.25 },
      tick: 10,
    });

    const ids = journal
      .consumeResourceUpdates()
      .map((update) => update.resourceId)
      .sort();
    expect(ids).toEqual(['res-a', 'res-b']);
  });
});
