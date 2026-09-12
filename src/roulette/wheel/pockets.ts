import { EngineError, invariant } from '../../core/index.js';

declare const rouletteNumberBrand: unique symbol;

/** Case du cylindre européen : entier de 0 à 36, garanti par construction (comme Chips). */
export type RouletteNumber = number & { readonly [rouletteNumberBrand]: 'RouletteNumber' };

/** Tiers du tapis : colonne ou douzaine n° 1, 2 ou 3. */
export type Third = 1 | 2 | 3;

export type PocketColor = 'GREEN' | 'RED' | 'BLACK';

export const MAX_NUMBER = 36;

export function isRouletteNumber(value: number): value is RouletteNumber {
  return Number.isInteger(value) && value >= 0 && value <= MAX_NUMBER;
}

export function rouletteNumber(value: number): RouletteNumber {
  if (!isRouletteNumber(value)) {
    throw new EngineError('INVALID_BET', `Numéro de roulette invalide : ${value}`);
  }
  return value;
}

/** Les 37 numéros, de 0 à 36. */
export const ALL_NUMBERS: readonly RouletteNumber[] = Array.from({ length: MAX_NUMBER + 1 }, (_, n) => rouletteNumber(n));

/** Ordre physique des cases du cylindre européen, dans le sens horaire à partir du 0 : rouge et noir alternent. */
export const EUROPEAN_WHEEL_ORDER: readonly RouletteNumber[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28,
  12, 35, 3, 26,
].map(rouletteNumber);

export const RED_NUMBERS: ReadonlySet<number> = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function colorOf(n: RouletteNumber): PocketColor {
  if (n === 0) return 'GREEN';
  return RED_NUMBERS.has(n) ? 'RED' : 'BLACK';
}

function thirdOf(value: number): Third {
  invariant(value === 1 || value === 2 || value === 3, `Tiers invalide : ${value}`);
  return value;
}

/** Colonne du tapis (colonne 1 = 1, 4, 7… 34). null pour le 0, qui n'appartient à aucune colonne. */
export function columnOf(n: RouletteNumber): Third | null {
  return n === 0 ? null : thirdOf(((n - 1) % 3) + 1);
}

/** Douzaine (1 = 1-12, 2 = 13-24, 3 = 25-36). null pour le 0. */
export function dozenOf(n: RouletteNumber): Third | null {
  return n === 0 ? null : thirdOf(Math.ceil(n / 12));
}

/** Caractéristiques du numéro sorti, telles qu'annoncées par le croupier. */
export interface SpinOutcome {
  readonly number: RouletteNumber;
  readonly color: PocketColor;
  /** null pour le 0 : il n'est ni pair ni impair au sens des chances simples. */
  readonly parity: 'EVEN' | 'ODD' | null;
  /** Manque (1-18) ou Passe (19-36) ; null pour le 0. */
  readonly range: 'LOW' | 'HIGH' | null;
  readonly dozen: Third | null;
  readonly column: Third | null;
}

export function describeNumber(n: RouletteNumber): SpinOutcome {
  if (n === 0) return { number: n, color: 'GREEN', parity: null, range: null, dozen: null, column: null };
  return {
    number: n,
    color: colorOf(n),
    parity: n % 2 === 0 ? 'EVEN' : 'ODD',
    range: n <= 18 ? 'LOW' : 'HIGH',
    dozen: dozenOf(n),
    column: columnOf(n),
  };
}
