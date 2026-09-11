import { InvariantViolation, invariant } from '../errors.js';
import { uniformInt, type RandomSource } from './random-source.js';

/** Sous-ensemble de Web Crypto utilisé : natif dans Node ≥ 19 et dans tous les navigateurs. */
export interface CryptoLike {
  getRandomValues<T extends Uint32Array>(array: T): T;
}

function isCryptoLike(value: unknown): value is CryptoLike {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'getRandomValues') === 'function';
}

function globalCrypto(): CryptoLike {
  const candidate: unknown = Reflect.get(globalThis, 'crypto');
  if (!isCryptoLike(candidate)) {
    throw new InvariantViolation('Web Crypto indisponible : injectez une implémentation CryptoLike');
  }
  return candidate;
}

const BUFFER_SIZE = 256;

/** CSPRNG de production. Les valeurs sont tirées par lots de 256 pour limiter les appels au générateur système. */
export class CryptoRandomSource implements RandomSource {
  readonly #crypto: CryptoLike;
  readonly #buffer = new Uint32Array(BUFFER_SIZE);
  #cursor = BUFFER_SIZE;

  constructor(crypto: CryptoLike = globalCrypto()) {
    this.#crypto = crypto;
  }

  nextInt(maxExclusive: number): number {
    return uniformInt(() => this.#nextUint32(), maxExclusive);
  }

  #nextUint32(): number {
    if (this.#cursor >= this.#buffer.length) {
      this.#crypto.getRandomValues(this.#buffer);
      this.#cursor = 0;
    }
    const value = this.#buffer[this.#cursor];
    this.#cursor += 1;
    invariant(value !== undefined, 'Curseur hors du tampon aléatoire');
    return value;
  }
}
