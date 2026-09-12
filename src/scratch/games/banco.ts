import { chips } from '../../core/index.js';
import { prizeTable } from '../prizes.js';
import type { ScratchGameDefinition } from '../types/ticket.js';
import { amountCell, cellsOf, formatAmount, group, sample, ticketEvaluation, zone, zoneById, zoneResult } from './helpers.js';

const AMOUNTS = [1, 2, 5, 10, 50, 500];

/** Le plus simple : deux cases, deux montants identiques et c'est gagné. */
export const BANCO: ScratchGameDefinition = {
  type: 'BANCO',
  name: 'Banco',
  tagline: 'Le doyen des tickets · 2 cases à gratter · 2 montants identiques et c’est gagné',
  price: chips(1),
  serialPrefix: 'BNC',
  prizes: prizeTable(7_589, [
    [1, 1_200],
    [2, 800],
    [5, 300],
    [10, 100],
    [50, 10],
    [500, 1],
  ]),

  generate(rng, prize) {
    const amounts = prize > 0 ? [prize, prize] : sample(rng, AMOUNTS, 2);
    return [
      zone('cases', 'Les deux cases', 'Deux montants identiques : vous gagnez ce montant.', [
        group('cases', 'cases', 'Grattez les deux cases', 2, amounts.map(amountCell)),
      ]),
    ];
  },

  evaluate(zones) {
    const [first, second] = cellsOf(zoneById(zones, 'cases'));
    if (first !== undefined && second !== undefined && first.amount !== null && first.amount === second.amount) {
      return ticketEvaluation([zoneResult('cases', first.amount, `Banco ! ${formatAmount(first.amount)} jetons`, [first.id, second.id])]);
    }
    return ticketEvaluation([zoneResult('cases', 0, 'Montants différents')]);
  },
};
