import { chips, shuffle } from '../../core/index.js';
import { prizeTable } from '../prizes.js';
import type { ScratchGameDefinition } from '../types/ticket.js';
import { amountCell, cellsOf, formatAmount, group, sampleWithCap, ticketEvaluation, zone, zoneById, zoneResult } from './helpers.js';

const AMOUNTS = [5, 10, 20, 50, 100, 1_000, 50_000];

/** Douze montants : trois fois le même et il est à vous. */
export const CASH: ScratchGameDefinition = {
  type: 'CASH',
  name: 'Cash',
  tagline: 'Le best-seller · 12 montants · 3 montants identiques = gagné',
  price: chips(5),
  serialPrefix: 'CSH',
  prizes: prizeTable(785_696, [
    [5, 120_000],
    [10, 50_000],
    [20, 30_000],
    [50, 10_000],
    [100, 4_000],
    [1_000, 300],
    [50_000, 4],
  ]),

  generate(rng, prize) {
    const amounts =
      prize > 0
        ? shuffle([prize, prize, prize, ...sampleWithCap(rng, AMOUNTS.filter((amount) => amount !== prize), 2, 9)], rng)
        : sampleWithCap(rng, AMOUNTS, 2, 12);
    return [
      zone('grille', 'La grille Cash', 'Trois montants identiques : vous gagnez ce montant.', [
        group('grille', 'montants', 'Grattez les 12 cases', 4, amounts.map(amountCell)),
      ]),
    ];
  },

  evaluate(zones) {
    const counts = new Map<number, string[]>();
    for (const cell of cellsOf(zoneById(zones, 'grille'))) {
      if (cell.amount !== null) counts.set(cell.amount, [...(counts.get(cell.amount) ?? []), cell.id]);
    }
    const [best] = [...counts].filter(([, ids]) => ids.length >= 3).sort(([a], [b]) => b - a);
    if (best === undefined) return ticketEvaluation([zoneResult('grille', 0, 'Aucun montant trois fois')]);
    const [amount, ids] = best;
    return ticketEvaluation([zoneResult('grille', amount, `3 × ${formatAmount(amount)}`, ids)]);
  },
};
