import { CognitiveKnowledge, CognitiveMemory } from '../../components/index.js';
import { firstUnprocessedExperienceIndex } from '../../cognition/episodicMemoryModel.js';
import { applyFoodIngestionEvidence } from '../../cognition/foodBeliefModel.js';
import type { SystemFrequency } from '../../config/simulationConfig.js';
import type { SimulationSystem, SystemUpdateContext } from '../../core/system.js';

/** Consolide une seule fois les expériences personnelles en croyances individuelles. */
export class LearningSystem implements SimulationSystem {
  readonly name = 'LearningSystem';
  readonly frequency: SystemFrequency = 'medium';

  update(ctx: SystemUpdateContext): void {
    ctx.entities.each([CognitiveMemory, CognitiveKnowledge], (_entity, memory, knowledge) => {
      const start = firstUnprocessedExperienceIndex(
        memory.episodic,
        memory.lastProcessedExperienceId,
      );
      for (let index = start; index < memory.episodic.length; index++) {
        const episode = memory.episodic[index]!;
        const experience = episode.experience;
        if (experience?.kind === 'food.ingestion') {
          const gain = Math.max(0, experience.hungerAfter01 - experience.hungerBefore01);
          applyFoodIngestionEvidence(
            knowledge,
            experience.subjectConceptId,
            gain >= ctx.config.cognition.nourishingHungerGainThreshold01,
            experience.illnessObserved,
            experience.outcomeTick,
          );
        }
        memory.lastProcessedExperienceId = episode.id;
      }
    });
  }
}
