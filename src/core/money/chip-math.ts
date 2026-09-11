import { invariant } from '../errors.js';
import { chips, type Chips, type Ratio } from './chips.js';

/*
 * Arithmétique des jetons. Toute opération qui sortirait des entiers sûrs ≥ 0 est refusée :
 * un solde négatif est un bug du moteur (InvariantViolation), jamais un état silencieux.
 */

export function addChips(a: Chips, b: Chips): Chips {
  return chips(a + b);
}

export function sumChips(amounts: readonly Chips[]): Chips {
  return chips(amounts.reduce((total, amount) => total + amount, 0));
}

export function subtractChips(from: Chips, amount: Chips): Chips {
  invariant(amount <= from, `Solde négatif : ${from} - ${amount}`);
  return chips(from - amount);
}

export function minChips(a: Chips, b: Chips): Chips {
  return a <= b ? a : b;
}

export function maxChips(a: Chips, b: Chips): Chips {
  return a >= b ? a : b;
}

export function isValidRatio(ratio: Ratio): boolean {
  return (
    Number.isSafeInteger(ratio.numerator) &&
    Number.isSafeInteger(ratio.denominator) &&
    ratio.numerator > 0 &&
    ratio.denominator > 0
  );
}

/** ⌊amount × ratio⌋ en arithmétique entière exacte (ex. 25 × 3:2 = 37). L'arrondi profite toujours à la maison. */
export function applyRatioFloor(amount: Chips, ratio: Ratio): Chips {
  invariant(isValidRatio(ratio), `Rapport invalide : ${ratio.numerator}:${ratio.denominator}`);
  const scaled = amount * ratio.numerator;
  invariant(Number.isSafeInteger(scaled), `Dépassement de capacité : ${amount} × ${ratio.numerator}`);
  return chips(Math.floor(scaled / ratio.denominator));
}

export interface EvenSplit {
  readonly share: Chips;
  /** Jetons indivisibles restants, toujours < parts. */
  readonly remainder: number;
}

export function splitEvenly(amount: Chips, parts: number): EvenSplit {
  invariant(Number.isSafeInteger(parts) && parts > 0, `Nombre de parts invalide : ${parts}`);
  return { share: chips(Math.floor(amount / parts)), remainder: amount % parts };
}
