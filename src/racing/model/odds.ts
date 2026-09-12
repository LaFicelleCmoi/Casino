import { EngineError, applyRatioFloor, err, ok, type Chips, type Result } from '../../core/index.js';
import type { RacingRules } from '../rules.js';
import type { OddsCents, RaceBetKind, RaceBetSelection, RaceCard, RaceResult } from '../types/race.js';
import { orderedProbability, topProbability, unorderedProbability, type Strengths } from './plackett-luce.js';

export const MIN_ODDS_CENTS = 105;
export const MAX_ODDS_CENTS = 10_000_000;
/** Places payées par un Simple Placé. */
export const PLACED_POSITIONS = 3;

export const HORSES_PER_BET: Readonly<Record<RaceBetKind, number>> = {
  GAGNANT: 1,
  PLACE: 1,
  TIERCE_ORDRE: 3,
  TIERCE_DESORDRE: 3,
  QUINTE_ORDRE: 5,
  QUINTE_DESORDRE: 5,
};

export function strengthsOf(card: RaceCard): Strengths {
  return new Map(card.horses.map((horse) => [horse.number, horse.strength]));
}

/** Cote « juste » moins la marge : (1 − marge) / probabilité, bornée et arrondie au centième inférieur. */
export function oddsFromProbability(probability: number, margin: number): OddsCents {
  if (probability <= 0) return MAX_ODDS_CENTS;
  return Math.min(MAX_ODDS_CENTS, Math.max(MIN_ODDS_CENTS, Math.floor(((1 - margin) / probability) * 100)));
}

export function betProbability(card: RaceCard, kind: RaceBetKind, horses: readonly number[]): number {
  const strengths = strengthsOf(card);
  switch (kind) {
    case 'GAGNANT':
    case 'TIERCE_ORDRE':
    case 'QUINTE_ORDRE':
      return orderedProbability(strengths, horses);
    case 'PLACE':
      return horses[0] === undefined ? 0 : topProbability(strengths, horses[0], PLACED_POSITIONS);
    case 'TIERCE_DESORDRE':
    case 'QUINTE_DESORDRE':
      return unorderedProbability(strengths, horses);
  }
}

export function betOdds(card: RaceCard, rules: RacingRules, selection: RaceBetSelection): OddsCents {
  const margin = selection.kind === 'GAGNANT' || selection.kind === 'PLACE' ? rules.simpleMargin : rules.comboMargin;
  return oddsFromProbability(betProbability(card, selection.kind, selection.horses), margin);
}

/** Vérifie qu'un pari désigne le bon nombre de chevaux distincts, tous au départ. */
export function validateSelection(card: RaceCard, selection: RaceBetSelection): Result<RaceBetSelection> {
  const expected = HORSES_PER_BET[selection.kind];
  if (expected === undefined) return err(new EngineError('INVALID_BET', `Type de pari inconnu : ${String(selection.kind)}`));
  const runners = new Set(card.horses.map((horse) => horse.number));
  const { horses } = selection;
  if (horses.length !== expected || new Set(horses).size !== expected || !horses.every((horse) => runners.has(horse))) {
    return err(new EngineError('INVALID_BET', `Ce pari demande ${expected} cheva${expected > 1 ? 'ux distincts' : 'l'} au départ de la course`));
  }
  return ok(selection);
}

export function isWinningBet(result: RaceResult, kind: RaceBetKind, horses: readonly number[]): boolean {
  const { order } = result;
  switch (kind) {
    case 'GAGNANT':
      return order[0] === horses[0];
    case 'PLACE':
      return horses[0] !== undefined && order.slice(0, PLACED_POSITIONS).includes(horses[0]);
    case 'TIERCE_ORDRE':
    case 'QUINTE_ORDRE':
      return horses.every((horse, index) => order[index] === horse);
    case 'TIERCE_DESORDRE':
    case 'QUINTE_DESORDRE': {
      const podium = new Set(order.slice(0, horses.length));
      return horses.every((horse) => podium.has(horse));
    }
  }
}

/** Gain mise comprise : ⌊mise × cote⌋. */
export function payoutOf(stake: Chips, odds: OddsCents): Chips {
  return applyRatioFloor(stake, { numerator: odds, denominator: 100 });
}

/** 350 → "3,50". */
export function formatOdds(odds: OddsCents): string {
  return (odds / 100).toFixed(2).replace('.', ',');
}
