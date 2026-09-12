import { EngineError, chips, err, isChips, ok, type Chips, type Result } from '../core/index.js';

export interface PlinkoRules {
  readonly minStake: Chips;
  /** Plafonné pour que mise × 1000 reste un entier exact. */
  readonly maxStake: Chips;
  readonly historySize: number;
}

export const STANDARD_PLINKO_RULES: PlinkoRules = Object.freeze({
  minStake: chips(1),
  maxStake: chips(1_000_000_000),
  historySize: 20,
});

export function validatePlinkoRules(rules: PlinkoRules): Result<PlinkoRules> {
  const problems: string[] = [];
  if (!isChips(rules.minStake) || rules.minStake === 0) problems.push('minStake doit être un entier strictement positif');
  if (!isChips(rules.maxStake) || rules.maxStake < rules.minStake || rules.maxStake > 1_000_000_000) {
    problems.push('maxStake doit être compris entre minStake et 1 000 000 000');
  }
  if (!Number.isInteger(rules.historySize) || rules.historySize < 0 || rules.historySize > 500) problems.push('historySize doit être compris entre 0 et 500');
  return problems.length === 0 ? ok(rules) : err(new EngineError('INVALID_RULES', `Règles Plinko invalides : ${problems.join(' ; ')}`, { problems }));
}
