/**
 * Identifiants du modèle cognitif.
 *
 * `MemoryId`/`BeliefId` sont des compteurs LOCAUX à leur composant propriétaire
 * (`CognitiveMemoryComponent.nextMemoryId`, `CognitiveKnowledgeComponent.nextBeliefId`),
 * jamais générés par un aléa quelconque (`crypto.randomUUID()` ou équivalent) — voir
 * `allocateMemoryId`/`allocateBeliefId` dans les fichiers de composants correspondants.
 * Deux humains différents peuvent donc porter chacun un souvenir « #3 » sans collision :
 * l'identifiant n'a de sens qu'associé à son propriétaire, jamais globalement.
 *
 * `ConceptId` est différent par nature : un identifiant sémantique **stable et partagé**
 * (`"water"`, `"berry:red:round"`), pas un compteur — c'est le vocabulaire perceptif
 * commun sur lequel deux humains peuvent former des croyances différentes.
 */
export type MemoryId = number;
export type BeliefId = number;
export type ConceptId = string;
