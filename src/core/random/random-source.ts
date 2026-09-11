import { InvariantViolation } from '../errors.js';

/**
 * Source d'aléa injectée dans le moteur (inversion de dépendance) :
 *  - production : CryptoRandomSource (CSPRNG) ;
 *  - tests et replays : SeededRandomSource, donc parties 100 % reproductibles.
 */
export interface RandomSource {
  /** Entier uniforme dans [0, maxExclusive), sans biais de modulo. */
  nextInt(maxExclusive: number): number;
}

const UINT32_RANGE = 2 ** 32;

/**
 * Entier uniforme dans [0, maxExclusive) à partir d'un générateur 32 bits.
 * `x % n` seul favoriserait les petites valeurs dès que n ne divise pas 2^32 :
 * on rejette donc les tirages situés au-delà du plus grand multiple de n (échantillonnage par rejet).
 */
export function uniformInt(nextUint32: () => number, maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > UINT32_RANGE) {
    throw new InvariantViolation(`Borne aléatoire invalide : ${maxExclusive}`);
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
  let value = nextUint32();
  while (value >= limit) {
    value = nextUint32();
  }
  return value % maxExclusive;
}
