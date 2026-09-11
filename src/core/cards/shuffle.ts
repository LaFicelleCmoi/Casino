import type { RandomSource } from '../random/random-source.js';

/**
 * Fisher-Yates (variante Durstenfeld), O(n), appliqué à une copie.
 * Les n! permutations sont équiprobables à condition que `rng.nextInt` soit uniforme,
 * ce que garantit l'échantillonnage par rejet de `uniformInt`.
 */
export function shuffle<T>(items: readonly T[], rng: RandomSource): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = rng.nextInt(i + 1);
    // i et j sont toujours dans les bornes : les assertions évitent un contrôle à chaque itération.
    const current = result[i] as T;
    result[i] = result[j] as T;
    result[j] = current;
  }
  return result;
}
