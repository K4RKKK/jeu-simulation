import { describe, expect, it } from 'vitest';
import { defineComponent } from './componentType.js';
import { EntityManager } from './entityManager.js';

interface Position {
  x: number;
  y: number;
}
interface Velocity {
  dx: number;
}
interface Tag {
  label: string;
}

const Position = defineComponent<Position>('TestPosition');
const Velocity = defineComponent<Velocity>('TestVelocity');
const Tag = defineComponent<Tag>('TestTag');

describe('EntityManager', () => {
  it('creates entities with unique, never-reused identifiers', () => {
    const entities = new EntityManager();
    const a = entities.createEntity();
    const b = entities.createEntity();

    expect(a).not.toBe(b);
    expect(entities.entityCount).toBe(2);

    entities.destroyEntity(a);
    const c = entities.createEntity();
    expect(c).not.toBe(a);
    expect(entities.exists(a)).toBe(false);
  });

  it('adds, reads and removes components', () => {
    const entities = new EntityManager();
    const entity = entities.createEntity();

    expect(entities.hasComponent(entity, Position)).toBe(false);
    expect(entities.getComponent(entity, Position)).toBeUndefined();

    entities.addComponent(entity, Position, { x: 3, y: 4 });
    expect(entities.hasComponent(entity, Position)).toBe(true);
    expect(entities.getComponent(entity, Position)).toEqual({ x: 3, y: 4 });

    expect(entities.removeComponent(entity, Position)).toBe(true);
    expect(entities.removeComponent(entity, Position)).toBe(false);
    expect(entities.hasComponent(entity, Position)).toBe(false);
  });

  it('refuses to add a component to a destroyed entity', () => {
    const entities = new EntityManager();
    const entity = entities.createEntity();
    entities.destroyEntity(entity);

    expect(() => entities.addComponent(entity, Position, { x: 0, y: 0 })).toThrow(/dead entity/);
  });

  it('destroying an entity removes all its components', () => {
    const entities = new EntityManager();
    const entity = entities.createEntity();
    entities.addComponent(entity, Position, { x: 1, y: 1 });
    entities.addComponent(entity, Velocity, { dx: 2 });

    expect(entities.destroyEntity(entity)).toBe(true);
    expect(entities.getComponent(entity, Position)).toBeUndefined();
    expect(entities.getComponent(entity, Velocity)).toBeUndefined();
    expect(entities.destroyEntity(entity)).toBe(false);
  });

  it('queries the intersection of component types', () => {
    const entities = new EntityManager();
    const both = entities.createEntity();
    const onlyPosition = entities.createEntity();
    const onlyVelocity = entities.createEntity();

    entities.addComponent(both, Position, { x: 0, y: 0 });
    entities.addComponent(both, Velocity, { dx: 1 });
    entities.addComponent(onlyPosition, Position, { x: 5, y: 5 });
    entities.addComponent(onlyVelocity, Velocity, { dx: 9 });

    expect(entities.query(Position, Velocity)).toEqual([both]);
    expect(entities.query(Position)).toEqual([both, onlyPosition]);
    expect(entities.query(Tag)).toEqual([]);
  });

  it('returns query results sorted by id, regardless of insertion order', () => {
    const entities = new EntityManager();
    const first = entities.createEntity();
    const second = entities.createEntity();
    const third = entities.createEntity();

    entities.addComponent(third, Position, { x: 0, y: 0 });
    entities.addComponent(first, Position, { x: 0, y: 0 });
    entities.addComponent(second, Position, { x: 0, y: 0 });

    expect(entities.query(Position)).toEqual([first, second, third]);

    // Retirer puis remettre un composant ne doit pas changer l'ordre d'itération :
    // c'est la garantie qui protège le déterminisme de la simulation.
    entities.removeComponent(first, Position);
    entities.addComponent(first, Position, { x: 1, y: 1 });
    expect(entities.query(Position)).toEqual([first, second, third]);
  });

  it('iterates matching entities with their components via each()', () => {
    const entities = new EntityManager();
    const a = entities.createEntity();
    const b = entities.createEntity();
    const c = entities.createEntity();

    entities.addComponent(a, Position, { x: 1, y: 1 });
    entities.addComponent(a, Velocity, { dx: 10 });
    entities.addComponent(b, Position, { x: 2, y: 2 });
    entities.addComponent(c, Velocity, { dx: 30 });

    const visited: Array<[number, number, number]> = [];
    entities.each([Position, Velocity], (entity, position, velocity) => {
      visited.push([entity, position.x, velocity.dx]);
    });

    expect(visited).toEqual([[a, 1, 10]]);
  });

  it('exposes mutable component references through each()', () => {
    const entities = new EntityManager();
    const entity = entities.createEntity();
    entities.addComponent(entity, Position, { x: 0, y: 0 });

    entities.each([Position], (_entity, position) => {
      position.x = 42;
    });

    expect(entities.getComponent(entity, Position)?.x).toBe(42);
  });

  it('describes an entity for debugging', () => {
    const entities = new EntityManager();
    const entity = entities.createEntity();
    entities.addComponent(entity, Position, { x: 7, y: 8 });
    entities.addComponent(entity, Tag, { label: 'hello' });

    expect(entities.describeEntity(entity)).toEqual({
      TestPosition: { x: 7, y: 8 },
      TestTag: { label: 'hello' },
    });
  });

  it('protects persisted ids when restoring the counter', () => {
    const entities = new EntityManager();
    entities.createEntity();
    entities.createEntity();

    expect(() => entities.restoreNextId(2)).toThrow(/reuse/);
    entities.restoreNextId(100);
    expect(entities.createEntity()).toBe(100);
  });

  /**
   * Après plusieurs morts, les identifiants vivants ont des trous (1, 2, 4, 8, 12, 57…).
   * La persistance doit pouvoir reconstruire exactement ce jeu d'identifiants — pas
   * seulement un compteur — sinon un rechargement réattribuerait des ids différents et
   * romprait toute référence externe (mémoire d'un autre humain, cible de chemin…).
   */
  /**
   * Bug corrigé : charger une sauvegarde de 6 entités dans une simulation qui venait
   * de créer 15 entités par défaut (population initiale construite avant le
   * chargement) levait à tort « réutilisation d'id » avec `restoreNextId`, alors qu'un
   * chargement remplace l'état vivant en entier — reculer le compteur y est légitime.
   */
  it('forceNextId allows moving the counter backward for a full state replace', () => {
    const entities = new EntityManager();
    entities.createEntity();
    entities.createEntity();
    entities.createEntity(); // nextId = 4

    expect(() => entities.restoreNextId(2)).toThrow(/reuse/);

    entities.clear();
    entities.forceNextId(2); // ne lève pas, contrairement à restoreNextId
    expect(entities.createEntity()).toBe(2);
  });

  it('restores an entity with a specific id, including gaps', () => {
    const entities = new EntityManager();
    for (const id of [1, 2, 4, 8, 12, 57]) entities.restoreEntity(id);
    entities.restoreNextId(58);

    expect(entities.allEntities()).toEqual([1, 2, 4, 8, 12, 57]);
    expect(entities.exists(4)).toBe(true);
    expect(entities.exists(5)).toBe(false);
    expect(entities.createEntity()).toBe(58);
  });

  it('restores a component value directly onto a given entity id', () => {
    const entities = new EntityManager();
    entities.restoreEntity(42);
    entities.restoreComponent(42, Position, { x: 3, y: 4 });

    expect(entities.getComponentOrThrow(42, Position)).toEqual({ x: 3, y: 4 });
  });

  it('exposes component stores by name for serialization', () => {
    const entities = new EntityManager();
    const entity = entities.createEntity();
    entities.addComponent(entity, Position, { x: 1, y: 2 });
    entities.addComponent(entity, Tag, { label: 'hi' });

    const stores = entities.storesByName();
    expect(stores.get('TestPosition')?.get(entity)).toEqual({ x: 1, y: 2 });
    expect(stores.get('TestTag')?.get(entity)).toEqual({ label: 'hi' });
    expect(stores.get('TestVelocity')).toBeUndefined();
  });
});
