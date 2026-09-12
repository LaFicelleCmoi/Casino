import { InvariantViolation, chips, invariant, shuffle, type RandomSource } from '../../core/index.js';
import { lotTable } from '../prizes.js';
import type { CrosswordBoard, PlacedWord, ScratchGameDefinition, ScratchZone, WordDirection, ZoneResult } from '../types/ticket.js';
import { FRENCH_WORDS } from './french-words.js';
import {
  amountCell,
  cellsOf,
  chooseDecomposition,
  decoyAmount,
  formatAmount,
  group,
  groupById,
  partsFor,
  pick,
  sample,
  ticketEvaluation,
  zone,
  zoneById,
  zoneResult,
  type PrizeSlot,
} from './helpers.js';

/** Fréquence des lettres en français (‰), adoucie au tirage pour garder des grilles variées. */
const LETTER_FREQUENCIES: readonly (readonly [string, number])[] = [
  ['E', 121], ['S', 79], ['A', 76], ['I', 75], ['T', 72], ['N', 71], ['R', 66], ['U', 63], ['L', 55], ['O', 54],
  ['D', 37], ['C', 33], ['M', 30], ['P', 30], ['V', 16], ['G', 11], ['F', 11], ['B', 10], ['H', 9], ['Q', 9],
  ['J', 5], ['X', 4], ['Y', 3], ['Z', 2], ['K', 1], ['W', 1],
];

const MAX_ATTEMPTS = 400;
const BOARD_ATTEMPTS = 6;
const CANDIDATES_PER_WORD = 120;

export interface GridSpec {
  readonly wordCount: number;
  readonly width: number;
  readonly height: number;
}

/** Barème d'une grille : [mots entièrement reconstitués, gain]. */
type Bareme = readonly (readonly [words: number, amount: number])[];

const key = (row: number, column: number): string => `${row},${column}`;

/** Case (ligne, colonne) de chaque lettre d'un mot placé. */
export function wordCells(placed: PlacedWord): { row: number; column: number; letter: string }[] {
  const down = placed.direction === 'DOWN';
  return [...placed.word].map((letter, i) => ({ row: placed.row + (down ? i : 0), column: placed.column + (down ? 0 : i), letter }));
}

