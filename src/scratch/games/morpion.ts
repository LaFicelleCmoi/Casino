import { chips, invariant } from '../../core/index.js';
import { lotTable } from '../prizes.js';
import type { ScratchGameDefinition } from '../types/ticket.js';
import { decoyAmount, group, groupById, pick, ticketEvaluation, zone, zoneById, zoneResult } from './helpers.js';

const MARK_LABELS = { X: '✕', O: '◯' } as const;
type Mark = keyof typeof MARK_LABELS;

/** Les 8 alignements d'une grille 3×3, dans l'ordre des sommes imprimées. */
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
export const MORPION_LINE_NAMES = ['Ligne 1', 'Ligne 2', 'Ligne 3', 'Colonne 1', 'Colonne 2', 'Colonne 3', 'Diagonale ↘', 'Diagonale ↙'];

/**
 * Sommes des alignements. Le règlement FDJ fixe le ticket à 0,50 € avec des lots de 0,50 € à 3 000 € ;
 * les jetons étant entiers, prix et lots sont doublés (1 jeton, lots de 1 à 6 000).
 */
const LINE_AMOUNTS = [1, 4, 6, 10, 1_000, 6_000];

const winningLines = (symbols: readonly (string | undefined)[]): number[] =>
  MORPION_LINES.flatMap(([a, b, c], index) => (symbols[a] !== undefined && symbols[a] === symbols[b] && symbols[b] === symbols[c] ? [index] : []));

const BOARDS = Array.from({ length: 512 }, (_, mask) => Array.from({ length: 9 }, (_, i): Mark => ((mask >> i) & 1 ? 'X' : 'O')));
const LOSING_BOARDS = BOARDS.filter((board) => winningLines(board).length === 0);
/** Pour chaque alignement, les grilles où il est le seul gagnant : un lot du tableau correspond à une seule somme. */
const SINGLE_LINE_BOARDS = MORPION_LINES.map((_, line) =>
  BOARDS.filter((board) => {
    const lines = winningLines(board);
    return lines.length === 1 && lines[0] === line;
  }),
);
invariant(SINGLE_LINE_BOARDS.every((boards) => boards.length > 0), 'Chaque alignement doit pouvoir être le seul gagnant');

/** Morpion, d'après le règlement FDJ : 9 cases croix ou rond ; chaque alignement porte sa propre somme, imprimée. */
export const MORPION: ScratchGameDefinition = {
  type: 'MORPION',
  name: 'Morpion',
  tagline: '3 croix ou 3 ronds alignés · une somme par alignement · jusqu’à 6 000',
  price: chips(1),
  serialPrefix: 'MRP',
  prizes: lotTable(1_500_000, [
    [2, 6_000],
    [10, 1_000],
    [17_000, 10],
    [44_000, 6],
    [75_050, 4],
    [280_600, 1],
  ]),

  generate(rng, prize) {
    invariant(prize === 0 || LINE_AMOUNTS.includes(prize), `Lot Morpion inconnu : ${prize}`);
    const line = prize > 0 ? rng.nextInt(MORPION_LINES.length) : null;
    const board = pick(rng, line === null ? LOSING_BOARDS : (SINGLE_LINE_BOARDS[line] ?? []));
    const amounts = MORPION_LINES.map((_, index) => (index === line ? prize : decoyAmount(rng, LINE_AMOUNTS)));
    return [
      zone('morpion', 'Morpion', 'Trois croix ou trois ronds alignés en ligne, en colonne ou en diagonale : vous remportez la somme de cet alignement.', [
        group('morpion', 'grille', 'Grattez les 9 cases', 3, board.map((mark) => ({ symbol: mark, label: MARK_LABELS[mark] }))),
        group(
          'morpion',
          'gains',
          'Somme de chaque alignement',
          4,
          amounts.map((amount, index) => ({ symbol: 'LINE', label: MORPION_LINE_NAMES[index] ?? '', value: index, amount })),
          true,
        ),
      ]),
    ];
  },

  evaluate(zones) {
    const morpion = zoneById(zones, 'morpion');
    const grid = groupById(morpion, 'grille').cells;
    const gains = groupById(morpion, 'gains').cells;
    const lines = winningLines(grid.map((cell) => cell.symbol));
    const lineCells = gains.filter((cell) => cell.value !== null && lines.includes(cell.value));
    const total = lineCells.reduce((sum, cell) => sum + (cell.amount ?? 0), 0);
    if (total === 0) return ticketEvaluation([zoneResult('morpion', 0, 'Aucun alignement')]);
    const marks = [...new Set(lines.flatMap((line) => [...(MORPION_LINES[line] ?? [])]))].map((index) => grid[index]?.id ?? '');
    const detail = lineCells.map((cell) => cell.label).join(' + ');
    return ticketEvaluation([zoneResult('morpion', total, `${detail} alignée`, [...marks, ...lineCells.map((cell) => cell.id)])]);
  },
};
