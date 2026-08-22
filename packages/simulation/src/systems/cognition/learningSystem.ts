import { CognitiveKnowledge, CognitiveMemory, HumanSkills } from '../../components/index.js';
import {
  firstUnprocessedExperienceIndex,
  pruneEpisodic,
} from '../../cognition/episodicMemoryModel.js';
import { applyFoodIngestionEvidence } from '../../cognition/foodBeliefModel.js';
import { applyObservedFoodIngestionEvidence } from '../../cognition/socialFoodBeliefModel.js';
import { consolidateSkillPractice } from '../../cognition/skillModel.js';
import type { SystemFrequency } from '../../config/simulationConfig.js';
import type { SimulationSystem, SystemUpdateContext } from '../../core/system.js';

/**
 * Consolide une seule fois les expériences personnelles en croyances individuelles,
 * ainsi que les observations sociales directes en croyances sociales séparées
 * (Phase 3.8). UN SEUL watermark `lastProcessedExperienceId` couvre tous les kinds :
 * social et self-experience partagent la même chronologie ordonnée, ce qui garantit
 * qu'un rechargement ne re-consolide jamais un épisode déjà traité.
 *
 * Interdits stricts (verrouillés par tests dans la Phase 3.8) :
 * - Une expérience `social.actionObserved` ne touche JAMAIS `food.nourishing` ni
 *   `food.illnessRisk` (croyances de vérité — réservées à `selfExperience`).
 * - Une expérience `social.actionObserved` observant un `resource.gathering` ne
 *   modifie JAMAIS `HumanSkills` : voir un expert récolter ne donne pas la maîtrise.
 */
export class LearningSystem implements SimulationSystem {
  readonly name = 'LearningSystem';
  readonly frequency: SystemFrequency = 'medium';

  update(ctx: SystemUpdateContext): void {
    ctx.entities.each(
      [CognitiveMemory, CognitiveKnowledge, HumanSkills],
      (_entity, memory, knowledge, skills) => {
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
          } else if (experience?.kind === 'resource.gathering' && experience.completed) {
            consolidateSkillPractice(
              skills,
              'resource.gathering',
              1,
              ctx.config.skills.resourceGathering.practiceLearningRate,
              experience.outcomeTick,
            );
          } else if (experience?.kind === 'social.actionObserved') {
            // Observer un gather ne donne AUCUN skill : la Phase 3.8 interdit
            // formellement l'imitation de la maîtrise procédurale. Seule
            // l'observation d'une ingestion produit une croyance sociale, et
            // uniquement sur la propriété `food.observedIngestion`, jamais sur
            // `food.nourishing` ni `food.illnessRisk`.
            if (
              experience.observedAction === 'food.ingestion' &&
              experience.subjectConceptId !== null
            ) {
              applyObservedFoodIngestionEvidence(
                knowledge,
                experience.subjectConceptId,
                experience.observationTick,
                ctx.config.cognition.socialObservation.directObservationEvidenceGain,
              );
            }
          }
          memory.lastProcessedExperienceId = episode.id;
        }
        pruneEpisodic(memory, ctx.config.cognition);
      },
    );
  }
}
