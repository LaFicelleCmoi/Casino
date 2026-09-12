import { EngineError, chips, err, isChips, ok, type Chips, type Result } from '../core/index.js';

export interface HiloRules {
  readonly minStake: Chips;
  readonly maxStake: Chips;
  /** Marge de la maison appliquée à chaque cote (0,01 = 1 %). */
  readonly houseEdge: number;
  /** Jokers par partie : chacun fait passer la carte sans risque. */
  readonly jokersPerRound: number;
  /** Multiplicateur de série maximal, en centièmes : atteint, la partie s'encaisse d'office. */
  readonly maxMultiplier: number;
}

export const STANDARD_HILO_RULES: HiloRules = Object.freeze({
  minStake: chips(1),
  maxStake: chips(1_000_000),
  houseEdge: 0.01,
  jokersPerRound: 3,
  maxMultiplier: 10_000_000,
});

export function validateHiloRules(rules: HiloRules): Result<HiloRules> {
  const problems: string[] = [];
  if (!isChips(rules.minStake) || rules.minStake === 0) problems.push('minStake doit être un entier strictement positif');
  if (!isChips(rules.maxStake) || rules.maxStake < rules.minStake || rules.maxStake > 1_000_000) {
    problems.push('maxStake doit être compris entre minStake et 1 000 000');
  }
  if (!(rules.houseEdge >= 0 && rules.houseEdge <= 0.2)) problems.push('houseEdge doit être compris entre 0 et 0,2');
  if (!Number.isInteger(rules.jokersPerRound) || rules.jokersPerRound < 0 || rules.jokersPerRound > 10) problems.push('jokersPerRound doit être compris entre 0 et 10');
  if (!Number.isInteger(rules.maxMultiplier) || rules.maxMultiplier < 200 || rules.maxMultiplier > 10_000_000) problems.push('maxMultiplier doit être compris entre 200 et 10 000 000');
  return problems.length === 0 ? ok(rules) : err(new EngineError('INVALID_RULES', `Règles Hi-Lo invalides : ${problems.join(' ; ')}`, { problems }));
}
