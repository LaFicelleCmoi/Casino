import { EngineError, chips, err, isChips, ok, type Chips, type Result } from '../core/index.js';

export interface PachinkoRules {
  readonly minStake: Chips;
  readonly maxStake: Chips;
  readonly historySize: number;
}

export const STANDARD_PACHINKO_RULES: PachinkoRules = Object.freeze({
  minStake: chips(1),
  maxStake: chips(1_000_000),
  historySize: 30,
});

export function validatePachinkoRules(rules: PachinkoRules): Result<PachinkoRules> {
  const problems: string[] = [];
  if (!isChips(rules.minStake) || rules.minStake === 0) problems.push('minStake doit être un entier strictement positif');
  if (!isChips(rules.maxStake) || rules.maxStake < rules.minStake || rules.maxStake > 1_000_000) problems.push('maxStake doit être compris entre minStake et 1 000 000');
  if (!Number.isInteger(rules.historySize) || rules.historySize < 0 || rules.historySize > 500) problems.push('historySize doit être compris entre 0 et 500');
  return problems.length === 0 ? ok(rules) : err(new EngineError('INVALID_RULES', `Règles Pachinko invalides : ${problems.join(' ; ')}`, { problems }));
}
