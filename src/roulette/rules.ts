import { EngineError, chips, err, isChips, ok, type Chips, type Result } from '../core/index.js';

export interface RouletteRules {
  /** Un seul zéro, pas de règle « en prison » : le 0 fait perdre toutes les mises externes. */
  readonly variant: 'EUROPEAN';
  /** 1 à 10 joueurs. */
  readonly seatCount: number;
  /** Mise minimale par pose de jetons. */
  readonly minBet: Chips;
  /** Plafond cumulé sur une même position (ex : tous les jetons posés sur le plein 17). */
  readonly maxBetPerPosition: Chips;
  /** Plafond de l'ensemble des mises d'un joueur sur un tour. */
  readonly maxTotalBet: Chips;
  /** Nombre de numéros sortis conservés dans l'historique. */
  readonly historySize: number;
}

export const STANDARD_ROULETTE_RULES: RouletteRules = Object.freeze({
  variant: 'EUROPEAN',
  seatCount: 6,
  minBet: chips(1),
  maxBetPerPosition: chips(1_000),
  maxTotalBet: chips(10_000),
  historySize: 20,
});

function isIntegerBetween(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function validateRouletteRules(rules: RouletteRules): Result<RouletteRules> {
  const problems: string[] = [];
  if (rules.variant !== 'EUROPEAN') problems.push('seule la variante EUROPEAN est supportée');
  if (!isIntegerBetween(rules.seatCount, 1, 10)) problems.push('seatCount doit être compris entre 1 et 10');
  if (!isChips(rules.minBet) || rules.minBet === 0) problems.push('minBet doit être un entier strictement positif');
  if (!isChips(rules.maxBetPerPosition) || rules.maxBetPerPosition < rules.minBet) {
    problems.push('maxBetPerPosition doit être un entier ≥ minBet');
  }
  if (!isChips(rules.maxTotalBet) || rules.maxTotalBet < rules.maxBetPerPosition) {
    problems.push('maxTotalBet doit être un entier ≥ maxBetPerPosition');
  }
  if (!isIntegerBetween(rules.historySize, 0, 500)) problems.push('historySize doit être compris entre 0 et 500');

  return problems.length === 0
    ? ok(rules)
    : err(new EngineError('INVALID_RULES', `Règles de roulette invalides : ${problems.join(' ; ')}`, { problems }));
}
