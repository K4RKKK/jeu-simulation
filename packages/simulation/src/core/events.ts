import type { EntityId } from '@civ/shared';

/**
 * Vocabulaire d'événements du moteur.
 *
 * Ne figurent ici que les événements réellement émis aujourd'hui. Le bus est générique :
 * ajouter `KnowledgeLearned`, `DiseaseContracted`, `WordCreated`, `FireStarted`… consistera
 * à étendre cette interface quand les systèmes correspondants existeront. Déclarer des
 * événements que personne n'émet donnerait une fausse impression de complétude.
 *
 * Tous les payloads portent le `tick` d'émission : c'est ce qui rendra possible plus tard
 * l'historique, les statistiques et le replay sans réécrire les systèmes.
 */
export interface SimulationEventMap {
  SimulationStarted: { tick: number; worldId: string; seed: string };
  SimulationPaused: { tick: number };
  SimulationResumed: { tick: number };

  HumanBorn: { tick: number; entity: EntityId; name: string; ageYears: number };
  HumanDied: { tick: number; entity: EntityId; name: string; cause: string };

  EntityDestroyed: { tick: number; entity: EntityId };

  /** Un chunk vient d'être calculé pour la première fois. */
  ChunkGenerated: { tick: number; key: string; generationMs: number; resourceCount: number };
  /** Un chunk entre dans l'ensemble actif — il peut venir du cache. */
  ChunkLoaded: { tick: number; key: string };
  ChunkUnloaded: { tick: number; key: string };
  /** Émis à la création du monde, une fois par étendue d'eau. */
  WaterBodyCreated: {
    tick: number;
    id: string;
    kind: string;
    areaM2: number;
    meanDepthM: number;
  };

  /** Une action a démarré. `reason` explique le choix (CLAUDE.md règle 12). */
  ActionStarted: { tick: number; entity: EntityId; action: string; reason: string };
  ActionCompleted: { tick: number; entity: EntityId; action: string };
  ActionFailed: { tick: number; entity: EntityId; action: string; cause: string };
}

export type SimulationEventName = keyof SimulationEventMap;

export type SimulationEvent = {
  [K in SimulationEventName]: { name: K; payload: SimulationEventMap[K] };
}[SimulationEventName];
