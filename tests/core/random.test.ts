import { describe, expect, it } from 'vitest';
import { CryptoRandomSource, SeededRandomSource, shuffle, uniformInt } from '../../src/core/index.js';

describe('uniformInt', () => {
  it('rejette les tirages au-delà du plus grand multiple de la borne (pas de biais de modulo)', () => {
    // 2^32 % 3 = 1 → limite = 2^32 - 1 : la valeur 2^32 - 1 doit être rejetée.
    const values = [2 ** 32 - 1, 7];
    let calls = 0;
    const next = (): number => values[calls++] ?? 0;
    expect(uniformInt(next, 3)).toBe(1);
    expect(calls).toBe(2);
  });

  it.each([0, -1, 1.5, 2 ** 32 + 1])('refuse la borne %s', (bound) => {
    expect(() => uniformInt(() => 0, bound)).toThrow();
  });
});

describe('SeededRandomSource', () => {
  const sequence = (seed: string): number[] => {
    const rng = new SeededRandomSource(seed);
    return Array.from({ length: 20 }, () => rng.nextInt(1_000));
  };

  it('est déterministe pour une même seed et diverge pour une autre', () => {
    expect(sequence('table-42')).toEqual(sequence('table-42'));
    expect(sequence('table-43')).not.toEqual(sequence('table-42'));
  });
});

describe('CryptoRandomSource', () => {
  it('lit la source injectée par lots de 256 valeurs', () => {
    let refills = 0;
    const fake = {
      getRandomValues<T extends Uint32Array>(array: T): T {
        refills += 1;
        array.fill(5);
        return array;
      },
    };
    const rng = new CryptoRandomSource(fake);
    for (let i = 0; i < 300; i += 1) expect(rng.nextInt(10)).toBe(5);
    expect(refills).toBe(2);
  });

  it('fonctionne avec Web Crypto natif', () => {
    const value = new CryptoRandomSource().nextInt(52);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(52);
  });
});

describe('shuffle (Fisher-Yates)', () => {
  it('produit une permutation sans perte ni doublon et ne mute pas l’entrée', () => {
    const input = Array.from({ length: 52 }, (_, i) => i);
    const output = shuffle(input, new SeededRandomSource(1));
    expect(input).toEqual(Array.from({ length: 52 }, (_, i) => i));
    expect([...output].sort((a, b) => a - b)).toEqual(input);
    expect(output).not.toEqual(input);
  });

  it('rend les 6 permutations de 3 éléments équiprobables (test du χ²)', () => {
    const rng = new SeededRandomSource(2026);
    const runs = 60_000;
    const counts = new Map<string, number>();
    for (let i = 0; i < runs; i += 1) {
      const key = shuffle(['a', 'b', 'c'], rng).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const expected = runs / 6;
    const chiSquare = [...counts.values()].reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
    expect(counts.size).toBe(6);
    expect(chiSquare).toBeLessThan(20.52); // valeur critique, 5 degrés de liberté, p = 0,001
  });
});
