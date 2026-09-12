import { chips, shuffle, type RandomSource } from '../../core/index.js';
import { prizeTable } from '../prizes.js';
import type { ScratchGameDefinition, ScratchZone } from '../types/ticket.js';
import {
  amountCell,
  firstCell,
  group,
  groupById,
  pick,
  range,
  sample,
  sampleWithCap,
  ticketEvaluation,
  zone,
  zoneById,
  zoneResult,
  type CellData,
} from './helpers.js';

const ROULETTE_AMOUNTS = [5, 10, 20, 50, 100, 500];
const CRAPS_AMOUNTS = [5, 10, 20, 50, 100];
const JACKPOT_AMOUNTS = [50, 100, 500, 5_000];
export const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'] as const;
const REELS = [
  ['SEPT', '7'],
  ['CERISE', '🍒'],
  ['CLOCHE', '🔔'],
  ['BAR', 'BAR'],
  ['DIAMANT', '💎'],
] as const;

const DICE_PAIRS = range(1, 6).flatMap((a) => range(1, 6).map((b) => [a, b] as const));
const isNatural = ([a, b]: readonly [number, number]): boolean => a + b === 7 || a + b === 11;

const ZONE_IDS = ['roulette', 'craps', 'jackpot'] as const;
type VegasZone = (typeof ZONE_IDS)[number];
const PAYABLE: Readonly<Record<VegasZone, readonly number[]>> = {
  roulette: ROULETTE_AMOUNTS,
  craps: CRAPS_AMOUNTS,
  jackpot: JACKPOT_AMOUNTS,
};

function rouletteZone(rng: RandomSource, win: number): ScratchZone {
  const winning = rng.nextInt(37);
  const yours: CellData[] = sample(rng, range(0, 36).filter((n) => n !== winning), win > 0 ? 4 : 5).map((n) => ({
    symbol: 'NUMBER',
    label: String(n),
    value: n,
    amount: pick(rng, ROULETTE_AMOUNTS),
  }));
  if (win > 0) yours.push({ symbol: 'NUMBER', label: String(winning), value: winning, amount: win });
  return zone('roulette', 'Zone Roulette', 'Un de vos numéros est le numéro sorti : vous gagnez sa mise.', [
    group('roulette', 'numero', 'Numéro sorti', 1, [{ symbol: 'WINNING_NUMBER', label: String(winning), value: winning }]),
    group('roulette', 'mises', 'Vos numéros', 5, shuffle(yours, rng)),
  ]);
}

function crapsZone(rng: RandomSource, win: number): ScratchZone {
  const dice = pick(rng, DICE_PAIRS.filter((pair) => isNatural(pair) === win > 0));
  return zone('craps', 'Zone Craps', 'Les dés font 7 ou 11 : vous gagnez le montant de la case Gain.', [
    group('craps', 'des', 'Lancer de dés', 2, dice.map((face) => ({ symbol: 'DIE', label: DICE_FACES[face - 1] ?? '?', value: face }))),
    group('craps', 'gain', 'Gain', 1, [amountCell(win > 0 ? win : pick(rng, CRAPS_AMOUNTS))]),
  ]);
}

function jackpotZone(rng: RandomSource, win: number): ScratchZone {
  let reels: (typeof REELS)[number][];
  if (win > 0) {
    const symbol = pick(rng, REELS);
    reels = [symbol, symbol, symbol];
  } else {
    reels = sampleWithCap(rng, REELS, 2, 3);
  }
  return zone('jackpot', 'Zone Jackpot', 'Trois symboles identiques sur les rouleaux : jackpot !', [
    group('jackpot', 'rouleaux', 'Les rouleaux', 3, reels.map(([symbol, label]) => ({ symbol, label }))),
    group('jackpot', 'gain', 'Jackpot', 1, [amountCell(win > 0 ? win : pick(rng, JACKPOT_AMOUNTS))]),
  ]);
}

/** Roulette, craps et machine à sous sur un même ticket. */
export const VEGAS: ScratchGameDefinition = {
  type: 'VEGAS',
  name: 'Vegas',
  tagline: 'L’esprit casino · zone Roulette, zone Craps et Jackpot à gratter',
  price: chips(5),
  serialPrefix: 'VGS',
  prizes: prizeTable(775_570, [
    [5, 120_000],
    [10, 60_000],
    [20, 30_000],
    [50, 10_000],
    [100, 4_000],
    [500, 400],
    [5_000, 30],
  ]),

  generate(rng, prize) {
    const winner = prize > 0 ? pick(rng, ZONE_IDS.filter((id) => PAYABLE[id].includes(prize))) : null;
    const winFor = (id: VegasZone): number => (winner === id ? prize : 0);
    return [rouletteZone(rng, winFor('roulette')), crapsZone(rng, winFor('craps')), jackpotZone(rng, winFor('jackpot'))];
  },

  evaluate(zones) {
    const roulette = zoneById(zones, 'roulette');
    const drawn = firstCell(roulette, 'numero');
    const hits = groupById(roulette, 'mises').cells.filter((cell) => cell.value === drawn.value);
    const rouletteWin = hits.reduce((sum, cell) => sum + (cell.amount ?? 0), 0);

    const craps = zoneById(zones, 'craps');
    const [first, second] = groupById(craps, 'des').cells;
    const total = (first?.value ?? 0) + (second?.value ?? 0);
    const crapsGain = firstCell(craps, 'gain');
    const natural = total === 7 || total === 11;

    const jackpot = zoneById(zones, 'jackpot');
    const reels = groupById(jackpot, 'rouleaux').cells;
    const aligned = reels.length === 3 && reels.every((cell) => cell.symbol === reels[0]?.symbol);
    const jackpotGain = firstCell(jackpot, 'gain');

    return ticketEvaluation([
      rouletteWin > 0
        ? zoneResult('roulette', rouletteWin, `Le ${drawn.label} est sorti`, [drawn.id, ...hits.map((cell) => cell.id)])
        : zoneResult('roulette', 0, `Le ${drawn.label} n’est pas à vous`),
      natural && crapsGain.amount !== null && first !== undefined && second !== undefined
        ? zoneResult('craps', crapsGain.amount, `Total ${total} : naturel !`, [first.id, second.id, crapsGain.id])
        : zoneResult('craps', 0, `Total ${total}`),
      aligned && jackpotGain.amount !== null
        ? zoneResult('jackpot', jackpotGain.amount, 'Trois symboles alignés', [...reels.map((cell) => cell.id), jackpotGain.id])
        : zoneResult('jackpot', 0, 'Rouleaux dépareillés'),
    ]);
  },
};
