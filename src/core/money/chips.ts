import { EngineError } from '../errors.js';

declare const chipsBrand: unique symbol;

/**
 * Montant en unités de jeton indivisibles. Entier sûr ≥ 0 garanti par construction :
 * aucun flottant ne circule dans le moteur, donc aucune erreur d'arrondi sur les gains ou les side pots.
 */
export type Chips = number & { readonly [chipsBrand]: 'Chips' };

export function isChips(value: number): value is Chips {
  return Number.isSafeInteger(value) && value >= 0;
}

export function chips(value: number): Chips {
  if (!isChips(value)) {
    throw new EngineError('INVALID_AMOUNT', `Montant de jetons invalide : ${value}`);
  }
  return value;
}

export const ZERO_CHIPS: Chips = chips(0);

/** Rapport de paiement exact, ex. 3:2 → { numerator: 3, denominator: 2 }. */
export interface Ratio {
  readonly numerator: number;
  readonly denominator: number;
}

export interface ChipRange {
  readonly min: Chips;
  readonly max: Chips;
}