/** `count` lettres distinctes, tirées selon la fréquence adoucie des lettres françaises. */
export function drawLetters(rng: RandomSource, count: number): string[] {
  const pool = LETTER_FREQUENCIES.map(([letter, weight]) => [letter, Math.max(1, Math.round(weight ** 0.6))] as [string, number]);
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

const isWritable = (word: string, letters: ReadonlySet<string>): boolean => [...word].every((letter) => letters.has(letter));

type Grid = Map<string, string>;

/** Règles classiques : lettres communes identiques, pas de mot collé à un autre, au moins un croisement. */
function canPlace(grid: Grid, spec: GridSpec, candidate: PlacedWord): boolean {
  const { word, row, column, direction } = candidate;
  const dr = direction === 'DOWN' ? 1 : 0;
  const dc = 1 - dr;
  const endRow = row + dr * (word.length - 1);
  const endColumn = column + dc * (word.length - 1);
  if (row < 0 || column < 0 || endRow >= spec.height || endColumn >= spec.width) return false;
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
function buildBoard(rng: RandomSource, spec: GridSpec, good: readonly string[], bad: readonly string[], goodCount: number): CrosswordBoard | null {
  const grid: Grid = new Map();
  const words: PlacedWord[] = [];
  const kinds = shuffle(Array.from({ length: spec.wordCount }, (_, i) => i < goodCount), rng);

  for (const isGood of kinds) {
    const used = new Set(words.map((placed) => placed.word));
    const candidates = shuffle((isGood ? good : bad).filter((word) => !used.has(word)), rng);
    let chosen: PlacedWord | null = null;
    for (const word of candidates.slice(0, CANDIDATES_PER_WORD)) {
      if (words.length === 0) {
        if (word.length > spec.width) continue;
        chosen = { word, row: Math.floor(spec.height / 2), column: rng.nextInt(spec.width - word.length + 1), direction: 'ACROSS' };
      } else {
        chosen = crossingPlacements(rng, words, word).find((option) => canPlace(grid, spec, option)) ?? null;
      }
      if (chosen !== null) break;
    }
    if (chosen === null) return null;
    words.push(chosen);
    for (const { row, column, letter } of wordCells(chosen)) grid.set(key(row, column), letter);
  }
  return { width: spec.width, height: spec.height, words };
}

/** Grille dont exactement `goodCount` mots s'écrivent avec `letters`, ou null si ces lettres ne le permettent pas. */
export function printGrid(rng: RandomSource, letters: readonly string[], spec: GridSpec, goodCount: number): CrosswordBoard | null {
  const available = new Set(letters);
  const fitting = FRENCH_WORDS.filter((word) => Math.max(spec.width, spec.height) >= word.length);
  const good = fitting.filter((word) => isWritable(word, available));
  const bad = fitting.filter((word) => !isWritable(word, available));
  if (good.length < goodCount || bad.length < spec.wordCount - goodCount) return null;
  for (let attempt = 0; attempt < BOARD_ATTEMPTS; attempt += 1) {
    const board = buildBoard(rng, spec, good, bad, goodCount);
    if (board !== null) return board;
  }
  return null;
}

/** Mots de la grille entièrement reconstitués avec les lettres du joueur. */
export function completedWords(board: CrosswordBoard, letters: ReadonlySet<string>): number[] {
  return board.words.flatMap((placed, index) => (isWritable(placed.word, letters) ? [index] : []));
}

function amountForWords(bareme: Bareme, words: number): number {
  let amount = 0;
  for (const [count, value] of bareme) if (words >= count) amount = value;
  return amount;
}

function wordsForAmount(bareme: Bareme, amount: number): number {
  const tier = bareme.find(([, value]) => value === amount);
  invariant(tier !== undefined, `Gain ${amount} absent du barème`);
  return tier[0];
}

const baremeText = (bareme: Bareme): string => bareme.map(([count, amount]) => `${count} mots : ${formatAmount(amount)}`).join(' · ');
/** Une grille perdante compte 0 ou 1 mot reconstitué. */
const losingWords = (rng: RandomSource): number => rng.nextInt(2);

function lettersZone(rng: RandomSource, zoneId: string, title: string, letters: readonly string[], columns: number): ScratchZone {
  return zone(zoneId, title, `Grattez vos ${letters.length} lettres : chacune peut servir plusieurs fois dans la grille.`, [
    group(zoneId, 'lettres', `${letters.length} lettres`, columns, shuffle(letters, rng).map((letter) => ({ symbol: 'LETTER', label: letter }))),
  ]);
}

function gridZone(zoneId: string, title: string, bareme: Bareme, board: CrosswordBoard): ScratchZone {
  return zone(zoneId, title, `Gagnant dès 2 mots entièrement reconstitués · ${baremeText(bareme)}`, [], board);
}

function lettersOf(zones: readonly ScratchZone[], zoneId: string): Set<string> {
  return new Set(cellsOf(zoneById(zones, zoneId)).map((cell) => cell.label));
}

function gridResult(zones: readonly ScratchZone[], zoneId: string, bareme: Bareme, letters: ReadonlySet<string>): ZoneResult {
  const board = zoneById(zones, zoneId).board;
  invariant(board !== null, `Grille ${zoneId} absente`);
  const completed = completedWords(board, letters);
  const plural = completed.length > 1 ? 's' : '';
  return zoneResult(
    zoneId,
    amountForWords(bareme, completed.length),
    `${completed.length} mot${plural} reconstitué${plural}`,
    completed.map((index) => `word:${index}`),
  );
}

// ─── Mots Croisés ─────────────────────────────────────────────────────────────

const MC_BAREME: Bareme = [[2, 3], [3, 6], [4, 15], [5, 30], [6, 100], [7, 500], [8, 1_000], [9, 40_000]];
const MC_GRID: GridSpec = { wordCount: 18, width: 13, height: 11 };

/** Mots Croisés, d'après le règlement FDJ : 14 lettres, une grille de 18 mots, un seul lot selon le nombre de mots. */
export const MOTS_CROISES: ScratchGameDefinition = {
  type: 'MOTS_CROISES',
  name: 'Mots Croisés',
  tagline: '14 lettres · une grille de 18 mots · gagnant dès 2 mots · jusqu’à 40 000',
  price: chips(3),
  serialPrefix: 'MCR',
  prizes: lotTable(4_500_000, [
    [3, 40_000],
    [60, 1_000],
    [251, 500],
    [9_800, 100],
    [54_340, 30],
    [115_000, 15],
    [630_000, 6],
    [320_600, 3],
  ]),

  generate(rng, prize) {
    const words = prize > 0 ? wordsForAmount(MC_BAREME, prize) : losingWords(rng);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const letters = drawLetters(rng, 14);
      const board = printGrid(rng, letters, MC_GRID, words);
      if (board !== null) return [lettersZone(rng, 'lettres', 'Vos lettres', letters, 7), gridZone('grille', 'La grille', MC_BAREME, board)];
    }
    throw new InvariantViolation(`Impossible d'imprimer une grille Mots Croisés à ${words} mots`);
  },

  evaluate(zones) {
    return ticketEvaluation([gridResult(zones, 'grille', MC_BAREME, lettersOf(zones, 'lettres'))]);
  },
};

// ─── Maxi Mots Croisés ────────────────────────────────────────────────────────

const MAXI_BAREME: Bareme = [[2, 5], [3, 10], [4, 20], [5, 50], [6, 200], [7, 1_000], [8, 10_000], [9, 125_000]];
const MAXI_GRID: GridSpec = { wordCount: 18, width: 13, height: 11 };
const MAXI_SLOTS: readonly PrizeSlot[] = [
  { id: 'grille1', capacity: 1, amounts: MAXI_BAREME.map(([, amount]) => amount) },
  { id: 'grille2', capacity: 1, amounts: MAXI_BAREME.map(([, amount]) => amount) },
];

/** Maxi Mots Croisés, d'après le règlement FDJ : 18 lettres pour 2 grilles de 18 mots ; les gains des deux grilles se cumulent. */
export const MAXI_MOTS_CROISES: ScratchGameDefinition = {
  type: 'MAXI_MOTS_CROISES',
  name: 'Maxi Mots Croisés',
  tagline: '18 lettres · 2 grilles de 18 mots · gains cumulables · jusqu’à 250 000',
  price: chips(5),
  serialPrefix: 'MMC',
  prizes: lotTable(4_500_000, [
    [2, 250_000],
    [5, 10_000],
    [60, 1_000],
    [9_000, 200],
    [60_000, 50],
    [111_990, 20],
    [45_000, 15],
    [517_520, 10],
    [450_000, 5],
  ]),

  generate(rng, prize) {
    const parts = chooseDecomposition(rng, prize, MAXI_SLOTS, 2);
    const wordsIn = (slot: string): number => {
      const [amount] = partsFor(parts, slot);
      return amount === undefined ? losingWords(rng) : wordsForAmount(MAXI_BAREME, amount);
    };
    const words1 = wordsIn('grille1');
    const words2 = wordsIn('grille2');
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const letters = drawLetters(rng, 18);
      const first = printGrid(rng, letters, MAXI_GRID, words1);
      const second = first === null ? null : printGrid(rng, letters, MAXI_GRID, words2);
      if (first === null || second === null) continue;
      return [
        lettersZone(rng, 'lettres', 'Vos lettres', letters, 9),
        gridZone('grille1', 'Grille 1', MAXI_BAREME, first),
        gridZone('grille2', 'Grille 2', MAXI_BAREME, second),
      ];
    }
    throw new InvariantViolation(`Impossible d'imprimer un Maxi Mots Croisés à ${words1} et ${words2} mots`);
  },

  evaluate(zones) {
    const letters = lettersOf(zones, 'lettres');
    return ticketEvaluation([gridResult(zones, 'grille1', MAXI_BAREME, letters), gridResult(zones, 'grille2', MAXI_BAREME, letters)]);
  },
};

