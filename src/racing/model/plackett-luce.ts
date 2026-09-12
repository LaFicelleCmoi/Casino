import { invariant, type RandomSource } from '../../core/index.js';

/*
 * Modèle de Plackett-Luce : le vainqueur est tiré proportionnellement aux forces, puis le deuxième parmi les restants,
 * et ainsi de suite. Les probabilités d'arrivée (et donc les cotes) se calculent exactement.
 */

export type Strengths = ReadonlyMap<number, number>;

const totalOf = (strengths: Strengths): number => [...strengths.values()].reduce((sum, value) => sum + value, 0);

/** Probabilité que l'arrivée commence exactement par `prefix`. */
export function orderedProbability(strengths: Strengths, prefix: readonly number[]): number {
  let remaining = totalOf(strengths);
  let probability = 1;
  for (const horse of prefix) {
    const strength = strengths.get(horse) ?? 0;
    if (strength === 0 || remaining <= 0) return 0;
    probability *= strength / remaining;
    remaining -= strength;
  }
  return probability;
}

export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

/** Probabilité que `horses` occupent les premières places, dans n'importe quel ordre. */
export function unorderedProbability(strengths: Strengths, horses: readonly number[]): number {
  return permutations(horses).reduce((sum, order) => sum + orderedProbability(strengths, order), 0);
}

/** Probabilité que `horse` termine parmi les `places` premiers. */
export function topProbability(strengths: Strengths, horse: number, places: number): number {
  const own = strengths.get(horse) ?? 0;
  const others = [...strengths.keys()].filter((candidate) => candidate !== horse);
  let probability = 0;
  const visit = (used: ReadonlySet<number>, reach: number, remaining: number): void => {
    probability += (reach * own) / remaining;
    if (used.size + 1 >= places) return;
    for (const other of others) {
      if (used.has(other)) continue;
      const strength = strengths.get(other) ?? 0;
      visit(new Set([...used, other]), (reach * strength) / remaining, remaining - strength);
    }
  };
  if (own > 0) visit(new Set(), 1, totalOf(strengths));
  return probability;
}

/** Tire une arrivée complète selon le modèle (forces entières). */
export function sampleFinishOrder(rng: RandomSource, strengths: Strengths): number[] {
  const pool = [...strengths];
  const order: number[] = [];
  while (pool.length > 0) {
    let roll = rng.nextInt(pool.reduce((sum, [, strength]) => sum + strength, 0));
    const index = pool.findIndex(([, strength]) => (roll -= strength) < 0);
    const [entry] = pool.splice(index, 1);
    invariant(entry !== undefined, 'Tirage d’arrivée impossible');
    order.push(entry[0]);
  }
  return order;
}
