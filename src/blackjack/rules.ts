import {
  EngineError,
  chips,
  err,
  isChips,
  isValidRatio,
  ok,
  validateShoeConfig,
  type Chips,
  type Ratio,
  type Result,
} from '../core/index.js';

export type DoubleRestriction = 'ANY_TWO' | 'NINE_TO_ELEVEN' | 'TEN_OR_ELEVEN';

/** SAME_VALUE autorise le split de J + K ; SAME_RANK exige deux cartes de même rang. */
export type SplitMatching = 'SAME_RANK' | 'SAME_VALUE';

export type SurrenderRule = 'NONE' | 'LATE';

export interface BlackjackRules {
  readonly deckCount: number;
  /** Part du sabot distribuée avant la carte de coupe (0 < p ≤ 1). */
  readonly penetration: number;
  /** Places de la table (1 à 8) : chaque joueur en occupe une, et une de plus par main supplémentaire qu'il joue. */
  readonly seatCount: number;
  readonly minBet: Chips;
  readonly maxBet: Chips;

  /** false = S17 (le croupier reste sur soft 17), true = H17. */
  readonly dealerHitsSoft17: boolean;
  /** Le croupier vérifie le Blackjack avec un As ou une figure/10 visible (règle américaine). */
  readonly dealerPeeks: boolean;
  readonly blackjackPayout: Ratio;
  /** Assurance proposée si le croupier montre un As. Mise = ⌊mise/2⌋, payée 2:1. */
  readonly insurance: boolean;

  readonly doubleRestriction: DoubleRestriction;
  readonly doubleAfterSplit: boolean;
  readonly splitMatching: SplitMatching;
  readonly maxHandsPerSeat: number;
  readonly resplitAces: boolean;
  /** false = une seule carte par As splitté, main terminée d'office. */
  readonly hitSplitAces: boolean;
  readonly surrender: SurrenderRule;
}

/**
 * Règles standard validées. Paiement 3:2 arrondi à l'unité inférieure sur les mises impaires.
 * Un 21 en 2 cartes après split n'est jamais un Blackjack (paie 1:1).
 */
export const STANDARD_BLACKJACK_RULES: BlackjackRules = Object.freeze({
  deckCount: 6,
  penetration: 0.75,
  seatCount: 7,
  minBet: chips(10),
  maxBet: chips(1_000),

  dealerHitsSoft17: false,
  dealerPeeks: true,
  blackjackPayout: Object.freeze({ numerator: 3, denominator: 2 }),
  insurance: true,

  doubleRestriction: 'ANY_TWO',
  doubleAfterSplit: true,
  splitMatching: 'SAME_VALUE',
  maxHandsPerSeat: 4,
  resplitAces: false,
  hitSplitAces: false,
  surrender: 'NONE',
});

function isIntegerBetween(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** À appeler à la création de la table : des règles provenant d'un fichier ou d'une API ne sont jamais crues sur parole. */
export function validateBlackjackRules(rules: BlackjackRules): Result<BlackjackRules> {
  const problems: string[] = [];

  const shoe = validateShoeConfig({ deckCount: rules.deckCount, penetration: rules.penetration });
  if (!shoe.ok) problems.push(shoe.error.message);
  if (!isIntegerBetween(rules.seatCount, 1, 8)) problems.push('seatCount doit être compris entre 1 et 8');
  if (!isChips(rules.minBet) || rules.minBet === 0) problems.push('minBet doit être un entier strictement positif');
  if (!isChips(rules.maxBet) || rules.maxBet < rules.minBet) problems.push('maxBet doit être un entier ≥ minBet');
  if (!isValidRatio(rules.blackjackPayout)) problems.push('blackjackPayout doit être un rapport d’entiers positifs');
  if (!isIntegerBetween(rules.maxHandsPerSeat, 1, 8)) problems.push('maxHandsPerSeat doit être compris entre 1 et 8');

  return problems.length === 0
    ? ok(rules)
    : err(new EngineError('INVALID_RULES', problems.join(' ; '), { problems }));
}
