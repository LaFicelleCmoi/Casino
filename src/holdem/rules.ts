import { EngineError, chips, err, isChips, ok, type Chips, type Result } from '../core/index.js';

export interface HoldemRules {
  readonly bettingStructure: 'NO_LIMIT';
  /** 2 à 10 sièges. */
  readonly seatCount: number;
  readonly minPlayersToStart: number;
  readonly smallBlind: Chips;
  readonly bigBlind: Chips;
  readonly ante: Chips;
  readonly minBuyIn: Chips;
  readonly maxBuyIn: Chips;
}

/**
 * No-Limit Hold'em, blindes fixes 5/10, sans ante.
 * Heads-up : le bouton poste la small blind et parle en premier préflop, en dernier ensuite.
 * Jeton indivisible d'un pot partagé : au premier gagnant à gauche du bouton.
 */
export const STANDARD_HOLDEM_RULES: HoldemRules = Object.freeze({
  bettingStructure: 'NO_LIMIT',
  seatCount: 9,
  minPlayersToStart: 2,
  smallBlind: chips(5),
  bigBlind: chips(10),
  ante: chips(0),
  minBuyIn: chips(200),
  maxBuyIn: chips(1_000),
});

function isIntegerBetween(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function validateHoldemRules(rules: HoldemRules): Result<HoldemRules> {
  const problems: string[] = [];

  if (!isIntegerBetween(rules.seatCount, 2, 10)) problems.push('seatCount doit être compris entre 2 et 10');
  if (!isIntegerBetween(rules.minPlayersToStart, 2, rules.seatCount)) {
    problems.push('minPlayersToStart doit être compris entre 2 et seatCount');
  }
  if (!isChips(rules.smallBlind) || rules.smallBlind === 0) problems.push('smallBlind doit être strictement positive');
  if (!isChips(rules.bigBlind) || rules.bigBlind < rules.smallBlind) problems.push('bigBlind doit être ≥ smallBlind');
  if (!isChips(rules.ante)) problems.push('ante doit être un entier ≥ 0');
  if (!isChips(rules.minBuyIn) || rules.minBuyIn < rules.bigBlind) problems.push('minBuyIn doit être ≥ bigBlind');
  if (!isChips(rules.maxBuyIn) || rules.maxBuyIn < rules.minBuyIn) problems.push('maxBuyIn doit être ≥ minBuyIn');

  return problems.length === 0
    ? ok(rules)
    : err(new EngineError('INVALID_RULES', problems.join(' ; '), { problems }));
}
