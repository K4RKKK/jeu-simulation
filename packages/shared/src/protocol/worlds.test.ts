import { describe, expect, it } from 'vitest';
import {
  createWorldRequestSchema,
  duplicateWorldRequestSchema,
  renameWorldRequestSchema,
  uploadThumbnailRequestSchema,
  worldSummaryListSchema,
  worldSummarySchema,
  worldsApiErrorSchema,
} from './worlds.js';

describe('worldSummarySchema', () => {
  it('accepte un résumé complet, label et isActive compris', () => {
    const summary = {
      name: 'valley-01',
      seed: 'PREHISTORY-84721',
      tick: 24086,
      humanCount: 18,
      savedAtIso: '2026-08-14T15:06:25.139Z',
      label: 'avant-catastrophe',
      isActive: true,
    };
    expect(worldSummarySchema.safeParse(summary).success).toBe(true);
  });

  it('accepte un résumé sans label (optionnel)', () => {
    const summary = {
      name: 'valley-01',
      seed: 'x',
      tick: 0,
      humanCount: 0,
      savedAtIso: '2026-01-01T00:00:00.000Z',
      isActive: false,
    };
    expect(worldSummarySchema.safeParse(summary).success).toBe(true);
  });

  it('rejette un résumé sans isActive — ne doit jamais être implicite', () => {
    const summary = {
      name: 'valley-01',
      seed: 'x',
      tick: 0,
      humanCount: 0,
      savedAtIso: '2026-01-01T00:00:00.000Z',
    };
    expect(worldSummarySchema.safeParse(summary).success).toBe(false);
  });

  it('worldSummaryListSchema valide un tableau de résumés', () => {
    const list = [
      {
        name: 'a',
        seed: 'x',
        tick: 1,
        humanCount: 1,
        savedAtIso: '2026-01-01T00:00:00.000Z',
        isActive: true,
      },
      {
        name: 'b',
        seed: 'y',
        tick: 2,
        humanCount: 2,
        savedAtIso: '2026-01-02T00:00:00.000Z',
        isActive: false,
      },
    ];
    expect(worldSummaryListSchema.safeParse(list).success).toBe(true);
  });
});

describe('createWorldRequestSchema', () => {
  it('accepte juste un nom — tout le reste est optionnel (choix serveur)', () => {
    expect(createWorldRequestSchema.safeParse({ name: 'valley-02' }).success).toBe(true);
  });

  it('accepte un nom avec tous les champs optionnels renseignés', () => {
    const request = { name: 'valley-02', seed: 's', sizeChunks: 24, population: 15 };
    expect(createWorldRequestSchema.safeParse(request).success).toBe(true);
  });

  it('rejette un nom vide', () => {
    expect(createWorldRequestSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejette une population négative ou nulle', () => {
    expect(createWorldRequestSchema.safeParse({ name: 'x', population: 0 }).success).toBe(false);
    expect(createWorldRequestSchema.safeParse({ name: 'x', population: -5 }).success).toBe(false);
  });
});

describe('renameWorldRequestSchema / duplicateWorldRequestSchema', () => {
  it('acceptent un newName valide', () => {
    expect(renameWorldRequestSchema.safeParse({ newName: 'valley-renamed' }).success).toBe(true);
    expect(duplicateWorldRequestSchema.safeParse({ newName: 'valley-copy' }).success).toBe(true);
  });

  it('rejettent un newName vide', () => {
    expect(renameWorldRequestSchema.safeParse({ newName: '' }).success).toBe(false);
    expect(duplicateWorldRequestSchema.safeParse({ newName: '' }).success).toBe(false);
  });
});

describe('uploadThumbnailRequestSchema', () => {
  it('accepte une image base64 non vide', () => {
    expect(uploadThumbnailRequestSchema.safeParse({ image: 'ZmFrZS1qcGVn' }).success).toBe(true);
  });

  it('rejette une image vide', () => {
    expect(uploadThumbnailRequestSchema.safeParse({ image: '' }).success).toBe(false);
  });
});

describe('worldsApiErrorSchema', () => {
  it('accepte un message d’erreur', () => {
    expect(worldsApiErrorSchema.safeParse({ error: 'monde introuvable' }).success).toBe(true);
  });
});
