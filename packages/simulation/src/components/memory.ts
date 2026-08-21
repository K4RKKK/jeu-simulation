import { defineComponent } from '../core/componentType.js';

/**
 * État interne du `PerceptionSystem` — depuis Phase 3.5, plus un cache de souvenirs.
 *
 * Les souvenirs eux-mêmes (rives, ressources) vivent maintenant dans `CognitiveMemory`
 * (mémoire spatiale générique avec confiance et précision), lue par
 * `NeedSatisfactionSystem` et les futurs décideurs. Ce composant ne conserve que ce dont
 * la perception a besoin pour ELLE-MÊME : les positions du dernier scan, qui servent à
 * éviter de rescanner tant que l'individu ne s'est pas assez déplacé (voir
 * `PerceptionConfig.foodRescanMoveThresholdM` / `waterRescanMoveThresholdM`).
 */
export interface MemoryComponent {
  /** Dernière position depuis laquelle la nourriture a été scrutée. */
  lastFoodScanX: number | null;
  lastFoodScanZ: number | null;
  /** Dernière position depuis laquelle l'eau a été scrutée. */
  lastWaterScanX: number | null;
  lastWaterScanZ: number | null;
}

export const Memory = defineComponent<MemoryComponent>('Memory');
