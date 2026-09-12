import { chips, shuffle, type RandomSource } from '../../core/index.js';
import { lotTable } from '../prizes.js';
import type { ScratchGameDefinition, ScratchZone } from '../types/ticket.js';
import {
  amountCell,
  chooseDecomposition,
  decoyAmount,
  firstCell,
  group,
  groupById,
  partsFor,
  pick,
  randomInt,
  range,
  sample,
  sampleWithCap,
  ticketEvaluation,
  zone,
  zoneById,
  zoneResult,
  type CellData,
  type PrizeSlot,
} from './helpers.js';

const AMOUNTS = [3, 6, 9, 15, 50, 100, 1_000, 50_000];
const SLOTS: readonly PrizeSlot[] = [
  { id: 'roulette', capacity: 3, amounts: AMOUNTS },
  { id: 'jackpot', capacity: 3, amounts: AMOUNTS },
  { id: 'duel', capacity: 1, amounts: AMOUNTS },
  { id: 'craps', capacity: 1, amounts: AMOUNTS },
  { id: 'bonus', capacity: 1, amounts: AMOUNTS },
];
/** Numéros de la roulette selon le règlement : de 1 à 36, sauf 3, 6, 9 et 15. */
export const VEGAS_NUMBERS = range(1, 36).filter((n) => ![3, 6, 9, 15].includes(n));
export const CARD_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R', 'AS'] as const;
export const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'] as const;
const REELS = [
  ['SEPT', '7️⃣'],
  ['CERISE', '🍒'],
  ['CLOCHE', '🔔'],
  ['BAR', 'BAR'],
  ['DIAMANT', '💎'],
  ['CITRON', '🍋'],
] as const;
const DICE_PAIRS = range(1, 6).flatMap((a) => range(1, 6).map((b) => [a, b] as const));

const cardCell = (rank: number): CellData => ({ symbol: 'CARTE', label: CARD_RANKS[rank] ?? '?', value: rank });

function rouletteZone(rng: RandomSource, wins: readonly number[]): ScratchZone {
  const winning = sample(rng, VEGAS_NUMBERS, 4);
  const hits = sample(rng, winning, wins.length);
  const misses = sample(rng, VEGAS_NUMBERS.filter((n) => !winning.includes(n)), 3 - wins.length);
  const chipsOnTable = shuffle(
    [
      ...hits.map((n, index): CellData => ({ symbol: 'NUMBER', label: String(n), value: n, amount: wins[index] ?? 0 })),
      ...misses.map((n): CellData => ({ symbol: 'NUMBER', label: String(n), value: n, amount: decoyAmount(rng, AMOUNTS) })),
    ],
    rng,
  );
  return zone('roulette', 'Roulette', 'Un numéro sous vos jetons est un numéro gagnant : vous remportez la somme associée ; les gains se cumulent.', [
    group('roulette', 'gagnants', 'Numéros gagnants', 4, winning.map((n) => ({ symbol: 'WINNING_NUMBER', label: String(n), value: n }))),
    group('roulette', 'mises', 'Vos mises', 3, chipsOnTable),
  ]);
}

function jackpotZone(rng: RandomSource, wins: readonly number[]): ScratchZone {
  const winners = sample(rng, range(0, 2), wins.length);
  const lines = range(0, 2).map((index) => {
    const win = wins[winners.indexOf(index)];
    let reels: (typeof REELS)[number][];
    if (win !== undefined) {
      const symbol = pick(rng, REELS);
      reels = [symbol, symbol, symbol];
    } else {
      reels = sampleWithCap(rng, REELS, 2, 3);
    }
    return group('jackpot', `ligne-${index + 1}`, `Ligne ${index + 1}`, 4, [
      ...reels.map(([symbol, label]) => ({ symbol, label })),
      amountCell(win ?? decoyAmount(rng, AMOUNTS)),
    ]);
  });
  return zone('jackpot', 'Jackpot', 'Trois symboles identiques sur une même ligne : vous remportez la somme de cette ligne.', lines);
}

function duelZone(rng: RandomSource, win: number | undefined): ScratchZone {
  let bank: number;
  let cards: number[];
  if (win !== undefined) {
    bank = randomInt(rng, 0, CARD_RANKS.length - 2);
    cards = shuffle([randomInt(rng, bank + 1, CARD_RANKS.length - 1), randomInt(rng, 0, CARD_RANKS.length - 1), randomInt(rng, 0, CARD_RANKS.length - 1)], rng);
  } else {
    bank = randomInt(rng, 2, CARD_RANKS.length - 1);
    cards = [0, 1, 2].map(() => randomInt(rng, 0, bank));
  }
  return zone('duel', 'Duel', 'Une de vos cartes est plus forte que celle de la Banque : vous remportez le GAIN.', [
    group('duel', 'banque', 'Banque', 1, [cardCell(bank)]),
    group('duel', 'cartes', 'Vos cartes', 3, cards.map(cardCell)),
    group('duel', 'gain', 'GAIN', 1, [amountCell(win ?? decoyAmount(rng, AMOUNTS))]),
  ]);
}

