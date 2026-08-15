/**
 * Budgets de performance — seuils au-delà desquels le moteur est considéré en
 * dérive, pas des objectifs esthétiques.
 *
 * Les valeurs par défaut ne sont pas inventées : elles viennent des scripts
 * `stress:*` exécutés sur le développement de cette phase (voir `packages/simulation/
 * src/stress/`). En particulier :
 * - `pathfindingMsPerRequestP95` couvre une requête incrémentale de bout en bout. La
 *   frontière A* survit désormais entre les ticks ; le budget reste généreux car il
 *   inclut l'attente FIFO et les terrains complexes.
 * - `chunkGenerationMsP95` reflète le coût mesuré de `ChunkGenerator.generate` sur un
 *   monde de taille par défaut.
 *
 * Un dépassement n'interrompt jamais la simulation : c'est un signal de suivi, à
 * vérifier après chaque changement touchant la génération procédurale ou le
 * pathfinding — jamais un couperet automatique.
 */
export interface PerformanceBudgets {
  /** Durée de tick moyenne visée, en ms — doit rester très inférieure à la période du tick. */
  simulationTickMsAvg: number;
  /** Pire cas toléré pour un tick isolé (p99), en ms. */
  simulationTickMsP99: number;
  /** Génération d'un chunk, p95, en ms. */
  chunkGenerationMsP95: number;
  /** Une requête de chemin de bout en bout (mise en file comprise), p95, en ms. */
  pathfindingMsPerRequestP95: number;
  /** Octets réseau envoyés par seconde et par client observateur, valeur cible. */
  networkBytesPerSecondPerClient: number;
}

export const DEFAULT_PERFORMANCE_BUDGETS: PerformanceBudgets = {
  simulationTickMsAvg: 5,
  simulationTickMsP99: 25,
  chunkGenerationMsP95: 120,
  pathfindingMsPerRequestP95: 80,
  networkBytesPerSecondPerClient: 200_000,
};

export interface PerformanceBudgetViolation {
  readonly metric: keyof PerformanceBudgets;
  readonly budget: number;
  readonly measured: number;
}

/**
 * Compare des mesures réelles aux budgets. Ne prend que les métriques présentes dans
 * `measurements` : un appelant qui n'a mesuré qu'une partie des budgets (ex. seulement
 * le pathfinding) n'est pas pénalisé pour le reste.
 */
export function checkPerformanceBudgets(
  measurements: Partial<PerformanceBudgets>,
  budgets: PerformanceBudgets = DEFAULT_PERFORMANCE_BUDGETS,
): PerformanceBudgetViolation[] {
  const violations: PerformanceBudgetViolation[] = [];
  for (const key of Object.keys(measurements) as (keyof PerformanceBudgets)[]) {
    const measured = measurements[key];
    if (measured === undefined) continue;
    const budget = budgets[key];
    if (measured > budget) {
      violations.push({ metric: key, budget, measured });
    }
  }
  return violations;
}
