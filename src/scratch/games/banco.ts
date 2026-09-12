import { chips } from '../../core/index.js';
import { lotTable } from '../prizes.js';
import type { ScratchGameDefinition } from '../types/ticket.js';
import { amountCell, cellsOf, chooseDecomposition, formatAmount, group, partsFor, ticketEvaluation, zone, zoneById, zoneResult, type PrizeSlot } from './helpers.js';

const AMOUNTS = [1, 2, 5, 10, 200, 5_000];
const SLOTS: readonly PrizeSlot[] = [
  { id: 'gain1', capacity: 1, amounts: AMOUNTS },
  { id: 'gain2', capacity: 1, amounts: AMOUNTS },
];

/**
 * Banco, d'après le règlement FDJ : deux zones à gratter (« Grattez ici… » et « … et ici ») cachant chacune une somme.
 * Toute somme autre que 0 est gagnée ; les deux se cumulent.
 */
export const BANCO: ScratchGameDefinition = {
  type: 'BANCO',
  name: 'Banco',
  tagline: '2 zones à gratter · toute somme découverte est gagnée · jusqu’à 5 000',
  price: chips(1),
  serialPrefix: 'BNC',
  prizes: lotTable(6_000_000, [
    [3, 5_000],
    [80, 200],
    [120_000, 10],
    [150_000, 5],
    [591_496, 2],
    [706_008, 1],
  ]),

  generate(rng, prize) {
    const parts = chooseDecomposition(rng, prize, SLOTS, 2);
    const amountIn = (slot: string): number => partsFor(parts, slot)[0] ?? 0;
    return [
      zone('banco', 'Banco', 'Chaque zone cache une somme : toute somme autre que 0 est gagnée, et les deux zones se cumulent.', [
        group('banco', 'gain1', 'Grattez ici…', 1, [amountCell(amountIn('gain1'))]),
        group('banco', 'gain2', '… et ici', 1, [amountCell(amountIn('gain2'))]),
      ]),
    ];
  },

  evaluate(zones) {
    const winners = cellsOf(zoneById(zones, 'banco')).filter((cell) => (cell.amount ?? 0) > 0);
    const total = winners.reduce((sum, cell) => sum + (cell.amount ?? 0), 0);
    return ticketEvaluation([
      zoneResult('banco', total, total > 0 ? `Banco ! ${formatAmount(total)} jetons` : 'Deux zones à 0', winners.map((cell) => cell.id)),
    ]);
  },
};
