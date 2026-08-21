import { defineComponent } from '../core/componentType.js';

/* ---------------------------------------------------------------- */

/**
 * Besoins vitaux, chacun dans [0, 1].
 *
 * 1 = plein (hydraté, repu, frais), 0 = vide. Le `MetabolismSystem` les fait évoluer
 * selon l'activité et l'environnement ; le `NeedSatisfactionSystem` les lit pour décider.
 * `metabolismRate` est la variation individuelle du rythme de consommation : un corps qui
 * perd son eau plus vite la reprend aussi plus vite.
 */
export interface NeedsComponent {
  hydration: number;
  hunger: number;
  energy: number;
  metabolismRate: number;
}

export const Needs = defineComponent<NeedsComponent>('Needs');

/* ---------------------------------------------------------------- */

/**
 * Plan courant du `NeedSatisfactionSystem`, posé pour que le wander temporaire n'interfère
 * pas avec une action vitale en cours.
 *
 * - `seekWater` / `seekFood` : en déplacement vers la cible ; l'action commence à l'arrivée.
 * - `drink` / `eat` / `rest` : action en cours, jusqu'à `untilTick` ou satisfaction du but.
 * - `none` : aucun plan ; l'individu est libre d'errer.
 */
export interface NeedsStateComponent {
  action: 'none' | 'seekWater' | 'seekFood' | 'drink' | 'eat' | 'rest';
  targetX: number | null;
  targetZ: number | null;
  /** Ressource visée par `seekFood`/`eat` — sert à la retirer quand elle est consommée. */
  resourceId: string | null;
  /**
   * Chunk propriétaire de la ressource (recopié depuis la mémoire au moment du plan).
   * Sans ce champ, retrouver la ressource depuis sa seule position risquait d'interroger
   * un chunk voisin lorsque le jitter avait décalé la ressource au-delà de sa frontière.
   */
  resourceOwnerChunkKey: string | null;
  /** Adresse locale de la ressource dans son chunk propriétaire (recopiée depuis la mémoire). */
  resourceLocalId: number | null;
  resourceConceptId: string | null;
  untilTick: number;
  /**
   * Gain de faim restant que ce repas peut encore fournir, dans [0, 1] — dérivé de
   * `foodKcal / kcalPerFullMeal` de la ressource au moment de commencer à manger, puis
   * décrémenté par le `MetabolismSystem` à mesure qu'il est consommé.
   *
   * Bug corrigé : sans ce champ, une petite baie (40 kcal) et un gros aliment
   * (600 kcal) rassasiaient quasiment pareil — seule la durée `eatRatePerSecond`
   * comptait, jamais la valeur nutritionnelle réelle transmise par la ressource.
   */
  mealMaxGain: number;
  /** Symptômes d'une ingestion toxique : drainé par le métabolisme jusqu'à ce tick. */
  poisoningUntilTick: number;
  /** Intensité des symptômes en cours (toxicité de ce qui a été ingéré). */
  poisoningToxicity01: number;
  currentMealCausedPoisoning: boolean;
  /**
   * Posé par le `PathfindingSystem` quand le chemin vers la cible vitale n'existe pas :
   * jusqu'à ce tick, le planificateur ne retente pas la même impossibilité.
   */
  pathFailedAtTick: number;
}

export const NeedsState = defineComponent<NeedsStateComponent>('NeedsState');
