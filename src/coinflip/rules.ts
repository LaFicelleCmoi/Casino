import { EngineError, chips, err, isChips, isValidRatio, ok, type Chips, type Ratio, type Result } from '../core/index.js';

export const COIN_SIDES = ['PILE', 'FACE'] as const;
export type CoinSide = (typeof COIN_SIDES)[number];

/** Nombre de lancers retenus dans l'historique de la session. */
export const COINFLIP_HISTORY_SIZE = 100;

export interface CoinflipRules {
  readonly minStake: Chips;
  readonly maxStake: Chips;
  /** Gain d'un bon pronostic, mise comprise : 198:100 = ×1,98, soit 1 % pour la maison. */
  readonly payout: Ratio;
  /** Quitte ou double : nombre maximal de lancers enchaînés en remettant tout le gain en jeu. */
  readonly maxChain: number;
}

export const STANDARD_COINFLIP_RULES: CoinflipRules = Object.freeze({
  minStake: chips(1),
  maxStake: chips(1_000_000),
  payout: Object.freeze({ numerator: 198, denominator: 100 }),
  maxChain: 10,
});

export const otherSide = (side: CoinSide): CoinSide => (side === 'PILE' ? 'FACE' : 'PILE');
export const isCoinSide = (value: unknown): value is CoinSide => value === 'PILE' || value === 'FACE';

/** Avantage de la maison en fraction : 1 − 0,5 × multiplicateur. */
export const coinflipHouseEdge = (rules: CoinflipRules): number => 1 - (0.5 * rules.payout.numerator) / rules.payout.denominator;

export function validateCoinflipRules(rules: CoinflipRules): Result<CoinflipRules> {
  const problems: string[] = [];
  if (!isChips(rules.minStake) || rules.minStake === 0) problems.push('minStake doit être un entier strictement positif');
  if (!isChips(rules.maxStake) || rules.maxStake < rules.minStake || rules.maxStake > 1_000_000) {
    problems.push('maxStake doit être compris entre minStake et 1 000 000');
  }
  const multiple = rules.payout.numerator / rules.payout.denominator;
  if (!isValidRatio(rules.payout) || multiple <= 1 || multiple > 2) problems.push('payout doit valoir plus de ×1 et au plus ×2');
  if (!Number.isInteger(rules.maxChain) || rules.maxChain < 1 || rules.maxChain > 20) problems.push('maxChain doit être compris entre 1 et 20');
  return problems.length === 0
    ? ok(rules)
    : err(new EngineError('INVALID_RULES', `Règles Pile ou Face invalides : ${problems.join(' ; ')}`, { problems }));
}
