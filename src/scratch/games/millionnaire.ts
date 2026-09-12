import { chips, shuffle, type RandomSource } from '../../core/index.js';
import { lotTable } from '../prizes.js';
import type { ScratchGameDefinition, ScratchZone } from '../types/ticket.js';
import {
  amountCell,
  bySymbol,
  cellsOf,
  chooseDecomposition,
  decoyAmount,
  firstTwo,
  group,
  groupById,
  partsFor,
  pick,
  randomInt,
  range,
  sample,
  ticketEvaluation,
  zone,
  zoneById,
  zoneResult,
  type CellData,
  type PrizeSlot,
} from './helpers.js';

const AMOUNTS = [10, 20, 50, 100, 150, 1_000, 10_000, 100_000, 1_000_000];
const SLOTS: readonly PrizeSlot[] = [
  { id: 'roue', capacity: 6, amounts: AMOUNTS },
  { id: 'lingots', capacity: 1, amounts: AMOUNTS },
  { id: 'pierres', capacity: 3, amounts: AMOUNTS },
  { id: 'pieces', capacity: 6, amounts: AMOUNTS },
];
const WHEEL_SYMBOLS = [
  ['COURONNE', '👑'],
  ['TREFLE', '🍀'],
  ['ETOILE', '⭐'],
  ['CLOCHE', '🔔'],
  ['DIAMANT', '💎'],
  ['CERISE', '🍒'],
] as const;
const COIN_SYMBOLS = [
  ['PIECE', '🪙'],
  ['ETOILE', '⭐'],
  ['TREFLE', '🍀'],
] as const;
const BAG = 'SAC';

/** Jeu 1 : 6 segments de 3 étoiles ; deux symboles identiques dans un segment gagnent son GAIN. */
function wheelZone(rng: RandomSource, wins: readonly number[]): ScratchZone {
  const winners = sample(rng, range(0, 5), wins.length);
  const groups = range(0, 5).map((index) => {
    const win = wins[winners.indexOf(index)];
    let symbols: (typeof WHEEL_SYMBOLS)[number][];
    if (win !== undefined) {
      const [pair, single] = firstTwo(sample(rng, WHEEL_SYMBOLS, 2));
      symbols = shuffle([pair, pair, single], rng);
    } else {
      symbols = sample(rng, WHEEL_SYMBOLS, 3);
    }
    return group('roue', `segment-${index + 1}`, `Segment ${index + 1}`, 4, [
      ...symbols.map(([symbol, label]) => ({ symbol, label })),
      amountCell(win ?? decoyAmount(rng, AMOUNTS)),
    ]);
  });
  return zone('roue', 'Jeu 1 · La roue', 'Dans un même segment, deux symboles identiques : vous remportez le GAIN de ce segment.', groups);
}

/** Jeu 2 : 8 lingots ; deux sommes identiques gagnent cette somme. */
function barsZone(rng: RandomSource, win: number | undefined): ScratchZone {
  const amounts =
    win !== undefined ? shuffle([win, win, ...sample(rng, AMOUNTS.filter((amount) => amount !== win), 6)], rng) : sample(rng, AMOUNTS, 8);
  return zone('lingots', 'Jeu 2 · Les lingots', 'Deux sommes identiques sous les lingots : vous remportez cette somme.', [
    group('lingots', 'lingots', 'Les 8 lingots', 4, amounts.map(amountCell)),
  ]);
}

/** Jeu 3 : 3 duels ; un diamant plus lourd que le saphir gagne le GAIN de la ligne. */
function stonesZone(rng: RandomSource, wins: readonly number[]): ScratchZone {
  const winners = sample(rng, range(0, 2), wins.length);
  const groups = range(0, 2).map((index) => {
    const win = wins[winners.indexOf(index)];
    const heavier = randomInt(rng, 2, 30);
    const lighter = randomInt(rng, 1, heavier - 1);
    const [diamond, sapphire] = win !== undefined ? [heavier, lighter] : [lighter, heavier];
    return group('pierres', `duel-${index + 1}`, `Ligne ${index + 1}`, 3, [
      { symbol: 'DIAMANT', label: `💎 ${diamond} g`, value: diamond },
      { symbol: 'SAPHIR', label: `🔷 ${sapphire} g`, value: sapphire },
      amountCell(win ?? decoyAmount(rng, AMOUNTS)),
    ]);
  });
  return zone('pierres', 'Jeu 3 · Diamant contre saphir', 'Sur une ligne, le diamant pèse plus lourd que le saphir : vous remportez le GAIN de la ligne.', groups);
}