// ─── Méga Mots Croisés ────────────────────────────────────────────────────────

const MEGA_BAREME: Bareme = [[2, 10], [3, 20], [4, 50], [5, 100], [6, 200], [7, 2_000], [8, 20_000], [9, 600_000]];
const MEGA_GRID: GridSpec = { wordCount: 27, width: 17, height: 13 };
const MYSTERY_AMOUNTS = [10, 20, 50, 200, 2_000];
const SIX_WORDS_AMOUNTS = [10, 20, 50, 100, 200, 20_000];
const MEGA_SLOTS: readonly PrizeSlot[] = [
  { id: 'jeu1', capacity: 1, amounts: MEGA_BAREME.map(([, amount]) => amount) },
  { id: 'jeu2', capacity: 2, amounts: MYSTERY_AMOUNTS },
  { id: 'jeu3', capacity: 1, amounts: SIX_WORDS_AMOUNTS },
];
const isMysteryLength = (word: string): boolean => word.length >= 4 && word.length <= 6;

/**
 * Méga Mots Croisés, d'après le règlement FDJ. Jeu 1 : 20 lettres, grille de 27 mots. Jeu 2 : deux mots mystères,
 * gagnants s'ils figurent dans la grille. Jeu 3 : 14 autres lettres pour reconstituer l'un des 6 mots imprimés.
 */