function crapsZone(rng: RandomSource, win: number | undefined): ScratchZone {
  const dice = pick(rng, DICE_PAIRS.filter(([a, b]) => (a + b === 7) === (win !== undefined)));
  return zone('craps', 'Craps', 'Les deux dés totalisent 7 : vous remportez le GAIN.', [
    group('craps', 'des', 'Les dés', 2, dice.map((face) => ({ symbol: 'DIE', label: DICE_FACES[face - 1] ?? '?', value: face }))),
    group('craps', 'gain', 'GAIN', 1, [amountCell(win ?? decoyAmount(rng, AMOUNTS))]),
  ]);
}

/** Vegas, d'après le règlement FDJ : 5 jeux indépendants (Roulette, Jackpot, Duel, Craps, Bonus) aux gains cumulables. */
export const VEGAS: ScratchGameDefinition = {
  type: 'VEGAS',
  name: 'Vegas',
  tagline: '5 jeux : Roulette, Jackpot, Duel, Craps et Bonus · jusqu’à 50 000',
  price: chips(3),
  serialPrefix: 'VGS',
  prizes: lotTable(2_000_000, [
    [2, 50_000],
    [20, 1_000],
    [300, 100],
    [14_400, 50],
    [50_000, 15],
    [100_000, 9],
    [200_000, 6],
    [160_000, 3],
  ]),

  generate(rng, prize) {
    const parts = chooseDecomposition(rng, prize, SLOTS, 3);
    return [
      rouletteZone(rng, partsFor(parts, 'roulette')),
      jackpotZone(rng, partsFor(parts, 'jackpot')),
      duelZone(rng, partsFor(parts, 'duel')[0]),
      crapsZone(rng, partsFor(parts, 'craps')[0]),
      zone('bonus', 'Bonus', 'Une somme autre que 0 sous le Bonus : elle est à vous.', [
        group('bonus', 'bonus', 'BONUS', 1, [amountCell(partsFor(parts, 'bonus')[0] ?? 0)]),
      ]),
    ];
  },

  evaluate(zones) {
    const roulette = zoneById(zones, 'roulette');
    const winning = new Set(groupById(roulette, 'gagnants').cells.map((cell) => cell.value));
    const hits = groupById(roulette, 'mises').cells.filter((cell) => winning.has(cell.value));
    const rouletteWin = hits.reduce((sum, cell) => sum + (cell.amount ?? 0), 0);

    const jackpot = zoneById(zones, 'jackpot');
    const lines = jackpot.groups.filter((line) => {
      const reels = line.cells.filter((cell) => cell.symbol !== 'AMOUNT');
      return reels.length === 3 && reels.every((cell) => cell.symbol === reels[0]?.symbol);
    });
    const jackpotWin = lines.reduce((sum, line) => sum + (line.cells.find((cell) => cell.symbol === 'AMOUNT')?.amount ?? 0), 0);

    const duel = zoneById(zones, 'duel');
    const bank = firstCell(duel, 'banque');
    const stronger = groupById(duel, 'cartes').cells.filter((cell) => (cell.value ?? 0) > (bank.value ?? 0));
    const duelGain = firstCell(duel, 'gain');
    const duelWin = stronger.length > 0 ? (duelGain.amount ?? 0) : 0;

    const craps = zoneById(zones, 'craps');
    const dice = groupById(craps, 'des').cells;
    const total = dice.reduce((sum, cell) => sum + (cell.value ?? 0), 0);
    const crapsGain = firstCell(craps, 'gain');
    const crapsWin = total === 7 ? (crapsGain.amount ?? 0) : 0;

    const bonus = firstCell(zoneById(zones, 'bonus'), 'bonus');
    const bonusWin = bonus.amount ?? 0;

    return ticketEvaluation([
      zoneResult('roulette', rouletteWin, rouletteWin > 0 ? `${hits.length} mise${hits.length > 1 ? 's' : ''} gagnante${hits.length > 1 ? 's' : ''}` : 'Aucun numéro gagnant', hits.map((cell) => cell.id)),
      zoneResult('jackpot', jackpotWin, jackpotWin > 0 ? 'Trois symboles alignés' : 'Aucune ligne complète', lines.flatMap((line) => line.cells.map((cell) => cell.id))),
      zoneResult('duel', duelWin, duelWin > 0 ? `Vous battez la Banque (${bank.label})` : `La Banque (${bank.label}) l’emporte`, duelWin > 0 ? [...stronger.map((cell) => cell.id), duelGain.id] : []),
      zoneResult('craps', crapsWin, `Total des dés : ${total}`, crapsWin > 0 ? [...dice.map((cell) => cell.id), crapsGain.id] : []),
      zoneResult('bonus', bonusWin, bonusWin > 0 ? 'Bonus gagnant' : 'Bonus à 0', bonusWin > 0 ? [bonus.id] : []),
    ]);
  },
};
