import type { DecisionFactor, DecisionReason } from '../components/humanCognition.js';
import type { NeedsComponent, PersonalityComponent } from '../components/index.js';

/**
 * Scoreur d'utilité (CLAUDE.md règle 8 : logique pure, testable sans ECS). Phase 3.4.
 *
 * Remplace la cascade `if energy < X then rest, else if hydration < Y then drink…` du
 * `NeedSatisfactionSystem` par un score par option. L'option au score le plus haut gagne,
 * et sa décomposition (`DecisionFactor[]`) est écrite dans `HumanCognition.decisionReason`
 * pour l'inspection (CLAUDE.md règle 12 : « toute décision doit être explicable »).
 *
 * **Courbe de réponse** : pour un besoin borné [0, 1] où 1 = satisfait et 0 = critique,
 * on mesure `x = niveau / seuilCritique`, puis `urgency(x) = 1 / max(x, epsilon)² - 1`.
 * Au-dessus du seuil, la pression retombe à 0 ; en dessous, elle explose naturellement.
 * Elle produit la « priorité physiologique » ancienne SANS `if` catégorique : un besoin
 * en confort ne pèse rien, un besoin critique domine tout, et l'ordre relatif entre
 * besoins critiques est modulé par les coefficients ci-dessous.
 *
 * Les coefficients sont réglés pour reproduire l'ordre de priorité de la Phase 3.5
 * (énergie > hydration > faim) : `WEIGHT_REST > WEIGHT_DRINK > WEIGHT_EAT`.
 * `WEIGHT_EXPLORE` reste bas, ce qui donne la baseline (« ne rien faire de vital »).
 */

const EPSILON = 0.05; // évite la division par zéro ; en pratique le besoin est purgé bien avant.
const WEIGHT_REST = 4.5;
const WEIGHT_DRINK = 1.4;
const WEIGHT_EAT = 0.8;
const WEIGHT_EXPLORE_BASE = 0.5;
/**
 * Pénalité multiplicative quand la mémoire est vide pour cette ressource. Le besoin
 * subsiste mais la « bonne option » devient l'exploration : sans souvenir, chercher.
 * Pas zéro : à besoin ultra-critique, l'individu tente quand même (le wander finira
 * peut-être par trouver — meilleur qu'une garantie d'échec).
 */
const NO_MEMORY_PENALTY = 0.15;

export type OptionKind = 'drink' | 'eat' | 'rest' | 'explore';

export interface DecisionOption {
  readonly kind: OptionKind;
  readonly score: number;
  readonly factors: DecisionFactor[];
}

function urgency(value01: number, criticalThreshold: number): number {
  const x = Math.max(value01 / criticalThreshold, EPSILON);
  return Math.max(0, 1 / (x * x) - 1);
}

/**
 * Score de « boire ». Le besoin (soif) et la disponibilité mémoire (rive connue) se
 * multiplient : sans souvenir, la marche vers l'inconnu est moins bonne qu'une
 * exploration ciblée — mais reste positive si la soif est critique.
 */
export function scoreDrink(
  needs: NeedsComponent,
  hasKnownWater: boolean,
  criticalThreshold: number,
): DecisionOption {
  const need = urgency(needs.hydration, criticalThreshold);
  const memory = hasKnownWater ? 1 : NO_MEMORY_PENALTY;
  const score = WEIGHT_DRINK * need * memory;
  return {
    kind: 'drink',
    score,
    factors: [
      { code: 'need.hydration.level', value: needs.hydration },
      { code: 'need.hydration.threshold', value: criticalThreshold },
      { code: 'memory.water.known', value: hasKnownWater ? 1 : 0 },
    ],
  };
}

/**
 * Score de « manger ». Comme `scoreDrink`, avec une pénalité additionnelle si les
 * épisodes récents comptent un empoisonnement (Phase 3.3) — la « leçon » est temporaire
 * et sémantique, pas encore une croyance persistante (viendra en 3.7).
 */
export function scoreEat(
  needs: NeedsComponent,
  hasKnownFood: boolean,
  recentPoisonings: number,
  criticalThreshold: number,
): DecisionOption {
  const need = urgency(needs.hunger, criticalThreshold);
  const memory = hasKnownFood ? 1 : NO_MEMORY_PENALTY;
  // Chaque empoisonnement récent divise le score par 2 (plafonné pour éviter l'inaction).
  const poisonPenalty = Math.max(0.1, 1 / (1 + recentPoisonings));
  const score = WEIGHT_EAT * need * memory * poisonPenalty;
  return {
    kind: 'eat',
    score,
    factors: [
      { code: 'need.hunger.level', value: needs.hunger },
      { code: 'need.hunger.threshold', value: criticalThreshold },
      { code: 'memory.food.known', value: hasKnownFood ? 1 : 0 },
      { code: 'memory.poisoning.recent_count', value: recentPoisonings },
    ],
  };
}

/**
 * Score de « se reposer ». Indépendant de la mémoire : on se repose sur place.
 * Coefficient légèrement supérieur à `drink` pour préserver la priorité de la Phase 3.5
 * (un corps épuisé ne peut plus se déplacer).
 */
export function scoreRest(needs: NeedsComponent, exhaustedThreshold: number): DecisionOption {
  const need = urgency(needs.energy, exhaustedThreshold);
  const score = WEIGHT_REST * need;
  return {
    kind: 'rest',
    score,
    factors: [
      { code: 'need.energy.level', value: needs.energy },
      { code: 'need.energy.threshold', value: exhaustedThreshold },
    ],
  };
}

/**
 * Score d'« explorer ». Baseline modulée par la personnalité : un curieux explore plus
 * volontiers qu'un prudent. Ne dépend pas des besoins directement — c'est l'option de
 * confort, celle qui gagne quand aucun besoin ne presse.
 */
export function scoreExplore(personality: PersonalityComponent): DecisionOption {
  // La courbe est simplement linéaire ici : la personnalité pèse peu comparée au 25 que
  // peut atteindre `rest` en situation critique — c'est voulu, une personnalité curieuse
  // ne doit pas ignorer sa soif.
  const score = WEIGHT_EXPLORE_BASE * (0.5 + personality.curiosity);
  return {
    kind: 'explore',
    score,
    factors: [{ code: 'personality.curiosity', value: personality.curiosity }],
  };
}

/**
 * Compare les options et retourne la gagnante. À score égal, la première l'emporte —
 * l'ordre d'insertion des options par l'appelant vaut donc départage déterministe.
 * Écrit aussi un `DecisionReason` prêt à poser sur `HumanCognition.decisionReason` :
 * `code = decision.<kind>`, `factors` du gagnant + le score total.
 */
export function pickBestOption(options: readonly DecisionOption[]): {
  winner: DecisionOption;
  reason: DecisionReason;
} {
  if (options.length === 0) {
    throw new Error('pickBestOption: aucune option à comparer');
  }
  let winner = options[0]!;
  for (let i = 1; i < options.length; i++) {
    if (options[i]!.score > winner.score) winner = options[i]!;
  }
  return {
    winner,
    reason: {
      code: `decision.${winner.kind}`,
      factors: [{ code: 'decision.score', value: winner.score }, ...winner.factors],
    },
  };
}