export const MEGA_MOTS_CROISES: ScratchGameDefinition = {
  type: 'MEGA_MOTS_CROISES',
  name: 'Méga Mots Croisés',
  tagline: '20 lettres · grille de 27 mots · 2 jeux bonus · jusqu’à 600 000',
  price: chips(10),
  serialPrefix: 'MGC',
  prizes: lotTable(6_000_000, [
    [2, 600_000],
    [5, 20_000],
    [20, 2_000],
    [2_500, 200],
    [66_700, 100],
    [173_800, 50],
    [800_000, 20],
    [1_000_000, 10],
  ]),

  generate(rng, prize) {
    const parts = chooseDecomposition(rng, prize, MEGA_SLOTS, 3);
    const [jeu1Amount] = partsFor(parts, 'jeu1');
    const mysteryWins = partsFor(parts, 'jeu2');
    const [sixWordsWin] = partsFor(parts, 'jeu3');
    const gridWords = jeu1Amount === undefined ? losingWords(rng) : wordsForAmount(MEGA_BAREME, jeu1Amount);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const letters = drawLetters(rng, 20);
      const board = printGrid(rng, letters, MEGA_GRID, gridWords);
      if (board === null) continue;

      const onBoard = new Set(board.words.map((placed) => placed.word));
      const inGrid = shuffle([...onBoard].filter(isMysteryLength), rng);
      const offGrid = FRENCH_WORDS.filter((word) => isMysteryLength(word) && !onBoard.has(word));
      if (inGrid.length < mysteryWins.length || offGrid.length < 2) continue;
      const mysteries = shuffle(
        [0, 1].map((index) => {
          const win = mysteryWins[index];
          return win === undefined ? { word: pick(rng, offGrid), amount: decoyAmount(rng, MYSTERY_AMOUNTS) } : { word: inGrid[index] ?? '', amount: win };
        }),
        rng,
      );
      if (mysteries[0]?.word === mysteries[1]?.word) continue;

      const bonusLetters = drawLetters(rng, 14);
      const bonusAvailable = new Set(bonusLetters);
      const writable = FRENCH_WORDS.filter((word) => isWritable(word, bonusAvailable));
      const unwritable = FRENCH_WORDS.filter((word) => !isWritable(word, bonusAvailable));
      if ((sixWordsWin !== undefined && writable.length === 0) || unwritable.length < 6) continue;
      const sixWords = shuffle(
        [
          ...(sixWordsWin === undefined ? [] : [{ word: pick(rng, writable), amount: sixWordsWin }]),
          ...sample(rng, unwritable, sixWordsWin === undefined ? 6 : 5).map((word) => ({ word, amount: decoyAmount(rng, SIX_WORDS_AMOUNTS) })),
        ],
        rng,
      );

      return [
        lettersZone(rng, 'lettres', 'Jeu 1 · Vos lettres', letters, 10),
        gridZone('grille', 'Jeu 1 · La grille', MEGA_BAREME, board),
        zone(
          'mysteres',
          'Jeu 2 · Les mots mystères',
          'Un mot mystère figure dans la grille du Jeu 1 : vous remportez le gain associé ; les deux mots se cumulent.',
          mysteries.map((mystery, index) =>
            group('mysteres', `mot-${index + 1}`, `Mot ${index + 1}`, 2, [{ symbol: 'MOT', label: mystery.word }, amountCell(mystery.amount)]),
          ),
        ),
        zone('six-mots', 'Jeu 3 · Les six mots', 'Grattez 14 nouvelles lettres : un des six mots entièrement reconstitué rapporte la somme indiquée.', [
          group('six-mots', 'lettres', '14 lettres', 7, shuffle(bonusLetters, rng).map((letter) => ({ symbol: 'LETTRE_BONUS', label: letter }))),
          group('six-mots', 'mots', 'Les six mots', 2, sixWords.map(({ word, amount }) => ({ symbol: 'MOT_BONUS', label: word, amount })), true),
        ]),
      ];
    }
    throw new InvariantViolation(`Impossible d'imprimer un Méga Mots Croisés pour un lot de ${prize}`);
  },

  evaluate(zones) {
    const board = zoneById(zones, 'grille').board;
    invariant(board !== null, 'Grille du Jeu 1 absente');
    const onBoard = new Set(board.words.map((placed) => placed.word));

    const mysteries = zoneById(zones, 'mysteres').groups.filter((mystery) => {
      const word = mystery.cells.find((cell) => cell.symbol === 'MOT');
      return word !== undefined && onBoard.has(word.label);
    });
    const mysteriesWin = mysteries.reduce((sum, mystery) => sum + (mystery.cells.find((cell) => cell.symbol === 'AMOUNT')?.amount ?? 0), 0);

    const sixWords = zoneById(zones, 'six-mots');
    const bonusLetters = new Set(groupById(sixWords, 'lettres').cells.map((cell) => cell.label));
    const rebuilt = groupById(sixWords, 'mots').cells.filter((cell) => isWritable(cell.label, bonusLetters));
    const sixWordsWin = rebuilt.reduce((sum, cell) => sum + (cell.amount ?? 0), 0);

    return ticketEvaluation([
      gridResult(zones, 'grille', MEGA_BAREME, lettersOf(zones, 'lettres')),
      zoneResult(
        'mysteres',
        mysteriesWin,
        mysteriesWin > 0 ? `${mysteries.length} mot${mysteries.length > 1 ? 's' : ''} trouvé${mysteries.length > 1 ? 's' : ''} dans la grille` : 'Aucun mot mystère dans la grille',
        mysteries.flatMap((mystery) => mystery.cells.map((cell) => cell.id)),
      ),
      zoneResult('six-mots', sixWordsWin, sixWordsWin > 0 ? `${rebuilt.map((cell) => cell.label).join(', ')} reconstitué` : 'Aucun mot reconstitué', rebuilt.map((cell) => cell.id)),
    ]);
  },
};
