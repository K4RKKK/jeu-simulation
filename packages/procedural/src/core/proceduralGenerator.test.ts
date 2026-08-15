import {
  BiomeRegistry,
  DEFAULT_BIOMES,
  DEFAULT_RESOURCES,
  DEFAULT_WATER_PROFILES,
  ResourceRegistry,
  WaterProfileRegistry,
  type ContentCatalog,
} from '@civ/content';
import { describe, expect, it } from 'vitest';
import { ProceduralGenerator } from './proceduralGenerator.js';

function makeCatalog(overrides: Partial<ContentCatalog> = {}): ContentCatalog {
  const biomes = new BiomeRegistry();
  biomes.registerAll(DEFAULT_BIOMES);
  const resources = new ResourceRegistry();
  resources.registerAll(DEFAULT_RESOURCES);
  const waterProfiles = new WaterProfileRegistry();
  waterProfiles.registerAll(DEFAULT_WATER_PROFILES);
  return { biomes, resources, waterProfiles, ...overrides };
}

describe('ProceduralGenerator.fingerprintSource', () => {
  it('est identique pour deux générateurs construits avec la même config et le même contenu', () => {
    const a = new ProceduralGenerator({ seed: 'fp-a' });
    const b = new ProceduralGenerator({ seed: 'fp-a' });
    expect(JSON.stringify(a.fingerprintSource)).toBe(JSON.stringify(b.fingerprintSource));
  });

  /**
   * C'est exactement le trou que `configFingerprint` v6 comble : avant, seul
   * `generationVersion` (une chaîne bumpée à la main) aurait pu détecter cette dérive —
   * et seulement si quelqu'un avait pensé à la bumper.
   */
  it("change quand un paramètre numérique de génération change (ex: hydrology.waterLevel01)", () => {
    const base = new ProceduralGenerator({ seed: 'fp-param' });
    const changed = new ProceduralGenerator({
      seed: 'fp-param',
      overrides: { hydrology: { waterLevel01: 0.4 } },
    });
    expect(JSON.stringify(changed.fingerprintSource)).not.toBe(
      JSON.stringify(base.fingerprintSource),
    );
  });

  /** Même chose côté contenu déclaratif : une baie rendue plus toxique doit aussi compter. */
  it('change quand une définition de contenu change (ex: toxicité d’une ressource)', () => {
    const base = new ProceduralGenerator({ seed: 'fp-content', content: makeCatalog() });

    const resources = new ResourceRegistry();
    resources.registerAll(
      DEFAULT_RESOURCES.map((resource) =>
        resource.food ? { ...resource, food: { ...resource.food, toxicity01: 1 } } : resource,
      ),
    );
    const changed = new ProceduralGenerator({
      seed: 'fp-content',
      content: makeCatalog({ resources }),
    });

    expect(JSON.stringify(changed.fingerprintSource)).not.toBe(
      JSON.stringify(base.fingerprintSource),
    );
  });

  it('change aussi pour un simple changement de seed (redondant avec, mais sans nuire à, la vérification de seed explicite)', () => {
    const a = new ProceduralGenerator({ seed: 'fp-seed-a' });
    const b = new ProceduralGenerator({ seed: 'fp-seed-b' });
    // Le générateur inclut `generation.seed` (issu de `WorldGenerationConfig`) tel
    // quel : ce test documente que la seed FAIT partie de la source, même si en
    // pratique `Simulation.restoreSnapshot` la vérifie déjà séparément et en premier
    // (message d'erreur plus clair) avant même de comparer les empreintes.
    expect(JSON.stringify(a.fingerprintSource)).not.toBe(JSON.stringify(b.fingerprintSource));
  });
});