/** Jeu 4 : 6 pièces ; chaque sac découvert gagne la somme associée. */
function coinsZone(rng: RandomSource, wins: readonly number[]): ScratchZone {
  const winners = sample(rng, range(0, 5), wins.length);
  const coins = range(0, 5).map((index): CellData => {
    const win = wins[winners.indexOf(index)];
    if (win !== undefined) return { symbol: BAG, label: '💰', amount: win };
    const [symbol, label] = pick(rng, COIN_SYMBOLS);
    return { symbol, label, amount: decoyAmount(rng, AMOUNTS) };
  });
  return zone('pieces', 'Jeu 4 · Les pièces', 'Sous une pièce, un sac : vous remportez la somme associée à ce sac.', [group('pieces', 'pieces', 'Les 6 pièces', 3, coins)]);
}

/** Millionnaire, d'après le règlement FDJ : 4 jeux indépendants dont les gains se cumulent. */
export const MILLIONNAIRE: ScratchGameDefinition = {
  type: 'MILLIONNAIRE',
  name: 'Millionnaire',
  tagline: '4 jeux : la roue, les lingots, diamant contre saphir, les pièces · jusqu’à 1 000 000',
  price: chips(10),
  serialPrefix: 'MIL',
  prizes: lotTable(6_000_000, [
    [4, 1_000_000],
    [4, 100_000],
    [6, 10_000],
    [200, 1_000],
    [24_000, 150],
    [60_000, 100],
    [108_800, 50],
    [840_000, 20],
    [760_000, 10],
  ]),

  generate(rng, prize) {
    const parts = chooseDecomposition(rng, prize, SLOTS, 3);
    return [
      wheelZone(rng, partsFor(parts, 'roue')),
      barsZone(rng, partsFor(parts, 'lingots')[0]),
      stonesZone(rng, partsFor(parts, 'pierres')),
      coinsZone(rng, partsFor(parts, 'pieces')),
    ];
  },

  evaluate(zones) {
    const wheel = zoneById(zones, 'roue');
    const winningSegments = wheel.groups.filter((segment) => [...bySymbol(segment.cells.filter((cell) => cell.symbol !== 'AMOUNT')).values()].some((cells) => cells.length >= 2));
    const wheelWin = winningSegments.reduce((sum, segment) => sum + (segment.cells.find((cell) => cell.symbol === 'AMOUNT')?.amount ?? 0), 0);

    const bars = cellsOf(zoneById(zones, 'lingots'));
    const byAmount = new Map<number, typeof bars>();
    for (const cell of bars) byAmount.set(cell.amount ?? 0, [...(byAmount.get(cell.amount ?? 0) ?? []), cell]);
    const pair = [...byAmount.values()].find((cells) => cells.length >= 2);
    const barsWin = pair?.[0]?.amount ?? 0;

    const stones = zoneById(zones, 'pierres');
    const winningDuels = stones.groups.filter((duel) => {
      const diamond = duel.cells.find((cell) => cell.symbol === 'DIAMANT')?.value ?? 0;
      const sapphire = duel.cells.find((cell) => cell.symbol === 'SAPHIR')?.value ?? 0;
      return diamond > sapphire;
    });
    const stonesWin = winningDuels.reduce((sum, duel) => sum + (duel.cells.find((cell) => cell.symbol === 'AMOUNT')?.amount ?? 0), 0);

    const bags = groupById(zoneById(zones, 'pieces'), 'pieces').cells.filter((cell) => cell.symbol === BAG);
    const coinsWin = bags.reduce((sum, cell) => sum + (cell.amount ?? 0), 0);

    return ticketEvaluation([
      zoneResult('roue', wheelWin, wheelWin > 0 ? `${winningSegments.length} segment${winningSegments.length > 1 ? 's' : ''} gagnant${winningSegments.length > 1 ? 's' : ''}` : 'Aucune paire dans les segments', winningSegments.flatMap((segment) => segment.cells.map((cell) => cell.id))),
      zoneResult('lingots', barsWin, barsWin > 0 ? 'Deux lingots identiques' : 'Toutes les sommes sont différentes', (pair ?? []).map((cell) => cell.id)),
      zoneResult('pierres', stonesWin, stonesWin > 0 ? 'Le diamant l’emporte' : 'Le saphir l’emporte partout', winningDuels.flatMap((duel) => duel.cells.map((cell) => cell.id))),
      zoneResult('pieces', coinsWin, coinsWin > 0 ? `${bags.length} sac${bags.length > 1 ? 's' : ''} trouvé${bags.length > 1 ? 's' : ''}` : 'Aucun sac', bags.map((cell) => cell.id)),
    ]);
  },
};

