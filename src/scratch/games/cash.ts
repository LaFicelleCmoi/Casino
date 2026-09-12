import { chips, shuffle } from '../../core/index.js';
import { lotTable } from '../prizes.js';
import type { ScratchGameDefinition } from '../types/ticket.js';
import {
  chooseDecomposition,
  decoyAmount,
  formatAmount,
  group,
  groupById,
  range,
  sample,
  ticketEvaluation,
  zone,
  zoneById,
  zoneResult,
  type CellData,
  type PrizeSlot,
} from './helpers.js';

/** Numéros imprimables d'après le règlement : de 1 à 40, sauf 5, 10 et 20. */
export const CASH_NUMBERS = range(1, 40).filter((n) => ![5, 10, 20].includes(n));
const AMOUNTS = [5, 10, 20, 50, 100, 500, 5_000, 10_000, 100_000, 500_000];
const SLOTS: readonly PrizeSlot[] = [{ id: 'numeros', capacity: 5, amounts: AMOUNTS }];
const YOUR_NUMBERS = 20;
const WINNING_NUMBERS = 5;

const numberCell = (n: number, amount: number): CellData => ({ symbol: 'NUMBER', label: String(n), value: n, amount });

/** Cash, d'après le règlement FDJ : 20 « Vos numéros » avec leur somme face à 5 « Numéros gagnants » ; gains cumulables. */
export const CASH: ScratchGameDefinition = {
  type: 'CASH',
  name: 'Cash',
  tagline: '20 numéros face à 5 numéros gagnants · gains cumulables · jusqu’à 500 000',
  price: chips(5),
  serialPrefix: 'CSH',
  prizes: lotTable(24_000_000, [
    [4, 500_000],
    [2, 100_000],
    [5, 10_000],
    [10, 5_000],
    [3_000, 500],
    [178_000, 100],
    [178_000, 50],
    [640_000, 20],
    [2_850_016, 10],
    [2_439_968, 5],
  ]),

  generate(rng, prize) {
    const gains = chooseDecomposition(rng, prize, SLOTS, WINNING_NUMBERS).map((part) => part.amount);
    const winning = sample(rng, CASH_NUMBERS, WINNING_NUMBERS);
    const matched = sample(rng, winning, gains.length);
    const others = sample(rng, CASH_NUMBERS.filter((n) => !winning.includes(n)), YOUR_NUMBERS - gains.length);
    const yours = shuffle(
      [...matched.map((n, index) => numberCell(n, gains[index] ?? 0)), ...others.map((n) => numberCell(n, decoyAmount(rng, AMOUNTS)))],
      rng,
    );
    return [
      zone('cash', 'Cash', 'Un ou plusieurs de vos numéros sont des numéros gagnants : vous remportez les sommes associées, cumulées.', [
        group('cash', 'gagnants', 'Numéros gagnants', WINNING_NUMBERS, winning.map((n) => ({ symbol: 'WINNING_NUMBER', label: String(n), value: n }))),
        group('cash', 'vos-numeros', 'Vos numéros', 5, yours),
      ]),
    ];
  },

  evaluate(zones) {
    const cash = zoneById(zones, 'cash');
    const winning = groupById(cash, 'gagnants').cells;
    const winningValues = new Set(winning.map((cell) => cell.value));
    const matches = groupById(cash, 'vos-numeros').cells.filter((cell) => winningValues.has(cell.value));
    const total = matches.reduce((sum, cell) => sum + (cell.amount ?? 0), 0);
    if (total === 0) return ticketEvaluation([zoneResult('cash', 0, 'Aucun numéro gagnant')]);
    const matchedValues = new Set(matches.map((cell) => cell.value));
    const marks = [...matches, ...winning.filter((cell) => matchedValues.has(cell.value))].map((cell) => cell.id);
    const detail = matches.length === 1 ? `1 numéro gagnant : ${formatAmount(total)}` : `${matches.length} numéros gagnants : ${formatAmount(total)}`;
    return ticketEvaluation([zoneResult('cash', total, detail, marks)]);
  },
};
