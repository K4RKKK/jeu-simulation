import { allocateMemoryId } from '../components/cognitiveMemory.js';
import type {
  CognitiveMemoryComponent,
  EpisodicMemoryEntry,
} from '../components/cognitiveMemory.js';
import type { CognitionConfig } from '../config/simulationConfig.js';

/**
 * Logique pure de la mémoire épisodique (CLAUDE.md règle 8 : testable sans ECS). Phase 3.3.
 *
 * Un épisode est un événement vécu (repas, gorgée, empoisonnement, réveil épuisé…),
 * daté et localisé. Contrairement à la mémoire spatiale — un index de lieux —, la
 * mémoire épisodique est une chronologie personnelle : elle sert plus tard à répondre
 * à « est-ce que ça avait mal tourné la dernière fois que j'ai mangé cette baie ? »
 * (associations concept → outcome), à alimenter des croyances (« ce lieu m'a fait du
 * bien »), ou à moduler des décisions par l'expérience.
 *
 * Les épisodes d'ingestion alimentent désormais `foodBeliefModel`; le scoreur d'utilité
 * lit ensuite cette croyance personnelle. Les autres usages (lieux, social, transmission)
 * restent volontairement ouverts plutôt que simulés prématurément.
 *
 * Éviction : le nombre d'entrées est borné par `CognitionConfig.maxEpisodicEntries` ;
 * quand la limite est franchie, `evictLeastIntense` retire l'entrée d'`emotionalStrength01`
 * la plus faible — un traumatisme rare (empoisonnement sévère) résiste ainsi à des
 * dizaines d'événements ordinaires. Pas de décroissance temporelle : le passé ne
 * s'atténue pas mécaniquement en épisodique (contrairement à la mémoire spatiale, où le
 * flou géographique croît réellement avec le temps).
 */

/** Événement candidat à mémoriser — mêmes champs que `EpisodicMemoryEntry` sans `id`. */
export type EpisodeDraft = Omit<EpisodicMemoryEntry, 'id'>;

/**
 * Enregistre un épisode. Contrairement à `rememberSpatial`, on ne fusionne PAS deux
 * épisodes similaires : deux repas séparés dans le temps sont deux épisodes distincts,
 * même s'ils partagent `eventType`, `outcome`, position et acteurs — l'un s'est produit,
 * puis l'autre. Fusionner effacerait la chronologie, qui est justement ce que ce type
 * de mémoire porte.
 */
export function rememberEpisodic(
  memory: CognitiveMemoryComponent,
  draft: EpisodeDraft,
  config: Pick<CognitionConfig, 'maxEpisodicEntries'>,
): void {
  const entry: EpisodicMemoryEntry = { id: allocateMemoryId(memory), ...draft };
  memory.episodic.push(entry);
  if (memory.episodic.length > config.maxEpisodicEntries) {
    evictLeastIntense(memory);
  }
}

/**
 * Évince l'épisode d'`emotionalStrength01` la plus basse — à égalité, le plus ancien
 * (le premier trouvé) part en premier, garantissant un renouvellement dans la fenêtre
 * des événements ordinaires (tous à intensité modérée).
 */
function evictLeastIntense(memory: CognitiveMemoryComponent): void {
  let worstIndex = 0;
  let worstStrength = Number.POSITIVE_INFINITY;
  for (let i = 0; i < memory.episodic.length; i++) {
    const strength = memory.episodic[i]!.emotionalStrength01;
    if (strength < worstStrength) {
      worstStrength = strength;
      worstIndex = i;
    }
  }
  memory.episodic.splice(worstIndex, 1);
}
