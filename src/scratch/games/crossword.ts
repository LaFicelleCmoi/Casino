import { InvariantViolation, chips, invariant, shuffle, type RandomSource } from '../../core/index.js';
import { prizeTable } from '../prizes.js';
import type { CrosswordBoard, PlacedWord, ScratchGameDefinition, TicketTypeId, WordDirection } from '../types/ticket.js';
import { FRENCH_WORDS } from './french-words.js';
import { cellsOf, formatAmount, group, ticketEvaluation, zone, zoneById, zoneResult } from './helpers.js';

/** Fréquence des lettres en français (‰) : les lettres du joueur ressemblent à celles d'un vrai ticket. */
const LETTER_FREQUENCIES: readonly (readonly [string, number])[] = [
  ['E', 121], ['S', 79], ['A', 76], ['I', 75], ['T', 72], ['N', 71], ['R', 66], ['U', 63], ['L', 55], ['O', 54],
  ['D', 37], ['C', 33], ['M', 30], ['P', 30], ['V', 16], ['G', 11], ['F', 11], ['B', 10], ['H', 9], ['Q', 9],
  ['J', 5], ['X', 4], ['Y', 3], ['Z', 2], ['K', 1], ['W', 1],
];

const MAX_ATTEMPTS = 400;
const CANDIDATES_PER_WORD = 120;

export interface CrosswordSpec {
  readonly type: TicketTypeId;
  readonly name: string;
  readonly tagline: string;
  readonly price: number;
  readonly serialPrefix: string;
  readonly letterCount: number;
  readonly letterColumns: number;
  readonly wordCount: number;
  readonly width: number;
  readonly height: number;
  /** Nombre maximal de mots complets sur un ticket perdant. */
  readonly loseMaxWords: number;
  readonly loseWeight: number;
  /** [mots complets, gain, poids]. */
  readonly tiers: readonly (readonly [words: number, amount: number, weight: number])[];
}

const key = (row: number, column: number): string => `${row},${column}`;

/** Case (ligne, colonne) de chaque lettre d'un mot placé. */
export function wordCells(placed: PlacedWord): { row: number; column: number; letter: string }[] {
  const down = placed.direction === 'DOWN';
  return [...placed.word].map((letter, i) => ({ row: placed.row + (down ? i : 0), column: placed.column + (down ? 0 : i), letter }));
}

function drawLetters(rng: RandomSource, count: number): string[] {
  const pool = [...LETTER_FREQUENCIES];
  const letters: string[] = [];
  while (letters.length < count) {
    let roll = rng.nextInt(pool.reduce((sum, [, weight]) => sum + weight, 0));
    const index = pool.findIndex(([, weight]) => (roll -= weight) < 0);
    const [entry] = pool.splice(index, 1);
    invariant(entry !== undefined, 'Tirage de lettre impossible');
    letters.push(entry[0]);
  }
  return letters;
}

type Grid = Map<string, string>;

/** Règles classiques : lettres communes identiques, pas de mot collé à un autre, au moins un croisement. */
function canPlace(grid: Grid, width: number, height: number, candidate: PlacedWord): boolean {
  const { word, row, column, direction } = candidate;
  const dr = direction === 'DOWN' ? 1 : 0;
  const dc = 1 - dr;
  const endRow = row + dr * (word.length - 1);
  const endColumn = column + dc * (word.length - 1);
  if (row < 0 || column < 0 || endRow >= height || endColumn >= width) return false;
  if (grid.has(key(row - dr, column - dc)) || grid.has(key(endRow + dr, endColumn + dc))) return false;

  let crossings = 0;
  for (let i = 0; i < word.length; i += 1) {
    const r = row + dr * i;
    const c = column + dc * i;
    const existing = grid.get(key(r, c));
    if (existing !== undefined) {
      if (existing !== word[i]) return false;
      crossings += 1;
    } else if (grid.has(key(r + dc, c + dr)) || grid.has(key(r - dc, c - dr))) {
      return false;
    }
  }
  return crossings > 0 && crossings < word.length;
}

function crossingPlacements(rng: RandomSource, placed: readonly PlacedWord[], word: string): PlacedWord[] {
  const options: PlacedWord[] = [];
  for (const other of placed) {
    const direction: WordDirection = other.direction === 'ACROSS' ? 'DOWN' : 'ACROSS';
    [...other.word].forEach((letter, i) => {
      [...word].forEach((candidate, j) => {
        if (candidate !== letter) return;
        options.push(
          direction === 'DOWN'
            ? { word, row: other.row - j, column: other.column + i, direction }
            : { word, row: other.row + i, column: other.column - j, direction },
        );
      });
    });
  }
  return shuffle(options, rng);
}

/** Place `wordCount` mots croisés : exactement `goodCount` pris dans `good`, les autres dans `bad`. */
function buildBoard(rng: RandomSource, spec: CrosswordSpec, good: readonly string[], bad: readonly string[], goodCount: number): CrosswordBoard | null {
  const grid: Grid = new Map();
  const words: PlacedWord[] = [];
  const kinds = shuffle(Array.from({ length: spec.wordCount }, (_, i) => i < goodCount), rng);

  for (const isGood of kinds) {
    const used = new Set(words.map((placed) => placed.word));
    const candidates = shuffle((isGood ? good : bad).filter((word) => !used.has(word) && word.length <= Math.max(spec.width, spec.height)), rng);
    let chosen: PlacedWord | null = null;
    for (const word of candidates.slice(0, CANDIDATES_PER_WORD)) {
      if (words.length === 0) {
        if (word.length > spec.width) continue;
        chosen = { word, row: Math.floor(spec.height / 2), column: rng.nextInt(spec.width - word.length + 1), direction: 'ACROSS' };
      } else {
        chosen = crossingPlacements(rng, words, word).find((option) => canPlace(grid, spec.width, spec.height, option)) ?? null;
      }
      if (chosen !== null) break;
    }
    if (chosen === null) return null;
    words.push(chosen);
    for (const { row, column, letter } of wordCells(chosen)) grid.set(key(row, column), letter);
  }
  return { width: spec.width, height: spec.height, words };
}

