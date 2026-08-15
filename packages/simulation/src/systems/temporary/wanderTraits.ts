import type { WanderConfig } from '../../config/simulationConfig.js';
import { lerp } from '../../core/math.js';

/**
 * Dérivation de paramètres de décision à partir des traits de personnalité.
 *
 * Ces fonctions pures sont séparées du système pour être testées directement : la
 * personnalité doit toujours produire une valeur **continue et bornée** dans la plage
 * déclarée par la configuration, jamais un tirage aléatoire.
 */

/** Pente maximale tolérée par un individu, interpolée entre audace et prudence. */
export function maxSlopeForCaution(
  caution: number,
  config: Pick<WanderConfig, 'audaciousMaxSlope01' | 'cautiousMaxSlope01'>,
): number {
  return lerp(config.cautiousMaxSlope01, config.audaciousMaxSlope01, 1 - caution);
}

/** Nombre d'essais de destination avant renoncement, modulé par la persévérance. */
export function attemptCountForPerseverance(
  perseverance: number,
  config: Pick<WanderConfig, 'maxTargetAttempts' | 'attemptScaleMin' | 'attemptScaleMax'>,
): number {
  const scaled =
    config.maxTargetAttempts *
    lerp(config.attemptScaleMin, config.attemptScaleMax, perseverance);
  return Math.max(1, Math.round(scaled));
}