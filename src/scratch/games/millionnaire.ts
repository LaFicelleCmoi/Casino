import { chips, shuffle, type RandomSource } from '../../core/index.js';
import { prizeTable } from '../prizes.js';
import type { ScratchGameDefinition, ScratchZone, ZoneResult } from '../types/ticket.js';
import {
  amountCell,
  bySymbol,
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

const NUMBER_AMOUNTS = [10, 20, 50, 100, 500, 1_000, 10_000];
const SYMBOL_AMOUNTS = [10, 20, 50, 100, 500];
const CHEST_AMOUNTS = [10, 50, 1_000, 10_000];
export const MILLION = 1_000_000;

const SYMBOLS = [
  ['DIAMANT', '💎'],
  ['COURONNE', '👑'],
  ['LINGOT', '💰'],
  ['ETOILE', '⭐'],
  ['TREFLE', '🍀'],
  ['HAUT_DE_FORME', '🎩'],
] as const;

const ZONE_IDS = ['numeros', 'symboles', 'coffre', 'million'] as const;
type MillionnaireZone = (typeof ZONE_IDS)[number];
const PAYABLE: Readonly<Record<MillionnaireZone, readonly number[]>> = {
  numeros: NUMBER_AMOUNTS,
  symboles: SYMBOL_AMOUNTS,
  coffre: CHEST_AMOUNTS,
  million: [MILLION],
};

function numbersZone(rng: RandomSource, win: number): ScratchZone {
  const winning = sample(rng, range(1, 30), 2);
  const yours: CellData[] = sample(rng, range(1, 30).filter((n) => !winning.includes(n)), win > 0 ? 5 : 6).map((n) => ({
    symbol: 'NUMBER',
    label: String(n),
    value: n,
    amount: pick(rng, NUMBER_AMOUNTS),
  }));
  if (win > 0) {
    const n = pick(rng, winning);
    yours.push({ symbol: 'NUMBER', label: String(n), value: n, amount: win });
  }
  return zone('numeros', 'Jeu 1 · Les numéros', 'Un de vos numéros est un numéro gagnant : vous gagnez le montant indiqué.', [
    group('numeros', 'gagnants', 'Numéros gagnants', 2, winning.map((n) => ({ symbol: 'WINNING_NUMBER', label: String(n), value: n }))),
    group('numeros', 'vos-numeros', 'Vos numéros', 3, shuffle(yours, rng)),
  ]);
}

function symbolsZone(rng: RandomSource, win: number): ScratchZone {
  let symbols: (typeof SYMBOLS)[number][];
  if (win > 0) {
    const triple = pick(rng, SYMBOLS);
    symbols = shuffle([triple, triple, triple, ...sampleWithCap(rng, SYMBOLS.filter((s) => s !== triple), 2, 3)], rng);
  } else {
    symbols = sampleWithCap(rng, SYMBOLS, 2, 6);
  }
  return zone('symboles', 'Jeu 2 · Trois symboles', 'Trois symboles identiques : vous gagnez le montant de la case Gain.', [
    group('symboles', 'symboles', 'Grattez les symboles', 3, symbols.map(([symbol, label]) => ({ symbol, label }))),
    group('symboles', 'gain', 'Gain', 1, [amountCell(win > 0 ? win : pick(rng, SYMBOL_AMOUNTS))]),
  ]);
}

function chestZone(win: number): ScratchZone {
  return zone('coffre', 'Jeu 3 · Le coffre', 'Le coffre renferme un montant : il est à vous.', [
    group('coffre', 'coffre', 'Ouvrez le coffre', 1, [win > 0 ? amountCell(win) : { symbol: 'EMPTY', label: 'Vide' }]),
  ]);
}

function millionZone(rng: RandomSource, win: number): ScratchZone {
  const keys = win > 0 ? 3 : rng.nextInt(3);
  const cells = shuffle(
    Array.from({ length: 3 }, (_, i): CellData => (i < keys ? { symbol: 'CLE', label: '🔑' } : { symbol: 'CHAINE', label: '⛓️' })),
    rng,
  );
  return zone('million', 'Jeu 4 · Le Million', 'Trois clés : vous remportez 1 000 000 jetons.', [
    group('million', 'cles', 'Les trois serrures', 3, cells),
  ]);
}

/** Quatre jeux indépendants sur un même ticket ; le lot est imprimé dans un seul d'entre eux. */
export const MILLIONNAIRE: ScratchGameDefinition = {
  type: 'MILLIONNAIRE',
  name: 'Millionnaire',
  tagline: '4 jeux sur un même ticket · jusqu’à 1 000 000 de jetons',
  price: chips(10),
  serialPrefix: 'MIL',
  prizes: prizeTable(8_074_495, [
    [10, 1_000_000],
    [20, 600_000],
    [50, 200_000],
    [100, 100_000],
    [500, 20_000],
    [1_000, 5_000],
    [10_000, 500],
    [MILLION, 5],
  ]),

  generate(rng, prize) {
    const winner = prize > 0 ? pick(rng, ZONE_IDS.filter((id) => PAYABLE[id].includes(prize))) : null;
    const winFor = (id: MillionnaireZone): number => (winner === id ? prize : 0);
    return [numbersZone(rng, winFor('numeros')), symbolsZone(rng, winFor('symboles')), chestZone(winFor('coffre')), millionZone(rng, winFor('million'))];
  },

  evaluate(zones) {
    const numeros = zoneById(zones, 'numeros');
    const winningNumbers = new Set(groupById(numeros, 'gagnants').cells.map((cell) => cell.value));
    const matches = groupById(numeros, 'vos-numeros').cells.filter((cell) => winningNumbers.has(cell.value));
    const numbersWin = matches.reduce((sum, cell) => sum + (cell.amount ?? 0), 0);

    const symboles = zoneById(zones, 'symboles');
    const triple = [...bySymbol(groupById(symboles, 'symboles').cells).values()].find((cells) => cells.length >= 3);
    const symbolGain = firstCell(symboles, 'gain');

    const chest = firstCell(zoneById(zones, 'coffre'), 'coffre');
    const keys = groupById(zoneById(zones, 'million'), 'cles').cells;
    const allKeys = keys.length > 0 && keys.every((cell) => cell.symbol === 'CLE');

    const results: ZoneResult[] = [
      numbersWin > 0
        ? zoneResult('numeros', numbersWin, 'Numéro gagnant trouvé', matches.map((cell) => cell.id))
        : zoneResult('numeros', 0, 'Aucun numéro gagnant'),
      triple !== undefined && symbolGain.amount !== null
        ? zoneResult('symboles', symbolGain.amount, 'Trois symboles identiques', [...triple.map((cell) => cell.id), symbolGain.id])
        : zoneResult('symboles', 0, 'Pas de brelan'),
      chest.amount !== null ? zoneResult('coffre', chest.amount, 'Le coffre était plein', [chest.id]) : zoneResult('coffre', 0, 'Coffre vide'),
      allKeys ? zoneResult('million', MILLION, 'LE MILLION !', keys.map((cell) => cell.id)) : zoneResult('million', 0, 'Il manque une clé'),
    ];
    return ticketEvaluation(results);
  },
};
