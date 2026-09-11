import { uniformInt, type RandomSource } from './random-source.js';

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/** Hash FNV-1a 32 bits : transforme une seed texte ("table-42#round-7") en entier. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** SplitMix32 : étale une seed de 32 bits sur les 128 bits d'état de xoshiro. */
function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/**
 * xoshiro128** : rapide, excellente qualité statistique, période 2^128 - 1.
 * NON cryptographique : réservé aux tests, simulations et replays. Même seed ⇒ même partie.
 */
export class SeededRandomSource implements RandomSource {
  #a: number;
  #b: number;
  #c: number;
  #d: number;

  constructor(seed: string | number) {
    const next = splitmix32(typeof seed === 'number' ? seed : fnv1a(seed));
    this.#a = next();
    this.#b = next();
    this.#c = next();
    this.#d = next();
  }

  nextInt(maxExclusive: number): number {
    return uniformInt(() => this.#nextUint32(), maxExclusive);
  }

  #nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.#b, 5), 7), 9) >>> 0;
    const t = this.#b << 9;
    this.#c ^= this.#a;
    this.#d ^= this.#b;
    this.#b ^= this.#c;
    this.#a ^= this.#d;
    this.#c ^= t;
    this.#d = rotl(this.#d, 11);
    return result;
  }
}
