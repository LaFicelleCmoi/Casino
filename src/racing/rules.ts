import { EngineError, chips, err, isChips, ok, type Chips, type Result } from '../core/index.js';

export interface RacingRules {
  /** Nombre de partants : 5 minimum pour proposer le Quinté. */
  readonly runners: number;
  readonly minStake: Chips;
  readonly maxStake: Chips;
  readonly maxBetsPerRace: number;
  /** Prélèvement de la maison sur les paris simples (0,15 = 15 %). */
  readonly simpleMargin: number;
  /** Prélèvement sur le Tiercé et le Quinté. */
  readonly comboMargin: number;
}

export const STANDARD_RACING_RULES: RacingRules = Object.freeze({
  runners: 8,
  minStake: chips(1),
  maxStake: chips(1_000_000),
  maxBetsPerRace: 40,
  simpleMargin: 0.15,
  comboMargin: 0.25,
});

const between = (value: number, min: number, max: number): boolean => value >= min && value <= max;

export function validateRacingRules(rules: RacingRules): Result<RacingRules> {
  const problems: string[] = [];
  if (!Number.isInteger(rules.runners) || !between(rules.runners, 5, 12)) problems.push('runners doit être compris entre 5 et 12');
  if (!isChips(rules.minStake) || rules.minStake === 0) problems.push('minStake doit être un entier strictement positif');
  if (!isChips(rules.maxStake) || rules.maxStake < rules.minStake || rules.maxStake > 1_000_000) {
    problems.push('maxStake doit être compris entre minStake et 1 000 000');
  }
  if (!Number.isInteger(rules.maxBetsPerRace) || !between(rules.maxBetsPerRace, 1, 200)) problems.push('maxBetsPerRace doit être compris entre 1 et 200');
  if (!between(rules.simpleMargin, 0, 0.5) || !between(rules.comboMargin, 0, 0.5)) problems.push('les marges doivent être comprises entre 0 et 0,5');
  return problems.length === 0
    ? ok(rules)
    : err(new EngineError('INVALID_RULES', `Règles de courses invalides : ${problems.join(' ; ')}`, { problems }));
}
