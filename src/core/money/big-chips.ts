import { EngineError, invariant } from '../errors.js';

declare const bigChipsBrand: unique symbol;

/**
 * Montant de jetons sans plafond, en précision arbitraire : pour les tables « sans limite », où mises et gains
 * dépassent Number.MAX_SAFE_INTEGER. Entier ≥ 0 garanti par construction, comme Chips.
 */
export type BigChips = bigint & { readonly [bigChipsBrand]: 'BigChips' };

export interface BigChipRange {
  readonly min: BigChips;
  readonly max: BigChips;
}

export function isBigChips(value: unknown): value is BigChips {
  return typeof value === 'bigint' && value >= 0n;
}

/** Accepte un bigint, un entier sûr ou une chaîne décimale (montant relu d'un stockage JSON). */
export function bigChips(value: bigint | number | string): BigChips {
  let amount: bigint | null = null;
  if (typeof value === 'bigint') amount = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value)) amount = BigInt(value);
  else if (typeof value === 'string' && /^\d+$/.test(value)) amount = BigInt(value);
  if (!isBigChips(amount)) {
    throw new EngineError('INVALID_AMOUNT', `Montant de jetons invalide : ${String(value)}`);
  }
  return amount;
}

export const ZERO_BIG_CHIPS: BigChips = bigChips(0n);

export function addBigChips(a: BigChips, b: BigChips): BigChips {
  return bigChips(a + b);
}

export function subtractBigChips(from: BigChips, amount: BigChips): BigChips {
  invariant(amount <= from, `Solde négatif : ${from} - ${amount}`);
  return bigChips(from - amount);
}

export function sumBigChips(amounts: readonly BigChips[]): BigChips {
  return bigChips(amounts.reduce<bigint>((total, amount) => total + amount, 0n));
}
