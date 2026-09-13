import { EngineError, bigChips, err, isBigChips, ok, type BigChips, type Result } from '../core/index.js';

export interface RouletteRules {
  /** Un seul zéro, pas de règle « en prison » : le 0 fait perdre toutes les mises externes. */
  readonly variant: 'EUROPEAN';
  /** 1 à 10 joueurs. */
  readonly seatCount: number;
  /** Mise minimale par pose de jetons. */
  readonly minBet: BigChips;
  /** Plafond cumulé sur une même position (ex : tous les jetons posés sur le plein 17) ; null = aucun plafond. */
  readonly maxBetPerPosition: BigChips | null;
  /** Plafond de l'ensemble des mises d'un joueur sur un tour ; null = aucun plafond. */
  readonly maxTotalBet: BigChips | null;
  /** Nombre de numéros sortis conservés dans l'historique. */
  readonly historySize: number;
}

export const STANDARD_ROULETTE_RULES: RouletteRules = Object.freeze({
  variant: 'EUROPEAN',
  seatCount: 6,
  minBet: bigChips(1n),
  maxBetPerPosition: bigChips(1_000n),
  maxTotalBet: bigChips(10_000n),
  historySize: 20,
});

/** Table sans limite : un jeton minimum, puis le solde du joueur est le seul plafond, même au-delà des entiers sûrs. */
export const NO_LIMIT_ROULETTE_RULES: RouletteRules = Object.freeze({
  ...STANDARD_ROULETTE_RULES,
  maxBetPerPosition: null,
  maxTotalBet: null,
});

function isIntegerBetween(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function validateRouletteRules(rules: RouletteRules): Result<RouletteRules> {
  const problems: string[] = [];
  const { minBet, maxBetPerPosition, maxTotalBet } = rules;
  if (rules.variant !== 'EUROPEAN') problems.push('seule la variante EUROPEAN est supportée');
  if (!isIntegerBetween(rules.seatCount, 1, 10)) problems.push('seatCount doit être compris entre 1 et 10');
  if (!isBigChips(minBet) || minBet === 0n) problems.push('minBet doit être un entier strictement positif');
  if (maxBetPerPosition !== null && (!isBigChips(maxBetPerPosition) || maxBetPerPosition < minBet)) {
    problems.push('maxBetPerPosition doit être un entier ≥ minBet, ou null');
  }
  if (maxTotalBet !== null && (!isBigChips(maxTotalBet) || maxTotalBet < (maxBetPerPosition ?? minBet))) {
    problems.push('maxTotalBet doit être un entier ≥ maxBetPerPosition, ou null');
  }
  if (!isIntegerBetween(rules.historySize, 0, 500)) problems.push('historySize doit être compris entre 0 et 500');

  return problems.length === 0
    ? ok(rules)
    : err(new EngineError('INVALID_RULES', `Règles de roulette invalides : ${problems.join(' ; ')}`, { problems }));
}
