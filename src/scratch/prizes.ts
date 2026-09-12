import { ZERO_CHIPS, chips, type Chips, type RandomSource } from '../core/index.js';
import type { PrizeTable } from './types/ticket.js';

/** prizeTable(7_589, [[1, 1_200], [2, 800]]) : poids de la défaite, puis paliers [montant, poids]. */
export function prizeTable(loseWeight: number, tiers: readonly (readonly [amount: number, weight: number])[]): PrizeTable {
  return { loseWeight, tiers: tiers.map(([amount, weight]) => ({ amount: chips(amount), weight })) };
}

export function totalWeight(table: PrizeTable): number {
  return table.tiers.reduce((sum, tier) => sum + tier.weight, table.loseWeight);
}

/** Tire le lot d'un ticket : 0 pour un ticket perdant. */
export function drawPrize(rng: RandomSource, table: PrizeTable): Chips {
  let roll = rng.nextInt(totalWeight(table));
  for (const tier of table.tiers) {
    if (roll < tier.weight) return tier.amount;
    roll -= tier.weight;
  }
  return ZERO_CHIPS;
}

/** Taux de retour aux joueurs : gain moyen d'un ticket rapporté à son prix. */
export function expectedReturnRate(table: PrizeTable, price: Chips): number {
  const expected = table.tiers.reduce((sum, tier) => sum + tier.amount * tier.weight, 0) / totalWeight(table);
  return expected / price;
}

/** Probabilité qu'un ticket soit gagnant. */
export function winProbability(table: PrizeTable): number {
  return table.tiers.reduce((sum, tier) => sum + tier.weight, 0) / totalWeight(table);
}

export function maxPrize(table: PrizeTable): Chips {
  return table.tiers.reduce<Chips>((max, tier) => (tier.amount > max ? tier.amount : max), ZERO_CHIPS);
}