/** Mots de la grille entièrement composés des lettres du joueur. */
export function completedWords(board: CrosswordBoard, letters: ReadonlySet<string>): number[] {
  return board.words.flatMap((placed, index) => ([...placed.word].every((letter) => letters.has(letter)) ? [index] : []));
}

export function crosswordGame(spec: CrosswordSpec): ScratchGameDefinition {
  const tiers = [...spec.tiers].sort(([a], [b]) => a - b);
  invariant(tiers.every(([words]) => words > spec.loseMaxWords && words <= spec.wordCount), `Paliers incohérents pour ${spec.name}`);
  const ruleText = tiers.map(([words, amount]) => `${words} mots : ${formatAmount(amount)}`).join(' · ');

  return {
    type: spec.type,
    name: spec.name,
    tagline: spec.tagline,
    price: chips(spec.price),
    serialPrefix: spec.serialPrefix,
    prizes: prizeTable(
      spec.loseWeight,
      tiers.map(([, amount, weight]) => [amount, weight] as const),
    ),

    generate(rng, prize) {
      const tier = tiers.find(([, amount]) => amount === prize);
      invariant(prize === 0 || tier !== undefined, `Gain ${prize} absent du plan de lots ${spec.name}`);
      const goodCount = tier === undefined ? rng.nextInt(spec.loseMaxWords + 1) : tier[0];

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const letters = drawLetters(rng, spec.letterCount);
        const available = new Set(letters);
        const good = FRENCH_WORDS.filter((word) => [...word].every((letter) => available.has(letter)));
        const bad = FRENCH_WORDS.filter((word) => ![...word].every((letter) => available.has(letter)));
        if (good.length < goodCount || bad.length < spec.wordCount - goodCount) continue;
        const board = buildBoard(rng, spec, good, bad, goodCount);
        if (board === null) continue;
        return [
          zone('lettres', 'Vos lettres', 'Grattez vos lettres : chaque mot de la grille entièrement composé de vos lettres compte.', [
            group('lettres', 'lettres', `${spec.letterCount} lettres`, spec.letterColumns, shuffle(letters, rng).map((letter) => ({ symbol: 'LETTER', label: letter }))),
          ]),
          zone('grille', 'La grille', ruleText, [], board),
        ];
      }
      throw new InvariantViolation(`Impossible d'imprimer une grille ${spec.name} à ${goodCount} mots`);
    },

    evaluate(zones) {
      const letters = new Set(cellsOf(zoneById(zones, 'lettres')).map((cell) => cell.label));
      const board = zoneById(zones, 'grille').board;
      invariant(board !== null, 'Grille de mots croisés absente');
      const completed = completedWords(board, letters);
      const reached = tiers.filter(([words]) => words <= completed.length).at(-1);
      const detail = `${completed.length} mot${completed.length > 1 ? 's' : ''} complet${completed.length > 1 ? 's' : ''}`;
      return ticketEvaluation([
        zoneResult('grille', reached === undefined ? 0 : reached[1], detail, completed.map((index) => `word:${index}`)),
      ]);
    },
  };
}

export const MOTS_CROISES = crosswordGame({
  type: 'MOTS_CROISES',
  name: 'Mots Croisés',
  tagline: '18 lettres · 10 mots · reconstituez le plus de mots possible',
  price: 3,
  serialPrefix: 'MCR',
  letterCount: 18,
  letterColumns: 6,
  wordCount: 10,
  width: 11,
  height: 9,
  loseMaxWords: 2,
  loseWeight: 789_795,
  tiers: [
    [3, 3, 120_000],
    [4, 6, 60_000],
    [5, 15, 20_000],
    [6, 30, 8_000],
    [7, 100, 2_000],
    [8, 1_000, 200],
    [9, 20_000, 5],
  ],
});

export const MAXI_MOTS_CROISES = crosswordGame({
  type: 'MAXI_MOTS_CROISES',
  name: 'Maxi Mots Croisés',
  tagline: '20 lettres · 12 mots · la grille XL',
  price: 5,
  serialPrefix: 'MMC',
  letterCount: 20,
  letterColumns: 10,
  wordCount: 12,
  width: 12,
  height: 10,
  loseMaxWords: 3,
  loseWeight: 787_896,
  tiers: [
    [4, 5, 120_000],
    [5, 10, 60_000],
    [6, 25, 20_000],
    [7, 50, 10_000],
    [8, 200, 2_000],
    [9, 2_000, 100],
    [11, 50_000, 4],
  ],
});

export const MEGA_MOTS_CROISES = crosswordGame({
  type: 'MEGA_MOTS_CROISES',
  name: 'Mega Mots Croisés',
  tagline: '22 lettres · 14 mots · jusqu’à 250 000 jetons',
  price: 10,
  serialPrefix: 'MGC',
  letterCount: 22,
  letterColumns: 11,
  wordCount: 14,
  width: 13,
  height: 11,
  loseMaxWords: 4,
  loseWeight: 8_078_980,
  tiers: [
    [5, 10, 1_000_000],
    [6, 20, 600_000],
    [7, 50, 200_000],
    [8, 100, 100_000],
    [9, 500, 20_000],
    [10, 5_000, 1_000],
    [13, 250_000, 20],
  ],
});
