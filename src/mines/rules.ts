import { EngineError, chips, err, isChips, ok, type Chips, type Result } from '../core/index.js';

export const MINES_GRID_SIZE = 5;
export const MINES_TILES = MINES_GRID_SIZE * MINES_GRID_SIZE;
export const MIN_MINES = 1;
export const MAX_MINES = MINES_TILES - 1;

export interface MinesRules {
  readonly minStake: Chips;
  /** Plafonné pour que mise × multiplicateur maximal (C(25,12) ≈ 5,2 millions) reste un entier exact. */
  readonly maxStake: Chips;
  /** Marge de la maison appliquée au multiplicateur juste (0,01 = 1 %). */
  readonly houseEdge: number;
}

export const STANDARD_MINES_RULES: MinesRules = Object.freeze({
  minStake: chips(1),
  maxStake: chips(1_000_000),
  houseEdge: 0.01,
});

export function validateMinesRules(rules: MinesRules): Result<MinesRules> {
  const problems: string[] = [];
  if (!isChips(rules.minStake) || rules.minStake === 0) problems.push('minStake doit être un entier strictement positif');
  if (!isChips(rules.maxStake) || rules.maxStake < rules.minStake || rules.maxStake > 1_000_000) {
    problems.push('maxStake doit être compris entre minStake et 1 000 000');
  }
  if (!(rules.houseEdge >= 0 && rules.houseEdge <= 0.2)) problems.push('houseEdge doit être compris entre 0 et 0,2');
  return problems.length === 0 ? ok(rules) : err(new EngineError('INVALID_RULES', `Règles Mines invalides : ${problems.join(' ; ')}`, { problems }));
}
