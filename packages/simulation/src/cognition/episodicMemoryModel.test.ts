import { describe, expect, it } from 'vitest';
import { createEmptyCognitiveMemory } from '../components/cognitiveMemory.js';
import type { CognitiveMemoryComponent } from '../components/cognitiveMemory.js';
import { rememberEpisodic, type EpisodeDraft } from './episodicMemoryModel.js';

const CONFIG = { maxEpisodicEntries: 3 } as const;

function draft(overrides: Partial<EpisodeDraft> = {}): EpisodeDraft {
  return {
    tick: 0,
    eventType: 'food.eaten',
    actors: [1],
    outcome: 'physiology.satiety_increased',
    emotionalStrength01: 0.3,
    ...overrides,
  };
}

describe('rememberEpisodic', () => {
  it('alloue un id monotone et empile l’épisode', () => {
    const memory = createEmptyCognitiveMemory();
    rememberEpisodic(memory, draft({ tick: 10 }), CONFIG);
    rememberEpisodic(memory, draft({ tick: 20 }), CONFIG);
    expect(memory.episodic).toHaveLength(2);
    expect(memory.episodic[0]!.id).toBe(0);
    expect(memory.episodic[1]!.id).toBe(1);
    expect(memory.nextMemoryId).toBe(2);
  });

  it('ne fusionne jamais deux épisodes similaires — deux vécus séparés restent deux souvenirs', () => {
    const memory = createEmptyCognitiveMemory();
    const identical = draft({ eventType: 'water.drunk', outcome: 'thirst.quenched' });
    rememberEpisodic(memory, { ...identical, tick: 10 }, CONFIG);
    rememberEpisodic(memory, { ...identical, tick: 20 }, CONFIG);
    expect(memory.episodic).toHaveLength(2);
    expect(memory.episodic.map((e) => e.tick)).toEqual([10, 20]);
  });

  it('évince l’épisode le moins intense quand la capacité est dépassée', () => {
    const memory: CognitiveMemoryComponent = createEmptyCognitiveMemory();
    rememberEpisodic(memory, draft({ tick: 1, emotionalStrength01: 0.3 }), CONFIG);
    rememberEpisodic(memory, draft({ tick: 2, emotionalStrength01: 0.9 }), CONFIG); // traumatisme
    rememberEpisodic(memory, draft({ tick: 3, emotionalStrength01: 0.2 }), CONFIG);
    memory.lastProcessedExperienceId = 2;
    // 4ème ajout : tableau plein, on évince le plus faible (tick 3, strength 0.2).
    rememberEpisodic(memory, draft({ tick: 4, emotionalStrength01: 0.5 }), CONFIG);
    const ticks = memory.episodic.map((e) => e.tick).sort();
    expect(ticks).toEqual([1, 2, 4]);
    // Le traumatisme du tick 2 est TOUJOURS là malgré les événements ordinaires ultérieurs.
    expect(memory.episodic.some((e) => e.tick === 2 && e.emotionalStrength01 === 0.9)).toBe(true);
  });

  it('à intensité égale, évince l’entrée trouvée en premier (chronologiquement la plus ancienne)', () => {
    const memory = createEmptyCognitiveMemory();
    rememberEpisodic(memory, draft({ tick: 1, emotionalStrength01: 0.3 }), CONFIG);
    rememberEpisodic(memory, draft({ tick: 2, emotionalStrength01: 0.3 }), CONFIG);
    rememberEpisodic(memory, draft({ tick: 3, emotionalStrength01: 0.3 }), CONFIG);
    memory.lastProcessedExperienceId = 2;
    rememberEpisodic(memory, draft({ tick: 4, emotionalStrength01: 0.3 }), CONFIG);
    expect(memory.episodic.map((e) => e.tick)).toEqual([2, 3, 4]);
  });

  it('keeps unprocessed episodes beyond capacity until learning consolidates them', () => {
    const memory = createEmptyCognitiveMemory();
    rememberEpisodic(memory, draft({ tick: 1 }), CONFIG);
    rememberEpisodic(memory, draft({ tick: 2 }), CONFIG);
    rememberEpisodic(memory, draft({ tick: 3 }), CONFIG);
    rememberEpisodic(memory, draft({ tick: 4 }), CONFIG);

    expect(memory.lastProcessedExperienceId).toBeNull();
    expect(memory.episodic.map((entry) => entry.id)).toEqual([0, 1, 2, 3]);
  });

  it('conserve les champs optionnels (position, concept) quand ils sont fournis', () => {
    const memory = createEmptyCognitiveMemory();
    rememberEpisodic(
      memory,
      draft({
        x: 12.5,
        z: -7,
        subjectConcept: 'berry:red' as never,
      }),
      CONFIG,
    );
    expect(memory.episodic[0]).toMatchObject({ x: 12.5, z: -7, subjectConcept: 'berry:red' });
  });
});
