import { chips } from '../../core/index.js';
import { prizeTable } from '../prizes.js';
import type { ScratchGameDefinition } from '../types/ticket.js';
import { amountCell, firstCell, group, groupById, pick, ticketEvaluation, zone, zoneById, zoneResult } from './helpers.js';

const AMOUNTS = [2, 4, 10, 20, 100, 1_000];
const MARK_LABELS = { X: '✕', O: '◯' } as const;
type Mark = keyof typeof MARK_LABELS;

/** Les 8 alignements d'une grille 3×3 : lignes, colonnes, diagonales. */
export const MORPION_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

const hasLine = (board: readonly Mark[]): boolean =>
  MORPION_LINES.some(([a, b, c]) => board[a] === board[b] && board[b] === board[c]);

// Les 512 grilles possibles, triées une fois pour toutes : tirer une grille gagnante ou perdante est alors exact.
const BOARDS = Array.from({ length: 512 }, (_, mask) => Array.from({ length: 9 }, (_, i): Mark => ((mask >> i) & 1 ? 'X' : 'O')));
const WINNING_BOARDS = BOARDS.filter(hasLine);
const LOSING_BOARDS = BOARDS.filter((board) => !hasLine(board));

export const MORPION: ScratchGameDefinition = {
  type: 'MORPION',
  name: 'Morpion',
  tagline: 'Croix ou rond · 3 symboles identiques alignés = gagné',
  price: chips(2),
  serialPrefix: 'MRP',
  prizes: prizeTable(77_340, [
    [2, 13_000],
    [4, 6_000],
    [10, 2_500],
    [20, 1_000],
    [100, 150],
    [1_000, 10],
  ]),

  generate(rng, prize) {
    const board = pick(rng, prize > 0 ? WINNING_BOARDS : LOSING_BOARDS);
    return [
      zone(
        'morpion',
        'La grille du Morpion',
        'Trois symboles identiques alignés (ligne, colonne ou diagonale) : vous gagnez le montant de la case Gain.',
        [
          group('morpion', 'grille', 'Grattez la grille', 3, board.map((mark) => ({ symbol: mark, label: MARK_LABELS[mark] }))),
          group('morpion', 'gain', 'Gain', 1, [amountCell(prize > 0 ? prize : pick(rng, AMOUNTS))]),
        ],
      ),
    ];
  },

  evaluate(zones) {
    const morpion = zoneById(zones, 'morpion');
    const grid = groupById(morpion, 'grille').cells;
    const gain = firstCell(morpion, 'gain');
    const lines = MORPION_LINES.filter(([a, b, c]) => {
      const symbol = grid[a]?.symbol;
      return symbol !== undefined && grid[b]?.symbol === symbol && grid[c]?.symbol === symbol;
    });
    if (lines.length === 0 || gain.amount === null) return ticketEvaluation([zoneResult('morpion', 0, 'Aucun alignement')]);
    const marks = [...new Set(lines.flat())].map((index) => grid[index]?.id ?? '');
    const detail = lines.length === 1 ? 'Un alignement' : `${lines.length} alignements`;
    return ticketEvaluation([zoneResult('morpion', gain.amount, detail, [...marks, gain.id])]);
  },
};
